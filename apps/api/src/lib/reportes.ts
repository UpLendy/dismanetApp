import { inicioSemanaBogota } from "./periodos.ts";

const MS_SEMANA = 7 * 24 * 60 * 60 * 1000;

/**
 * Editable si `semanaInicio` es la semana actual o la inmediatamente
 * anterior a `ahora` (F6.4, parte 2): la gente escribe el lunes sobre la
 * semana que terminó, pero dejar editar cualquier semana convierte el
 * histórico en algo que se rellena a última hora. Ambos parámetros son
 * instantes absolutos; la comparación es por el lunes 00:00 Bogotá que les
 * corresponde (inicioSemanaBogota ya resuelve esa conversión).
 */
export function esSemanaEditable(semanaInicio: Date, ahora: Date): boolean {
  const diferencia = inicioSemanaBogota(ahora).getTime() - semanaInicio.getTime();
  return diferencia === 0 || diferencia === MS_SEMANA;
}

/** Un reporte completamente vacío equivale a no haber reportado (400 REPORTE_VACIO). */
export function reporteVacio(pendientes: string, fallas: string, oportunidades: string): boolean {
  return pendientes.trim() === "" && fallas.trim() === "" && oportunidades.trim() === "";
}
