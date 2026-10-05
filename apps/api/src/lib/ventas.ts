import { Prisma, type Venta } from "../generated/prisma/client.ts";
import type { UnidadDuracion } from "../generated/prisma/enums.ts";
import { tomarPantallasDisponibles, type PantallaBloqueada } from "./bloqueo-pantallas.ts";
import { datosSinEmpresa } from "./prisma-empresa.ts";
import { descifrar } from "./cifrado.ts";
import { generarCodigoCompra } from "./codigo-compra.ts";
import { calcularVencimiento } from "./duracion.ts";
import { restriccionViolada } from "./errores.ts";
import { renderizarMensajeDeVenta } from "./mensaje-venta.ts";
import type { ComponenteMensajePaquete } from "./mensaje.ts";
import { resolverComposicionDePaquete, type ComponentePaquete } from "./paquetes.ts";
import { PLANTILLA_RESPALDO_PAQUETE, PLANTILLA_RESPALDO_UNIDAD } from "./plantillas-default.ts";

// ---------------------------------------------------------------------------
// Entrega 8, sección 3 — la transacción de venta. `realizarVenta` ASUME que
// ya está corriendo dentro de `prismaParaEmpresa(empresaId).$transaction(tx
// => ...)`: no abre su propia transacción, porque necesita que el bloqueo de
// pantallas (R2), la creación de Venta/VentaDetalle y el mensaje queden
// todos dentro de la MISMA transacción de Postgres.
//
// Resultado como unión discriminada (mismo patrón que cuentas.ts/paquetes.ts
// para el PATCH de capacidad): los casos de negocio esperables (sin precio,
// sin inventario) se devuelven, no se lanzan. Nada se escribe en ninguno de
// esos casos, así que terminar la transacción sin haber escrito nada es un
// commit vacío — equivalente a un rollback para efectos de datos, y las
// pantallas que sí se llegaron a bloquear (FOR UPDATE) quedan libres para la
// siguiente venta en cuanto la transacción termina.
// ---------------------------------------------------------------------------

type ClienteEmpresa = Prisma.TransactionClient;

const MAX_INTENTOS_CODIGO = 5;

export interface EntradaVentaUnidad {
  tipoVenta: "UNIDAD";
  plataformaId: string;
  duracionId: string;
  tipoClienteId: string;
}

export interface EntradaVentaPaquete {
  tipoVenta: "PAQUETE";
  paqueteId: string;
  duracionId: string;
  tipoClienteId: string;
}

export type EntradaVenta = EntradaVentaUnidad | EntradaVentaPaquete;

export type ResultadoVenta =
  // plantillaFaltante: true cuando la empresa no tenía una PlantillaMensaje
  // configurada para este tipo de venta y se usó la plantilla de respaldo
  // incorporada en el código — la venta se completa igual (una venta no se
  // pierde por un problema de formato), pero el caller debe avisarle al
  // vendedor que hay algo que configurar.
  | { tipo: "ok"; venta: Venta; plantillaFaltante: boolean }
  // Plataforma/paquete/duración/tipo de cliente no encontrados o inactivos,
  // o sin un Precio activo para la combinación — un solo balde con mensaje
  // apto para el usuario final (CLAUDE.md), porque todos comparten la misma
  // respuesta: "esto no se puede vender tal como está planteado".
  | { tipo: "no_disponible"; mensaje: string }
  // R2 regla 2 — todo o nada: ninguna plataforma del paquete quedó tocada,
  // se nombra la que no alcanzó a cubrir su cupo completo.
  | { tipo: "inventario_insuficiente"; nombrePlataforma: string };

interface Bloqueo {
  componente: ComponentePaquete;
  pantallas: PantallaBloqueada[];
  fechaVencimiento: Date;
}

export async function realizarVenta(
  tx: ClienteEmpresa,
  empresaId: string,
  vendedorId: string,
  entrada: EntradaVenta,
): Promise<ResultadoVenta> {
  const [empresa, tipoCliente, duracionVendida] = await Promise.all([
    tx.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { prefijoCodigo: true } }),
    tx.tipoCliente.findUnique({ where: { id: entrada.tipoClienteId } }),
    tx.duracion.findUnique({ where: { id: entrada.duracionId } }),
  ]);

  if (!tipoCliente || !tipoCliente.activo) {
    return { tipo: "no_disponible", mensaje: "El tipo de cliente seleccionado no está disponible." };
  }
  if (!duracionVendida || !duracionVendida.activa) {
    return { tipo: "no_disponible", mensaje: "La duración seleccionada no está disponible." };
  }

  let nombreItem: string;
  let composicion: ComponentePaquete[];
  if (entrada.tipoVenta === "UNIDAD") {
    const plataforma = await tx.plataforma.findUnique({ where: { id: entrada.plataformaId } });
    if (!plataforma || !plataforma.activa) {
      return { tipo: "no_disponible", mensaje: "La plataforma seleccionada no está disponible." };
    }
    const precio = await tx.precio.findFirst({
      where: {
        plataformaId: plataforma.id,
        duracionId: duracionVendida.id,
        tipoClienteId: tipoCliente.id,
        activo: true,
      },
    });
    if (!precio) {
      return { tipo: "no_disponible", mensaje: "No hay un precio activo para esta combinación." };
    }
    nombreItem = plataforma.nombre;
    composicion = [
      {
        plataformaId: plataforma.id,
        nombrePlataforma: plataforma.nombre,
        cantidadPantallas: 1,
        duracionId: duracionVendida.id,
        cantidadDuracion: duracionVendida.cantidad,
        unidadDuracion: duracionVendida.unidad,
      },
    ];
    return realizarVentaConComposicion(tx, empresaId, vendedorId, entrada, {
      empresa,
      tipoCliente,
      duracionVendida,
      nombreItem,
      composicion,
      precioVenta: precio.precioVenta,
      costo: precio.costo,
    });
  }

  const paquete = await tx.paquete.findUnique({ where: { id: entrada.paqueteId } });
  if (!paquete || !paquete.activo) {
    return { tipo: "no_disponible", mensaje: "El paquete seleccionado no está disponible." };
  }
  const precio = await tx.precio.findFirst({
    where: {
      paqueteId: paquete.id,
      duracionId: duracionVendida.id,
      tipoClienteId: tipoCliente.id,
      activo: true,
    },
  });
  if (!precio) {
    return { tipo: "no_disponible", mensaje: "No hay un precio activo para esta combinación." };
  }
  nombreItem = paquete.nombre;
  composicion = await resolverComposicionDePaquete(tx, paquete.id, duracionVendida.id);
  if (composicion.length === 0) {
    return { tipo: "no_disponible", mensaje: "El paquete no tiene plataformas configuradas." };
  }

  return realizarVentaConComposicion(tx, empresaId, vendedorId, entrada, {
    empresa,
    tipoCliente,
    duracionVendida,
    nombreItem,
    composicion,
    precioVenta: precio.precioVenta,
    costo: precio.costo,
  });
}

interface DatosComunesVenta {
  empresa: { prefijoCodigo: string };
  tipoCliente: { id: string; nombre: string };
  duracionVendida: { id: string; nombre: string; cantidad: number; unidad: UnidadDuracion };
  nombreItem: string;
  composicion: ComponentePaquete[];
  precioVenta: Prisma.Decimal;
  costo: Prisma.Decimal;
}

/**
 * Parte 2 de la función anterior: ya se resolvió QUÉ se vende (composición,
 * precio). A partir de aquí: bloquear pantallas en orden (R2 regla 1, ya
 * garantizado por el orden de `composicion`), todo o nada (R2 regla 2),
 * generar el código de compra con reintento ante P2002 (nunca confiar solo
 * en la pre-verificación de generarCodigoCompra — ver CLAUDE.md), crear
 * Venta + VentaDetalle con las copias inmutables (R3) y renderizar el
 * mensaje (sección 4) dentro de la misma transacción.
 */
async function realizarVentaConComposicion(
  tx: ClienteEmpresa,
  empresaId: string,
  vendedorId: string,
  entrada: EntradaVenta,
  datos: DatosComunesVenta,
): Promise<ResultadoVenta> {
  const { empresa, tipoCliente, duracionVendida, nombreItem, composicion, precioVenta, costo } = datos;

  const plataformasInfo = await tx.plataforma.findMany({
    where: { id: { in: composicion.map((c) => c.plataformaId) } },
  });
  const plataformaInfoPorId = new Map(plataformasInfo.map((p) => [p.id, p]));

  const idsDuracionReal = new Set(composicion.map((c) => c.duracionId));
  const duracionesReales = await tx.duracion.findMany({
    where: { id: { in: [...idsDuracionReal] } },
    select: { id: true, nombre: true },
  });
  const nombreDuracionPorId = new Map(duracionesReales.map((d) => [d.id, d.nombre]));

  // R2 regla 1: `composicion` ya viene ordenada por plataformaId ascendente
  // (resolverComposicionDePaquete lo garantiza; en UNIDAD hay una sola).
  const fechaVenta = new Date();
  const bloqueos: Bloqueo[] = [];
  for (const componente of composicion) {
    const pantallas = await tomarPantallasDisponibles(tx, empresaId, componente.plataformaId, componente.cantidadPantallas);
    if (pantallas.length < componente.cantidadPantallas) {
      // R2 regla 2 — todo o nada: no se escribió nada todavía, así que no
      // hace falta deshacer nada; terminar la transacción sin escrituras
      // libera cualquier bloqueo FOR UPDATE que sí se alcanzó a tomar.
      return { tipo: "inventario_insuficiente", nombrePlataforma: componente.nombrePlataforma };
    }
    bloqueos.push({
      componente,
      pantallas,
      fechaVencimiento: calcularVencimiento(fechaVenta, componente.cantidadDuracion, componente.unidadDuracion),
    });
  }

  const cuentaIds = [...new Set(bloqueos.flatMap((b) => b.pantallas.map((p) => p.cuentaId)))];
  const pantallaIds = bloqueos.flatMap((b) => b.pantallas.map((p) => p.id));
  const [cuentas, pantallasInfo] = await Promise.all([
    tx.cuenta.findMany({ where: { id: { in: cuentaIds } } }),
    tx.pantalla.findMany({ where: { id: { in: pantallaIds } } }),
  ]);
  const cuentaPorId = new Map(cuentas.map((c) => [c.id, c]));
  const pantallaPorId = new Map(pantallasInfo.map((p) => [p.id, p]));

  const fechaVencimientoMax = bloqueos.reduce(
    (max, b) => (b.fechaVencimiento > max ? b.fechaVencimiento : max),
    bloqueos[0].fechaVencimiento,
  );

  // Una venta mueve inventario y dinero; el mensaje es la entrega, pero
  // nunca el motivo para perder una venta. Si la empresa no configuró su
  // PlantillaMensaje para este tipo (debería estar sembrada al crear la
  // empresa — ver empresas.ts y el backfill de datos — pero puede faltar
  // en empresas antiguas o si alguien la borró a mano), se usa la
  // plantilla de respaldo incorporada en el código y se avisa después.
  const plantilla = await tx.plantillaMensaje.findFirst({ where: { tipo: entrada.tipoVenta } });
  const plantillaFaltante = !plantilla;
  const contenidoPlantilla =
    plantilla?.contenido ??
    (entrada.tipoVenta === "UNIDAD" ? PLANTILLA_RESPALDO_UNIDAD : PLANTILLA_RESPALDO_PAQUETE);

  // Piezas del mensaje que NO dependen del código de compra: se calculan una
  // sola vez, antes del lazo de reintento.
  const componentesMensaje: ComponenteMensajePaquete[] =
    entrada.tipoVenta === "PAQUETE"
      ? bloqueos.map(({ componente, pantallas }) => {
          const pantalla = pantallas[0];
          const cuenta = cuentaPorId.get(pantalla.cuentaId)!;
          const infoPantalla = pantallaPorId.get(pantalla.id)!;
          const plataformaInfo = plataformaInfoPorId.get(componente.plataformaId)!;
          return {
            nombrePlataforma: plataformaInfo.nombreMensaje ?? plataformaInfo.nombre,
            usaPerfilPin: plataformaInfo.usaPerfilPin,
            nombreDuracionReal: nombreDuracionPorId.get(componente.duracionId) ?? componente.nombrePlataforma,
            perfil: infoPantalla.perfil,
            pin: infoPantalla.pin ? descifrar(infoPantalla.pin) : null,
            correo: cuenta.correo,
            clave: descifrar(cuenta.password),
          };
        })
      : [];

  let ventaCreada: Venta | null = null;
  for (let intento = 0; intento < MAX_INTENTOS_CODIGO; intento++) {
    const codigoCompra = await generarCodigoCompra(tx, empresaId, empresa.prefijoCodigo);

    // Mismo punto de entrada que la vista previa de la pantalla de
    // plantillas (lib/mensaje-venta.ts): mismos datos, mismo texto.
    const mensajeGenerado =
      entrada.tipoVenta === "UNIDAD"
        ? (() => {
            const { componente, pantallas } = bloqueos[0];
            const pantalla = pantallas[0];
            const cuenta = cuentaPorId.get(pantalla.cuentaId)!;
            const infoPantalla = pantallaPorId.get(pantalla.id)!;
            const plataformaInfo = plataformaInfoPorId.get(componente.plataformaId)!;
            return renderizarMensajeDeVenta(contenidoPlantilla, {
              tipo: "UNIDAD",
              datos: {
                codigoCompra,
                fechaVenta,
                nombreTipoCliente: tipoCliente.nombre,
                nombreDuracion: duracionVendida.nombre,
                fechaVencimientoMax,
                precioVenta,
                nombrePlataformaMensaje: plataformaInfo.nombreMensaje ?? plataformaInfo.nombre,
                perfil: infoPantalla.perfil,
                pin: infoPantalla.pin ? descifrar(infoPantalla.pin) : null,
                correo: cuenta.correo,
                clave: descifrar(cuenta.password),
              },
            });
          })()
        : renderizarMensajeDeVenta(contenidoPlantilla, {
            tipo: "PAQUETE",
            datos: {
              codigoCompra,
              fechaVenta,
              nombreTipoCliente: tipoCliente.nombre,
              nombreDuracion: duracionVendida.nombre,
              fechaVencimientoMax,
              precioVenta,
              nombrePaquete: nombreItem,
              componentes: componentesMensaje,
            },
          });

    // SAVEPOINT: si `create()` choca contra la restricción única de
    // codigoCompra (P2002), Postgres marca TODA la transacción como
    // abortada ("current transaction is aborted, commands ignored until
    // end of transaction block") y cualquier consulta posterior —incluido
    // el `findUnique` del próximo intento de generarCodigoCompra— revienta
    // con un error distinto (25P02), aunque el P2002 ya se haya capturado
    // en JavaScript. Prisma no envuelve cada query en un SAVEPOINT
    // automáticamente dentro de una transacción interactiva. Sin este
    // SAVEPOINT explícito, el reintento de abajo nunca llega a ejecutarse
    // de verdad (verificado forzando la colisión en ventas.test.ts).
    await tx.$executeRaw`SAVEPOINT intento_codigo_compra`;
    try {
      ventaCreada = await tx.venta.create({
        data: datosSinEmpresa<Prisma.VentaUncheckedCreateInput>({
          vendedorId,
          codigoCompra,
          tipoVenta: entrada.tipoVenta,
          plataformaId: entrada.tipoVenta === "UNIDAD" ? entrada.plataformaId : null,
          paqueteId: entrada.tipoVenta === "PAQUETE" ? entrada.paqueteId : null,
          duracionId: duracionVendida.id,
          tipoClienteId: tipoCliente.id,
          nombreItem,
          nombreDuracion: duracionVendida.nombre,
          cantidadDuracion: duracionVendida.cantidad,
          unidadDuracion: duracionVendida.unidad,
          nombreTipoCliente: tipoCliente.nombre,
          precioVenta,
          costo,
          utilidad: precioVenta.minus(costo),
          fechaVenta,
          fechaVencimientoMax,
          mensajeGenerado,
        }),
      });
      await tx.$executeRaw`RELEASE SAVEPOINT intento_codigo_compra`;
      break;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        restriccionViolada(error).includes("codigoCompra")
      ) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT intento_codigo_compra`;
        continue;
      }
      throw error;
    }
  }

  if (!ventaCreada) {
    // No lleva empresaId ni ningún identificador interno: este mensaje
    // puede llegar sin más tratamiento hasta la respuesta HTTP.
    throw new Error(`No se pudo generar un código de compra único tras ${MAX_INTENTOS_CODIGO} intentos. Intenta de nuevo.`);
  }

  for (const { componente, pantallas, fechaVencimiento } of bloqueos) {
    for (const pantalla of pantallas) {
      const cuenta = cuentaPorId.get(pantalla.cuentaId)!;
      const infoPantalla = pantallaPorId.get(pantalla.id)!;
      await tx.ventaDetalle.create({
        data: datosSinEmpresa<Prisma.VentaDetalleUncheckedCreateInput>({
          ventaId: ventaCreada.id,
          pantallaId: pantalla.id,
          cuentaId: pantalla.cuentaId,
          plataformaId: componente.plataformaId,
          nombrePlataforma: componente.nombrePlataforma,
          correoCuenta: cuenta.correo,
          // Ya cifrados en BD (Cuenta.password / Pantalla.pin): se copian
          // tal cual, sin descifrar — la copia de R3 es del valor cifrado.
          passwordCuenta: cuenta.password,
          perfil: infoPantalla.perfil,
          pin: infoPantalla.pin,
          duracionId: componente.duracionId,
          cantidadDuracion: componente.cantidadDuracion,
          unidadDuracion: componente.unidadDuracion,
          fechaVencimiento,
        }),
      });
    }
  }

  return { tipo: "ok", venta: ventaCreada, plantillaFaltante };
}
