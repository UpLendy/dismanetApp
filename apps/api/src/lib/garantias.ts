import { Prisma, type Garantia, type VentaDetalle } from "../generated/prisma/client.ts";
import { tomarPantallasDisponibles } from "./bloqueo-pantallas.ts";
import { datosSinEmpresa } from "./prisma-empresa.ts";
import { descifrar } from "./cifrado.ts";
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

  const [cuentaNueva, pantallaInfo, precio] = await Promise.all([
    tx.cuenta.findUniqueOrThrow({ where: { id: pantallaNueva.cuentaId } }),
    tx.pantalla.findUniqueOrThrow({ where: { id: pantallaNueva.id } }),
    tx.precio.findFirst({
      where: {
        plataformaId: original.plataformaId,
        duracionId: original.duracionId,
        tipoClienteId: original.venta.tipoClienteId,
        activo: true,
      },
    }),
  ]);
  // Hoy todos los costos están en cero (precio.costo = 0 por defecto); la
  // estructura queda lista para cuando el cliente cargue costos reales.
  const costoAsumido = precio?.costo ?? new Prisma.Decimal(0);

  const ventaDetalleReemplazo = await tx.ventaDetalle.create({
    data: datosSinEmpresa<Prisma.VentaDetalleUncheckedCreateInput>({
      ventaId: original.ventaId,
      pantallaId: pantallaNueva.id,
      cuentaId: pantallaNueva.cuentaId,
      plataformaId: original.plataformaId,
      nombrePlataforma: original.nombrePlataforma,
      correoCuenta: cuentaNueva.correo,
      // Ya cifrados en BD: se copian tal cual, igual que en una venta normal
      // (R3 — la copia es del valor cifrado, nunca del descifrado).
      passwordCuenta: cuentaNueva.password,
      perfil: pantallaInfo.perfil,
      pin: pantallaInfo.pin,
      duracionId: original.duracionId,
      cantidadDuracion: original.cantidadDuracion,
      unidadDuracion: original.unidadDuracion,
      // Hereda el vencimiento del original: no se recalcula (sección 3).
      fechaVencimiento: original.fechaVencimiento,
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
  cuentaNueva: { correo: string; password: string },
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
  const clave = descifrar(cuentaNueva.password);

  const cuerpo =
    venta.tipoVenta === "UNIDAD"
      ? renderizarMensajeDeVenta(contenidoPlantilla, {
          tipo: "UNIDAD",
          datos: {
            ...datosComunes,
            nombrePlataformaMensaje,
            usaPerfilPin: original.plataforma.usaPerfilPin,
            perfil,
            pin,
            correo,
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
                nombrePlataforma: nombrePlataformaMensaje,
                usaPerfilPin: original.plataforma.usaPerfilPin,
                nombreDuracionReal: original.duracion.nombre,
                perfil,
                pin,
                correo,
                clave,
              } satisfies ComponenteMensajePaquete,
            ],
          },
        });

  return `*Reemplazo de pantalla*\n\n${cuerpo}`;
}
