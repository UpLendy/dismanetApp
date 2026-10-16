import type { Prisma } from "../generated/prisma/client.ts";

// Script de reparación, uno-solo-vez ("camino del dinero", punto 7) — NO es
// una migración de esquema ni un endpoint. Corrige un error de REGISTRO, no
// reescribe un hecho histórico: las ventas con costo = 0 no tuvieron costo
// cero, tuvieron costo DESCONOCIDO (CostoPlataforma no existía todavía
// cuando se vendieron). Esta es una excepción explícita y acotada a R3
// (CLAUDE.md), registrada con fecha bajo esa regla — no un precedente para
// reescribir el histórico en general.
//
// Importante — esto NO es una recuperación real del costo histórico: el
// costo que se usa es el de HOY (CostoPlataforma vigente), no el que de
// verdad tenía la plataforma el día de cada venta antigua, porque ese dato
// nunca se cargó. Es una aproximación, y el reporte lo dice explícitamente.
//
// Solo toca Venta con costo = 0. Nunca una que ya tenga costo real (aunque
// sea parcial, ver lib/paquetes.ts) — "costo real" incluye un costo parcial
// registrado al momento de la venta.
//
// Idempotente por construcción: una vez reparada, costo deja de ser 0 y la
// venta sale del filtro — correr esto dos veces con --aplicar no cambia nada
// la segunda vez.
type ClienteEmpresa = Prisma.TransactionClient;

export interface FilaReparada {
  ventaId: string;
  codigoCompra: string;
  fechaVenta: Date;
  costoAntes: string;
  costoDespues: string;
  utilidadAntes: string;
  utilidadDespues: string;
}

export interface VentaNoDeterminable {
  ventaId: string;
  codigoCompra: string;
  fechaVenta: Date;
  motivo: string;
}

export interface ReporteReparacionCostos {
  reparadas: FilaReparada[];
  noDeterminables: VentaNoDeterminable[];
}

export async function repararCostosHistoricosDeEmpresa(
  cliente: ClienteEmpresa,
  opciones: { aplicar: boolean },
): Promise<ReporteReparacionCostos> {
  const ventas = await cliente.venta.findMany({
    // F4.8 — una venta esExterna tiene costo = 0 A PROPÓSITO (no es un costo
    // desconocido): sostiene el VentaDetalle de una garantía externa, y su
    // pérdida real ya vive en Garantia.costoAsumido. Repararla aquí la
    // contaría dos veces.
    where: { costo: 0, esExterna: false },
    include: { detalles: { select: { plataformaId: true, duracionId: true, nombrePlataforma: true } } },
  });
  if (ventas.length === 0) return { reparadas: [], noDeterminables: [] };

  const plataformaIds = new Set<string>();
  for (const venta of ventas) {
    if (venta.plataformaId) plataformaIds.add(venta.plataformaId);
    for (const detalle of venta.detalles) plataformaIds.add(detalle.plataformaId);
  }
  const costos = await cliente.costoPlataforma.findMany({
    where: { plataformaId: { in: [...plataformaIds] } },
    select: { plataformaId: true, duracionId: true, costo: true },
  });
  const costoPorClave = new Map(costos.map((c) => [`${c.plataformaId}|${c.duracionId}`, c.costo]));

  const reparadas: FilaReparada[] = [];
  const noDeterminables: VentaNoDeterminable[] = [];

  for (const venta of ventas) {
    let costoNuevo: Prisma.Decimal | null = null;
    let motivoNoDeterminable: string | null = null;

    if (venta.tipoVenta === "UNIDAD") {
      const costo = venta.plataformaId ? costoPorClave.get(`${venta.plataformaId}|${venta.duracionId}`) : undefined;
      if (costo === undefined) {
        motivoNoDeterminable = `Sin CostoPlataforma para ${venta.nombreItem} / ${venta.nombreDuracion}.`;
      } else {
        costoNuevo = costo;
      }
    } else {
      // PAQUETE/PROMOCIÓN: desde lo que de verdad se entregó (VentaDetalle),
      // no desde la composición ACTUAL del paquete, que puede haber
      // cambiado desde que se vendió.
      if (venta.detalles.length === 0) {
        motivoNoDeterminable = "La venta no tiene renglones de VentaDetalle.";
      } else {
        const faltantes: string[] = [];
        let total: Prisma.Decimal | undefined = undefined;
        for (const detalle of venta.detalles) {
          const costo = costoPorClave.get(`${detalle.plataformaId}|${detalle.duracionId}`);
          if (costo === undefined) {
            faltantes.push(detalle.nombrePlataforma);
          } else {
            total = total === undefined ? costo : total.plus(costo);
          }
        }
        if (faltantes.length > 0) {
          motivoNoDeterminable = `Sin CostoPlataforma para: ${[...new Set(faltantes)].join(", ")}.`;
        } else {
          costoNuevo = total ?? null;
        }
      }
    }

    if (costoNuevo === null) {
      noDeterminables.push({
        ventaId: venta.id,
        codigoCompra: venta.codigoCompra,
        fechaVenta: venta.fechaVenta,
        motivo: motivoNoDeterminable ?? "No se pudo determinar el costo.",
      });
      continue;
    }

    const utilidadNueva = venta.precioVenta.minus(costoNuevo);
    reparadas.push({
      ventaId: venta.id,
      codigoCompra: venta.codigoCompra,
      fechaVenta: venta.fechaVenta,
      costoAntes: venta.costo.toString(),
      costoDespues: costoNuevo.toString(),
      utilidadAntes: venta.utilidad.toString(),
      utilidadDespues: utilidadNueva.toString(),
    });

    if (opciones.aplicar) {
      await cliente.venta.update({
        where: { id: venta.id },
        data: { costo: costoNuevo, utilidad: utilidadNueva },
      });
    }
  }

  return { reparadas, noDeterminables };
}
