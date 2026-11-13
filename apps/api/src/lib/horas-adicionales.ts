import { esDomingoBogota } from "./periodos.ts";
import { repartirPorDiaBogota } from "./turnos.ts";

// ---------------------------------------------------------------------------
// F6.3 — Horas adicionales y festivas. ES UN REGISTRO, NO UNA NÓMINA
// (PROMPT-F6.3 parte 0.1): nada aquí calcula recargo legal ni clasifica
// jornada nocturna. Lo único que se clasifica es si el día cae festivo o
// domingo, con datos propios (tabla Festivo) — nunca un horario fijado de
// memoria.
// ---------------------------------------------------------------------------

const DURACION_MAXIMA_MS = 24 * 60 * 60 * 1000;

export type ValidacionHoraAdicional =
  | { valido: true }
  | { valido: false; codigo: "FIN_ANTES_DE_INICIO" | "DURACION_MAXIMA"; mensaje: string };

/** `fin > inicio`, siempre, y la duración no puede superar 24 horas. Mismos límites que Turno. */
export function validarRangoHoraAdicional(inicio: Date, fin: Date): ValidacionHoraAdicional {
  if (fin.getTime() <= inicio.getTime()) {
    return {
      valido: false,
      codigo: "FIN_ANTES_DE_INICIO",
      mensaje: "El fin del bloque debe ser posterior al inicio.",
    };
  }
  if (fin.getTime() - inicio.getTime() > DURACION_MAXIMA_MS) {
    return {
      valido: false,
      codigo: "DURACION_MAXIMA",
      mensaje: "Un bloque de horas adicionales no puede durar más de 24 horas.",
    };
  }
  return { valido: true };
}

export interface HoraAdicionalSolapada {
  id: string;
  inicio: Date;
  fin: Date;
}

interface DelegadoHoraAdicional {
  findFirst(args: unknown): Promise<HoraAdicionalSolapada | null>;
}

/**
 * Busca, del mismo usuario, una HoraAdicional que no esté RECHAZADA y se
 * solape con [inicio, fin) — una rechazada ya no cuenta, es como si no
 * existiera. Debe llamarse con el usuarioId ya bloqueado (bloqueo-usuario.ts,
 * bloquearUsuarioParaTurno) por la misma razón que buscarTurnoSolapado:
 * sin eso, dos envíos simultáneos leen ambos "libre" e insertan solapado.
 * `excluirId` se usa al editar, para no chocar contra sí misma.
 */
export async function buscarHoraAdicionalSolapada(
  cliente: { horaAdicional: DelegadoHoraAdicional },
  usuarioId: string,
  inicio: Date,
  fin: Date,
  excluirId?: string,
): Promise<HoraAdicionalSolapada | null> {
  return cliente.horaAdicional.findFirst({
    where: {
      usuarioId,
      estado: { not: "RECHAZADA" },
      inicio: { lt: fin },
      fin: { gt: inicio },
      ...(excluirId ? { id: { not: excluirId } } : {}),
    },
    select: { id: true, inicio: true, fin: true },
  });
}

export interface ResumenHoras {
  ordinarias: number;
  dominicalesFestivas: number;
}

/**
 * Clasifica [inicio, fin) en horas ordinarias vs. dominicales/festivas,
 * repartiendo primero por día calendario de Bogotá (repartirPorDiaBogota,
 * lib/turnos.ts) porque un bloque puede cruzar de un día ordinario a uno
 * festivo o de un sábado a un domingo. `fechasFestivas` son los
 * `.getTime()` de Festivo.fecha (medianoche Bogotá) de la empresa, para el
 * rango relevante — se pasa ya armado para no repetir la consulta por cada
 * bloque al construir un resumen de varios.
 */
export function clasificarHorasPorDia(
  inicio: Date,
  fin: Date,
  fechasFestivas: Set<number>,
): ResumenHoras {
  const resultado: ResumenHoras = { ordinarias: 0, dominicalesFestivas: 0 };
  for (const dia of repartirPorDiaBogota(inicio, fin)) {
    const esFestivoODomingo = fechasFestivas.has(dia.fecha.getTime()) || esDomingoBogota(dia.fecha);
    if (esFestivoODomingo) {
      resultado.dominicalesFestivas += dia.horas;
    } else {
      resultado.ordinarias += dia.horas;
    }
  }
  return resultado;
}
