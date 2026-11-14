/**
 * Conversión entre hora local de Bogotá y los instantes absolutos (UTC)
 * que esperan los formularios de turnos y horas adicionales. Bogotá no
 * tiene horario de verano: el desplazamiento es un número fijo, igual que
 * en apps/api/src/lib/periodos.ts.
 */
const DESPLAZAMIENTO_BOGOTA_MS = 5 * 60 * 60 * 1000;

export function hoyBogotaISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

export function fechaBogotaDeInstante(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date(iso));
}

export function horaBogotaDeInstante(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** Suma días de calendario a una fecha "YYYY-MM-DD" — aritmética de fecha, no de zona horaria. */
export function sumarDiasISO(fechaISO: string, dias: number): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const utc = new Date(Date.UTC(anio, mes - 1, dia + dias));
  return utc.toISOString().slice(0, 10);
}

/** "DD mon" (Bogotá) de un instante ISO — para tablas de comisiones por día. */
export function etiquetaDiaBogota(iso: string): string {
  const fecha = fechaBogotaDeInstante(iso);
  const [, mes, dia] = fecha.split("-").map(Number);
  const nombreMes = new Date(Date.UTC(2000, mes - 1, 1)).toLocaleDateString("es-CO", { month: "short" });
  return `${dia} ${nombreMes}`;
}

/** Hora de Bogotá (HH:mm) + fecha de calendario (Bogotá) -> instante UTC absoluto. */
export function bogotaAInstanteUTC(fechaISO: string, horaHHmm: string): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const [h, m] = horaHHmm.split(":").map(Number);
  const ficticio = Date.UTC(anio, mes - 1, dia, h, m, 0, 0);
  return new Date(ficticio + DESPLAZAMIENTO_BOGOTA_MS).toISOString();
}
