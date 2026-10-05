import { addDays, addMonths } from "date-fns";
import type { UnidadDuracion } from "../generated/prisma/enums.js";

/**
 * Calcula la fecha de vencimiento a partir de la fecha de venta.
 * MESES usa addMonths de date-fns, que recorta al último día del mes
 * destino cuando este es más corto (31 de enero + 1 mes = 28 de febrero).
 * No se implementa la suma de meses a mano (ver CLAUDE.md).
 */
export function calcularVencimiento(
  fechaVenta: Date,
  cantidad: number,
  unidad: UnidadDuracion,
): Date {
  return unidad === "DIAS"
    ? addDays(fechaVenta, cantidad)
    : addMonths(fechaVenta, cantidad);
}
