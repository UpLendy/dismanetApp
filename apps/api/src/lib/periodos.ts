// Entrega 9, sección 1 — límites de "hoy / esta semana / este mes" para los
// totales del ADMIN. CLAUDE.md pide UTC en la base de datos y conversión a
// hora local solo en el frontend, pero el límite de un día de NEGOCIO (a
// qué hora empieza "hoy") sí depende de la zona horaria: sin esto, un
// servidor en UTC movería la frontera de "hoy" 5 horas, y las ventas de la
// noche aparecerían en el día equivocado. Colombia no tiene horario de
// verano, así que el desplazamiento es un número fijo.
const DESPLAZAMIENTO_BOGOTA_MS = 5 * 60 * 60 * 1000;

function comoWallClockBogota(fecha: Date): Date {
  return new Date(fecha.getTime() - DESPLAZAMIENTO_BOGOTA_MS);
}

function deWallClockBogotaAUtc(ficticio: Date): Date {
  return new Date(ficticio.getTime() + DESPLAZAMIENTO_BOGOTA_MS);
}

/** Instante UTC real que corresponde a la medianoche de Bogotá del día de `ahora`. */
export function inicioDiaBogota(ahora: Date): Date {
  const ficticio = comoWallClockBogota(ahora);
  ficticio.setUTCHours(0, 0, 0, 0);
  return deWallClockBogotaAUtc(ficticio);
}

/** Instante UTC real del lunes (medianoche, Bogotá) de la semana de `ahora`. */
export function inicioSemanaBogota(ahora: Date): Date {
  const ficticio = comoWallClockBogota(ahora);
  ficticio.setUTCHours(0, 0, 0, 0);
  const diaSemana = ficticio.getUTCDay(); // 0=domingo ... 6=sábado
  const diasDesdeLunes = (diaSemana + 6) % 7;
  ficticio.setUTCDate(ficticio.getUTCDate() - diasDesdeLunes);
  return deWallClockBogotaAUtc(ficticio);
}

/** Instante UTC real del día 1 (medianoche, Bogotá) del mes de `ahora`. */
export function inicioMesBogota(ahora: Date): Date {
  const ficticio = comoWallClockBogota(ahora);
  ficticio.setUTCHours(0, 0, 0, 0);
  ficticio.setUTCDate(1);
  return deWallClockBogotaAUtc(ficticio);
}

/** Instante UTC real de la medianoche siguiente a "hoy" en Bogotá (límite exclusivo). */
export function finDiaBogota(ahora: Date): Date {
  return new Date(inicioDiaBogota(ahora).getTime() + 24 * 60 * 60 * 1000);
}

/** Instante UTC real del lunes siguiente a la semana de `ahora`, medianoche Bogotá (límite exclusivo). */
export function finSemanaBogota(ahora: Date): Date {
  return new Date(inicioSemanaBogota(ahora).getTime() + 7 * 24 * 60 * 60 * 1000);
}

/**
 * Instante UTC real del día 1 (medianoche, Bogotá) del mes siguiente al de
 * `ahora` (límite exclusivo). Los meses no tienen duración fija en
 * milisegundos, así que esto no puede ser una suma de horas como
 * finDiaBogota/finSemanaBogota — se avanza por campo de mes con setUTCMonth,
 * igual que date-fns addMonths, nunca a mano en milisegundos.
 */
export function finMesBogota(ahora: Date): Date {
  const ficticio = comoWallClockBogota(ahora);
  ficticio.setUTCHours(0, 0, 0, 0);
  ficticio.setUTCDate(1);
  ficticio.setUTCMonth(ficticio.getUTCMonth() + 1);
  return deWallClockBogotaAUtc(ficticio);
}

/** Instante UTC real del día 1 (medianoche, Bogotá) del mes anterior al de `ahora`. */
export function inicioMesAnteriorBogota(ahora: Date): Date {
  const ficticio = comoWallClockBogota(ahora);
  ficticio.setUTCHours(0, 0, 0, 0);
  ficticio.setUTCDate(1);
  ficticio.setUTCMonth(ficticio.getUTCMonth() - 1);
  return deWallClockBogotaAUtc(ficticio);
}

/**
 * Instante UTC real de la medianoche (Bogotá) del día calendario `fechaISO`
 * ("YYYY-MM-DD", el formato que entrega un <input type="date">). Límite
 * inicial (inclusivo) de un rango libre.
 */
export function inicioDeFechaBogota(fechaISO: string): Date {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const ficticio = new Date(0);
  ficticio.setUTCFullYear(anio, mes - 1, dia);
  ficticio.setUTCHours(0, 0, 0, 0);
  return deWallClockBogotaAUtc(ficticio);
}

/**
 * Instante UTC real de la medianoche (Bogotá) siguiente al día calendario
 * `fechaISO`. Límite final (exclusivo) de un rango libre: un "hasta" de
 * rango libre incluye todo ese día.
 */
export function finDeFechaBogota(fechaISO: string): Date {
  return new Date(inicioDeFechaBogota(fechaISO).getTime() + 24 * 60 * 60 * 1000);
}
