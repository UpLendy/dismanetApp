// ---------------------------------------------------------------------------
// F6.2 — Calendario laboral. Las horas de este archivo son el denominador
// del reparto de comisiones (entrega futura): un error aquí es un error de
// plata después. `inicio`/`fin` de un Turno son siempre instantes absolutos
// (Date), nunca fecha + hora separadas — ver CLAUDE.md R5 y el comentario
// del modelo Turno en prisma/schema.prisma.
// ---------------------------------------------------------------------------

const DURACION_MAXIMA_MS = 24 * 60 * 60 * 1000;

export type ValidacionTurno =
  | { valido: true }
  | { valido: false; codigo: "FIN_ANTES_DE_INICIO" | "DURACION_MAXIMA"; mensaje: string };

/** `fin > inicio`, siempre, y la duración no puede superar 24 horas. */
export function validarRangoTurno(inicio: Date, fin: Date): ValidacionTurno {
  if (fin.getTime() <= inicio.getTime()) {
    return {
      valido: false,
      codigo: "FIN_ANTES_DE_INICIO",
      mensaje: "El fin del turno debe ser posterior al inicio.",
    };
  }
  if (fin.getTime() - inicio.getTime() > DURACION_MAXIMA_MS) {
    return {
      valido: false,
      codigo: "DURACION_MAXIMA",
      mensaje: "Un turno no puede durar más de 24 horas.",
    };
  }
  return { valido: true };
}

export interface TurnoSolapado {
  id: string;
  inicio: Date;
  fin: Date;
}

interface DelegadoTurno {
  findFirst(args: unknown): Promise<TurnoSolapado | null>;
}

/**
 * Busca un turno del mismo usuario que se solape con [inicio, fin). Dos
 * turnos se solapan si uno empieza antes de que el otro termine Y termina
 * después de que el otro empieza — la prueba estándar de intervalos. Debe
 * llamarse con el `usuarioId` ya bloqueado (ver bloqueo-usuario.ts) para que
 * dos peticiones simultáneas no lean ambas "libre" antes de que la otra
 * inserte. `excluirId` se usa al editar un turno, para no chocar contra sí
 * mismo.
 */
export async function buscarTurnoSolapado(
  cliente: { turno: DelegadoTurno },
  usuarioId: string,
  inicio: Date,
  fin: Date,
  excluirId?: string,
): Promise<TurnoSolapado | null> {
  return cliente.turno.findFirst({
    where: {
      usuarioId,
      inicio: { lt: fin },
      fin: { gt: inicio },
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
    select: { id: true, inicio: true, fin: true },
  });
}

interface TurnoParaHoras {
  usuarioId: string;
  inicio: Date;
  fin: Date;
}

/**
 * Horas por usuario dentro de [desde, hasta), recortadas al rango: un turno
 * de 22:00 a 06:00 consultado por días separados aporta 2 horas a uno y 6 al
 * otro, nunca las 8 completas a uno solo. Recibe los turnos que YA se
 * trajeron con un filtro de solapamiento (inicio < hasta AND fin > desde) —
 * esta función solo recorta y suma, no decide qué turnos entran.
 */
export function horasRecortadasPorUsuario(
  turnos: TurnoParaHoras[],
  desde: Date,
  hasta: Date,
): Map<string, number> {
  const resultado = new Map<string, number>();
  for (const turno of turnos) {
    const inicioRecortado = turno.inicio < desde ? desde : turno.inicio;
    const finRecortado = turno.fin > hasta ? hasta : turno.fin;
    const horas = Math.max(0, finRecortado.getTime() - inicioRecortado.getTime()) / (60 * 60 * 1000);
    resultado.set(turno.usuarioId, (resultado.get(turno.usuarioId) ?? 0) + horas);
  }
  return resultado;
}

/** `true` si existe, en `turnos`, alguno con `inicio <= ahora < fin`. */
export function estaEnTurnoAhora(turnos: { inicio: Date; fin: Date }[], ahora: Date): boolean {
  return turnos.some((turno) => turno.inicio.getTime() <= ahora.getTime() && ahora.getTime() < turno.fin.getTime());
}
