import { Prisma, type Garantia, type Venta, type VentaDetalle } from "../generated/prisma/client.ts";
import { tomarPantallasDisponibles } from "./bloqueo-pantallas.ts";
import { datosSinEmpresa } from "./prisma-empresa.ts";
import { descifrar } from "./cifrado.ts";
import { generarCodigoCompra } from "./codigo-compra.ts";
import { restriccionViolada } from "./errores.ts";
import { renderizarMensajeDeVenta } from "./mensaje-venta.ts";
import type { ComponenteMensajePaquete } from "./mensaje.ts";
import { PLANTILLA_RESPALDO_PAQUETE, PLANTILLA_RESPALDO_UNIDAD } from "./plantillas-default.ts";

// ---------------------------------------------------------------------------
// Garantía — una pantalla falló y se reemplaza por otra de la misma
// plataforma, dentro de la MISMA venta. Reutiliza el mecanismo de venta
// (tomarPantallasDisponibles, renderizarMensajeDeVenta) en vez de escribir
// un camino nuevo: ver CLAUDE.md R2/R3 y lib/ventas.ts.
//
// A diferencia de realizarVenta, esta función SÍ escribe (bloqueo de
// pantalla, VentaDetalle nuevo, Pantalla.activa=false) ANTES de poder saber
// si Garantia.create() choca contra la restricción única de
// ventaDetalleOriginalId (dos garantías concurrentes sobre el mismo
// renglón). Por eso, ante esa colisión, se lanza GarantiaYaReemplazadaError
// en vez de devolver un resultado: lanzar DENTRO de $transaction fuerza un
// ROLLBACK completo de Postgres, deshaciendo también esas escrituras
// previas de la transacción perdedora — el route handler la atrapa afuera.
// ---------------------------------------------------------------------------

type ClienteEmpresa = Prisma.TransactionClient;

export class GarantiaYaReemplazadaError extends Error {}

export type ResultadoGarantia =
  | { tipo: "ok"; garantia: Garantia; ventaDetalleReemplazo: VentaDetalle }
  | { tipo: "no_encontrado" }
  | { tipo: "venta_anulada" }
  | { tipo: "ya_reemplazada" }
  | { tipo: "sin_inventario"; nombrePlataforma: string };

export async function realizarGarantia(
  tx: ClienteEmpresa,
  empresaId: string,
  creadoPorId: string,
  ventaDetalleOriginalId: string,
  motivo: string | null,
): Promise<ResultadoGarantia> {
  const original = await tx.ventaDetalle.findUnique({
    where: { id: ventaDetalleOriginalId },
    include: { venta: true, plataforma: true, duracion: true },
  });
  if (!original) return { tipo: "no_encontrado" };
  if (original.venta.anulada) return { tipo: "venta_anulada" };

  const garantiaExistente = await tx.garantia.findUnique({ where: { ventaDetalleOriginalId } });
  if (garantiaExistente) return { tipo: "ya_reemplazada" };

  const pantallas = await tomarPantallasDisponibles(tx, empresaId, original.plataformaId, 1);
  if (pantallas.length === 0) {
    return { tipo: "sin_inventario", nombrePlataforma: original.nombrePlataforma };
  }
  const pantallaNueva = pantallas[0];

  const [cuentaNueva, pantallaInfo, costoPlataforma] = await Promise.all([
    tx.cuenta.findUniqueOrThrow({ where: { id: pantallaNueva.cuentaId } }),
    tx.pantalla.findUniqueOrThrow({ where: { id: pantallaNueva.id } }),
    tx.costoPlataforma.findFirst({
      where: { plataformaId: original.plataformaId, duracionId: original.duracionId },
    }),
  ]);
  // El costo ya no depende del tipo de cliente (CostoPlataforma, no Precio —
  // ver CLAUDE.md "camino del dinero"). Si falta, se asume cero: la garantía
  // no se bloquea por un dato de configuración faltante, igual que una venta.
  const costoAsumido = costoPlataforma?.costo ?? new Prisma.Decimal(0);

  const ventaDetalleReemplazo = await tx.ventaDetalle.create({
    data: datosSinEmpresa<Prisma.VentaDetalleUncheckedCreateInput>({
      ventaId: original.ventaId,
      pantallaId: pantallaNueva.id,
      cuentaId: pantallaNueva.cuentaId,
      plataformaId: original.plataformaId,
      nombrePlataforma: original.nombrePlataforma,
      correoCuenta: cuentaNueva.correo,
      usuarioCuenta: cuentaNueva.usuario,
      // Ya cifrados en BD: se copian tal cual, igual que en una venta normal
      // (R3 — la copia es del valor cifrado, nunca del descifrado).
      codigoCuenta: cuentaNueva.codigo,
      enlaceCuenta: cuentaNueva.enlace,
      passwordCuenta: cuentaNueva.password,
      perfil: pantallaInfo.perfil,
      pin: pantallaInfo.pin,
      duracionId: original.duracionId,
      cantidadDuracion: original.cantidadDuracion,
      unidadDuracion: original.unidadDuracion,
      // Hereda el vencimiento del original: no se recalcula (sección 3).
      fechaVencimiento: original.fechaVencimiento,
      // F4.4: copia del renglón que reemplaza, no un dato nuevo — es el
      // mismo renglón vendido, solo en otra pantalla física.
      precioSugerido: original.precioSugerido,
      costo: original.costo,
    }),
  });

  // La pantalla dañada sale del inventario: no se vuelve a ofrecer en
  // ninguna venta ni garantía futura. La cuenta entera sigue activa.
  await tx.pantalla.update({ where: { id: original.pantallaId }, data: { activa: false } });

  const mensajeGenerado = await renderizarMensajeGarantia(tx, original, cuentaNueva, pantallaInfo);

  let garantia: Garantia;
  try {
    garantia = await tx.garantia.create({
      data: datosSinEmpresa<Prisma.GarantiaUncheckedCreateInput>({
        ventaDetalleOriginalId: original.id,
        ventaDetalleReemplazoId: ventaDetalleReemplazo.id,
        motivo,
        costoAsumido,
        mensajeGenerado,
        creadoPorId,
      }),
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      restriccionViolada(error).includes("ventaDetalleOriginalId")
    ) {
      throw new GarantiaYaReemplazadaError();
    }
    throw error;
  }

  return { tipo: "ok", garantia, ventaDetalleReemplazo };
}

type OriginalConRelaciones = Prisma.VentaDetalleGetPayload<{
  include: { venta: true; plataforma: true; duracion: true };
}>;

/**
 * Mismo punto de entrada que una venta (lib/mensaje-venta.ts): mismos datos,
 * mismo formato, pero con un solo bloque — el de la plataforma reemplazada
 * — aun cuando la venta original fue un PAQUETE. El aviso de reemplazo se
 * antepone fuera de la plantilla, para no obligar al admin a editar el
 * contenido configurado en PlantillaMensaje.
 */
async function renderizarMensajeGarantia(
  tx: ClienteEmpresa,
  original: OriginalConRelaciones,
  cuentaNueva: { correo: string | null; usuario: string | null; codigo: string | null; enlace: string | null; password: string },
  pantallaNueva: { perfil: string | null; pin: string | null },
): Promise<string> {
  const venta = original.venta;
  const plantilla = await tx.plantillaMensaje.findFirst({ where: { tipo: venta.tipoVenta } });
  const contenidoPlantilla =
    plantilla?.contenido ?? (venta.tipoVenta === "UNIDAD" ? PLANTILLA_RESPALDO_UNIDAD : PLANTILLA_RESPALDO_PAQUETE);

  const datosComunes = {
    codigoCompra: venta.codigoCompra,
    fechaVenta: new Date(),
    nombreTipoCliente: venta.nombreTipoCliente,
    nombreDuracion: original.duracion.nombre,
    fechaVencimientoMax: original.fechaVencimiento,
    precioVenta: venta.precioVenta,
    celularCliente: venta.celularCliente,
  };

  const nombrePlataformaMensaje = original.plataforma.nombreMensaje ?? original.plataforma.nombre;
  const perfil = pantallaNueva.perfil;
  const pin = pantallaNueva.pin ? descifrar(pantallaNueva.pin) : null;
  const correo = cuentaNueva.correo;
  const usuario = cuentaNueva.usuario;
  const codigo = cuentaNueva.codigo ? descifrar(cuentaNueva.codigo) : null;
  const enlace = cuentaNueva.enlace;
  const clave = descifrar(cuentaNueva.password);
  const banderas = {
    usaPerfilPin: original.plataforma.usaPerfilPin,
    usaCorreo: original.plataforma.usaCorreo,
    usaUsuario: original.plataforma.usaUsuario,
    usaCodigo: original.plataforma.usaCodigo,
    usaEnlace: original.plataforma.usaEnlace,
  };

  const cuerpo =
    venta.tipoVenta === "UNIDAD"
      ? renderizarMensajeDeVenta(contenidoPlantilla, {
          tipo: "UNIDAD",
          datos: {
            ...datosComunes,
            ...banderas,
            nombrePlataformaMensaje,
            perfil,
            pin,
            correo,
            usuario,
            codigo,
            enlace,
            clave,
          },
        })
      : renderizarMensajeDeVenta(contenidoPlantilla, {
          tipo: "PAQUETE",
          datos: {
            ...datosComunes,
            nombrePaquete: venta.nombreItem,
            componentes: [
              {
                ...banderas,
                nombrePlataforma: nombrePlataformaMensaje,
                nombreDuracionReal: original.duracion.nombre,
                perfil,
                pin,
                correo,
                usuario,
                codigo,
                enlace,
                clave,
              } satisfies ComponenteMensajePaquete,
            ],
          },
        });

  return `*Reemplazo de pantalla*\n\n${cuerpo}`;
}

// ---------------------------------------------------------------------------
// F4.3 — garantía de una venta hecha fuera del sistema: no hay VentaDetalle
// original que reemplazar, así que se crea una Venta mínima `esExterna` en
// vez de volver VentaDetalle.ventaId opcional (eso forzaría tocar
// estadoDePantallas(), la única implementación de R5, con riesgo de
// sobreventa). La pérdida va en Garantia.costoAsumido, que totalesDesde()
// en routes/ventas.ts ya suma y resta de la utilidad.
//
// A diferencia de realizarGarantia, NO se desactiva ninguna Pantalla: la
// pantalla que falló nunca estuvo en el inventario del sistema, no hay nada
// que sacar de circulación.
// ---------------------------------------------------------------------------

const MAX_INTENTOS_CODIGO_EXTERNA = 5;

export interface EntradaGarantiaExterna {
  plataformaId: string;
  duracionId: string;
  fechaVencimiento: Date;
  celularCliente?: string | null;
  motivo?: string | null;
}

export type ResultadoGarantiaExterna =
  | { tipo: "ok"; garantia: Garantia; ventaDetalleReemplazo: VentaDetalle }
  | { tipo: "no_disponible"; mensaje: string }
  | { tipo: "sin_inventario"; nombrePlataforma: string };

export async function realizarGarantiaExterna(
  tx: ClienteEmpresa,
  empresaId: string,
  creadoPorId: string,
  entrada: EntradaGarantiaExterna,
): Promise<ResultadoGarantiaExterna> {
  const [empresa, plataforma, duracion] = await Promise.all([
    tx.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { prefijoCodigo: true } }),
    tx.plataforma.findUnique({ where: { id: entrada.plataformaId } }),
    tx.duracion.findUnique({ where: { id: entrada.duracionId } }),
  ]);
  if (!plataforma || !plataforma.activa) {
    return { tipo: "no_disponible", mensaje: "La plataforma seleccionada no está disponible." };
  }
  if (!duracion || !duracion.activa) {
    return { tipo: "no_disponible", mensaje: "La duración seleccionada no está disponible." };
  }

  const pantallas = await tomarPantallasDisponibles(tx, empresaId, plataforma.id, 1);
  if (pantallas.length === 0) {
    return { tipo: "sin_inventario", nombrePlataforma: plataforma.nombre };
  }
  const pantallaNueva = pantallas[0];

  const [cuentaNueva, pantallaInfo, costoPlataforma] = await Promise.all([
    tx.cuenta.findUniqueOrThrow({ where: { id: pantallaNueva.cuentaId } }),
    tx.pantalla.findUniqueOrThrow({ where: { id: pantallaNueva.id } }),
    tx.costoPlataforma.findFirst({ where: { plataformaId: plataforma.id, duracionId: duracion.id } }),
  ]);
  // Mismo criterio que una venta/garantía normal: sin CostoPlataforma
  // configurado, se asume cero — un dato de configuración faltante no
  // bloquea la operación.
  const costoAsumido = costoPlataforma?.costo ?? new Prisma.Decimal(0);

  const fechaVenta = new Date();
  const celularCliente = entrada.celularCliente ?? null;

  let ventaCreada: Venta | null = null;
  let mensajeGenerado = "";
  for (let intento = 0; intento < MAX_INTENTOS_CODIGO_EXTERNA; intento++) {
    const codigoCompra = await generarCodigoCompra(tx, empresaId, empresa.prefijoCodigo);
    mensajeGenerado = await renderizarMensajeGarantiaExterna(tx, plataforma, duracion, cuentaNueva, pantallaInfo, {
      codigoCompra,
      fechaVencimiento: entrada.fechaVencimiento,
      celularCliente,
    });

    // SAVEPOINT: mismo motivo que en lib/ventas.ts — si create() choca con
    // la restricción única de codigoCompra (P2002), Postgres aborta TODA la
    // transacción y el siguiente intento revienta con 25P02 en vez de
    // ejecutar el reintento, salvo que se delimite con un SAVEPOINT propio.
    await tx.$executeRaw`SAVEPOINT intento_codigo_compra_externa`;
    try {
      ventaCreada = await tx.venta.create({
        data: datosSinEmpresa<Prisma.VentaUncheckedCreateInput>({
          vendedorId: creadoPorId,
          codigoCompra,
          tipoVenta: "UNIDAD",
          esExterna: true,
          plataformaId: plataforma.id,
          paqueteId: null,
          duracionId: duracion.id,
          tipoClienteId: null,
          nombreItem: plataforma.nombre,
          nombreDuracion: duracion.nombre,
          cantidadDuracion: duracion.cantidad,
          unidadDuracion: duracion.unidad,
          // Literal, no un TipoCliente real: no contaminar las estadísticas
          // de F4.5 con un tipo de cliente inventado para esta venta mínima.
          nombreTipoCliente: "Venta externa",
          precioSugerido: new Prisma.Decimal(0),
          precioVenta: new Prisma.Decimal(0),
          costo: new Prisma.Decimal(0),
          utilidad: new Prisma.Decimal(0),
          esPromocion: false,
          celularCliente,
          fechaVenta,
          fechaVencimientoMax: entrada.fechaVencimiento,
          mensajeGenerado,
        }),
      });
      await tx.$executeRaw`RELEASE SAVEPOINT intento_codigo_compra_externa`;
      break;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        restriccionViolada(error).includes("codigoCompra")
      ) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT intento_codigo_compra_externa`;
        continue;
      }
      throw error;
    }
  }
  if (!ventaCreada) {
    throw new Error(
      `No se pudo generar un código de compra único tras ${MAX_INTENTOS_CODIGO_EXTERNA} intentos. Intenta de nuevo.`,
    );
  }

  const ventaDetalleReemplazo = await tx.ventaDetalle.create({
    data: datosSinEmpresa<Prisma.VentaDetalleUncheckedCreateInput>({
      ventaId: ventaCreada.id,
      pantallaId: pantallaNueva.id,
      cuentaId: pantallaNueva.cuentaId,
      plataformaId: plataforma.id,
      nombrePlataforma: plataforma.nombre,
      correoCuenta: cuentaNueva.correo,
      usuarioCuenta: cuentaNueva.usuario,
      codigoCuenta: cuentaNueva.codigo,
      enlaceCuenta: cuentaNueva.enlace,
      passwordCuenta: cuentaNueva.password,
      perfil: pantallaInfo.perfil,
      pin: pantallaInfo.pin,
      duracionId: duracion.id,
      cantidadDuracion: duracion.cantidad,
      unidadDuracion: duracion.unidad,
      fechaVencimiento: entrada.fechaVencimiento,
    }),
  });

  // Sin try/catch de P2002 aquí: ventaDetalleReemplazoId es el id de una
  // fila recién creada (sin colisión posible) y ventaDetalleOriginalId va
  // null — Postgres permite muchos NULL en una columna única, así que dos
  // garantías externas concurrentes nunca chocan entre sí en esta columna.
  const garantia = await tx.garantia.create({
    data: datosSinEmpresa<Prisma.GarantiaUncheckedCreateInput>({
      ventaDetalleOriginalId: null,
      ventaDetalleReemplazoId: ventaDetalleReemplazo.id,
      motivo: entrada.motivo ?? null,
      costoAsumido,
      mensajeGenerado,
      creadoPorId,
      esExterna: true,
      plataformaExternaId: plataforma.id,
      celularExterno: celularCliente,
    }),
  });

  return { tipo: "ok", garantia, ventaDetalleReemplazo };
}

/**
 * Mismo punto de entrada que una venta/garantía normal (lib/mensaje-venta.ts),
 * siempre UNIDAD — una venta externa nunca es PAQUETE (fuera de alcance,
 * F4.3). precioVenta es cero porque no es un ingreso, no porque el
 * comprador no pagó nada: ocultarPrecio quita el bloque {{precio}} en vez
 * de mostrar "$0" (lib/mensaje.ts).
 */
async function renderizarMensajeGarantiaExterna(
  tx: ClienteEmpresa,
  plataforma: {
    nombre: string;
    nombreMensaje: string | null;
    usaPerfilPin: boolean;
    usaCorreo: boolean;
    usaUsuario: boolean;
    usaCodigo: boolean;
    usaEnlace: boolean;
  },
  duracion: { nombre: string },
  cuentaNueva: { correo: string | null; usuario: string | null; codigo: string | null; enlace: string | null; password: string },
  pantallaNueva: { perfil: string | null; pin: string | null },
  datos: { codigoCompra: string; fechaVencimiento: Date; celularCliente: string | null },
): Promise<string> {
  const plantilla = await tx.plantillaMensaje.findFirst({ where: { tipo: "UNIDAD" } });
  const contenidoPlantilla = plantilla?.contenido ?? PLANTILLA_RESPALDO_UNIDAD;

  const nombrePlataformaMensaje = plataforma.nombreMensaje ?? plataforma.nombre;

  const cuerpo = renderizarMensajeDeVenta(contenidoPlantilla, {
    tipo: "UNIDAD",
    datos: {
      codigoCompra: datos.codigoCompra,
      fechaVenta: new Date(),
      nombreTipoCliente: "Venta externa",
      nombreDuracion: duracion.nombre,
      fechaVencimientoMax: datos.fechaVencimiento,
      precioVenta: new Prisma.Decimal(0),
      ocultarPrecio: true,
      celularCliente: datos.celularCliente,
      nombrePlataformaMensaje,
      usaPerfilPin: plataforma.usaPerfilPin,
      usaCorreo: plataforma.usaCorreo,
      usaUsuario: plataforma.usaUsuario,
      usaCodigo: plataforma.usaCodigo,
      usaEnlace: plataforma.usaEnlace,
      perfil: pantallaNueva.perfil,
      pin: pantallaNueva.pin ? descifrar(pantallaNueva.pin) : null,
      correo: cuentaNueva.correo,
      usuario: cuentaNueva.usuario,
      codigo: cuentaNueva.codigo ? descifrar(cuentaNueva.codigo) : null,
      enlace: cuentaNueva.enlace,
      clave: descifrar(cuentaNueva.password),
    },
  });

  return `*Reemplazo de pantalla*\n\n${cuerpo}`;
}
