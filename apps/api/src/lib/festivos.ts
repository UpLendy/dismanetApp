import { addDays } from "date-fns";
import { inicioDeFechaBogota } from "./periodos.ts";

// ---------------------------------------------------------------------------
// F6.2 — Festivos colombianos. Tres familias (Ley 51 de 1983, "Ley
// Emiliani", y el calendario litúrgico):
//
// 1. FIJOS: nunca se mueven, caigan en el día que caigan.
// 2. EMILIANI: si no caen lunes, se trasladan al lunes siguiente.
// 3. PASCUA: derivados del Domingo de Pascua (Computus). Jueves y Viernes
//    Santo NO se trasladan; Ascensión, Corpus Christi y Sagrado Corazón SÍ,
//    al lunes siguiente (son además parte de la Ley Emiliani).
//
// Verificado contra fuentes de prensa/gobierno para 2025 y 2026 (no contra
// esta misma implementación): los festivos y sus fechas exactas de ambos
// años coinciden con lo calculado aquí. Ver festivos.test.ts.
//
// EXCEPCIÓN CONFIRMADA — Ley 2578 de 2026 (sancionada el 1 de junio de
// 2026) crea un CUARTO festivo Emiliani que NO estaba en las tres familias
// originales: el 9 de julio, Día de Nuestra Señora del Rosario de
// Chiquinquirá, trasladable al lunes siguiente igual que los demás
// Emiliani (en 2026 cae lunes 13 de julio). Por ser una ley de 2026, solo
// aplica desde ese año en adelante — para años anteriores no existía como
// festivo nacional. Si la Corte Constitucional la suspende, este archivo
// deja de generarlo a partir del año en que deje de aplicar (ajustar
// FESTIVOS_EMILIANI_DESDE_2026 aquí, no en otro archivo).
// ---------------------------------------------------------------------------

interface FechaCalendario {
  anio: number;
  mes: number; // 1-12
  dia: number;
}

interface FestivoBase {
  nombre: string;
  mes: number;
  dia: number;
}

const FESTIVOS_FIJOS: FestivoBase[] = [
  { nombre: "Año Nuevo", mes: 1, dia: 1 },
  { nombre: "Día del Trabajo", mes: 5, dia: 1 },
  { nombre: "Día de la Independencia", mes: 7, dia: 20 },
  { nombre: "Batalla de Boyacá", mes: 8, dia: 7 },
  { nombre: "Inmaculada Concepción", mes: 12, dia: 8 },
  { nombre: "Navidad", mes: 12, dia: 25 },
];

const FESTIVOS_EMILIANI: FestivoBase[] = [
  { nombre: "Día de los Reyes Magos", mes: 1, dia: 6 },
  { nombre: "Día de San José", mes: 3, dia: 19 },
  { nombre: "San Pedro y San Pablo", mes: 6, dia: 29 },
  { nombre: "Asunción de la Virgen", mes: 8, dia: 15 },
  { nombre: "Día de la Raza", mes: 10, dia: 12 },
  { nombre: "Día de Todos los Santos", mes: 11, dia: 1 },
  { nombre: "Independencia de Cartagena", mes: 11, dia: 11 },
];

// Ley 2578 de 2026 — ver comentario de cabecera. Solo desde 2026.
const FESTIVOS_EMILIANI_DESDE_2026: FestivoBase = {
  nombre: "Día de Nuestra Señora del Rosario de Chiquinquirá",
  mes: 7,
  dia: 9,
};

// Offsets en días desde el Domingo de Pascua. Jueves/Viernes Santo no se
// trasladan; los otros tres sí (y son Emiliani).
const JUEVES_SANTO_OFFSET = -3;
const VIERNES_SANTO_OFFSET = -2;
const ASCENSION_OFFSET = 39;
const CORPUS_CHRISTI_OFFSET = 60;
const SAGRADO_CORAZON_OFFSET = 68;

/**
 * Domingo de Pascua (calendario gregoriano) para `anio`, algoritmo de
 * Meeus/Jones/Butcher (Computus). Verificado contra fuente oficial para
 * 2025 (20 de abril) y 2026 (5 de abril) — ver festivos.test.ts.
 */
function domingoDePascua(anio: number): FechaCalendario {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { anio, mes, dia };
}

// Aritmética de calendario pura (día-de-semana, sumar días): no es la
// conversión instante<->hora-Bogotá que CLAUDE.md pide dejar en
// lib/periodos.ts, así que no aplica esa regla — esto solo decide QUÉ fecha
// de calendario es el festivo. La conversión final a instante UTC real pasa
// siempre por inicioDeFechaBogota, nunca a mano.
function sumarDiasCalendario(fecha: FechaCalendario, delta: number): FechaCalendario {
  const utc = new Date(Date.UTC(fecha.anio, fecha.mes - 1, fecha.dia));
  const resultado = addDays(utc, delta);
  return { anio: resultado.getUTCFullYear(), mes: resultado.getUTCMonth() + 1, dia: resultado.getUTCDate() };
}

function diaDeLaSemana(fecha: FechaCalendario): number {
  return new Date(Date.UTC(fecha.anio, fecha.mes - 1, fecha.dia)).getUTCDay(); // 0=domingo ... 6=sábado
}

/** Ley Emiliani: si no cae lunes, se traslada al lunes siguiente. */
function trasladarALunesSiguiente(fecha: FechaCalendario): FechaCalendario {
  const diasHastaLunes = (1 - diaDeLaSemana(fecha) + 7) % 7;
  return diasHastaLunes === 0 ? fecha : sumarDiasCalendario(fecha, diasHastaLunes);
}

function fechaISO(fecha: FechaCalendario): string {
  return `${fecha.anio.toString().padStart(4, "0")}-${fecha.mes.toString().padStart(2, "0")}-${fecha.dia.toString().padStart(2, "0")}`;
}

export interface FestivoCalculado {
  fecha: Date;
  nombre: string;
}

/** Festivos colombianos de `anio`, en instante UTC real (medianoche Bogotá). */
export function festivosColombia(anio: number): FestivoCalculado[] {
  const resultado: FestivoCalculado[] = [];

  for (const base of FESTIVOS_FIJOS) {
    resultado.push({ fecha: inicioDeFechaBogota(fechaISO({ anio, mes: base.mes, dia: base.dia })), nombre: base.nombre });
  }

  const emilianiFijos = anio >= 2026 ? [...FESTIVOS_EMILIANI, FESTIVOS_EMILIANI_DESDE_2026] : FESTIVOS_EMILIANI;
  for (const base of emilianiFijos) {
    const trasladado = trasladarALunesSiguiente({ anio, mes: base.mes, dia: base.dia });
    resultado.push({ fecha: inicioDeFechaBogota(fechaISO(trasladado)), nombre: base.nombre });
  }

  const pascua = domingoDePascua(anio);
  resultado.push({ fecha: inicioDeFechaBogota(fechaISO(sumarDiasCalendario(pascua, JUEVES_SANTO_OFFSET))), nombre: "Jueves Santo" });
  resultado.push({ fecha: inicioDeFechaBogota(fechaISO(sumarDiasCalendario(pascua, VIERNES_SANTO_OFFSET))), nombre: "Viernes Santo" });

  for (const [offset, nombre] of [
    [ASCENSION_OFFSET, "Ascensión del Señor"],
    [CORPUS_CHRISTI_OFFSET, "Corpus Christi"],
    [SAGRADO_CORAZON_OFFSET, "Sagrado Corazón de Jesús"],
  ] as const) {
    const trasladado = trasladarALunesSiguiente(sumarDiasCalendario(pascua, offset));
    resultado.push({ fecha: inicioDeFechaBogota(fechaISO(trasladado)), nombre });
  }

  return resultado.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
}
