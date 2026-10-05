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
