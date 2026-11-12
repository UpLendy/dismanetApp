import { describe, expect, it } from "bun:test";
import { festivosColombia } from "./festivos.ts";
import { inicioDeFechaBogota } from "./periodos.ts";

// Fechas verificadas contra fuente oficial (Ministerio del Interior /
// Función Pública) para 2025 y 2026, NO contra festivosColombia() — ver el
// comentario de cabecera de festivos.ts. 2026 incluye un festivo que la
// lista original de tres familias no tenía: la Ley 2578 de 2026 (sancionada
// el 1 de junio de 2026) agrega el 9 de julio (Virgen de Chiquinquirá,
// Emiliani) como cuarto festivo trasladable, observado el lunes 13 de julio
// de 2026. Antes de 2026 ese festivo no existía.

const FESTIVOS_2025: [string, string][] = [
  ["2025-01-01", "Año Nuevo"],
  ["2025-01-06", "Día de los Reyes Magos"],
  ["2025-03-24", "Día de San José"],
  ["2025-04-17", "Jueves Santo"],
  ["2025-04-18", "Viernes Santo"],
  ["2025-05-01", "Día del Trabajo"],
  ["2025-06-02", "Ascensión del Señor"],
  ["2025-06-23", "Corpus Christi"],
  ["2025-06-30", "San Pedro y San Pablo"],
  ["2025-06-30", "Sagrado Corazón de Jesús"],
  ["2025-07-20", "Día de la Independencia"],
  ["2025-08-07", "Batalla de Boyacá"],
  ["2025-08-18", "Asunción de la Virgen"],
  ["2025-10-13", "Día de la Raza"],
  ["2025-11-03", "Día de Todos los Santos"],
  ["2025-11-17", "Independencia de Cartagena"],
  ["2025-12-08", "Inmaculada Concepción"],
  ["2025-12-25", "Navidad"],
];

const FESTIVOS_2026: [string, string][] = [
  ["2026-01-01", "Año Nuevo"],
  ["2026-01-12", "Día de los Reyes Magos"],
  ["2026-03-23", "Día de San José"],
  ["2026-04-02", "Jueves Santo"],
  ["2026-04-03", "Viernes Santo"],
  ["2026-05-01", "Día del Trabajo"],
  ["2026-05-18", "Ascensión del Señor"],
  ["2026-06-08", "Corpus Christi"],
  ["2026-06-15", "Sagrado Corazón de Jesús"],
  ["2026-06-29", "San Pedro y San Pablo"],
  ["2026-07-13", "Día de Nuestra Señora del Rosario de Chiquinquirá"],
  ["2026-07-20", "Día de la Independencia"],
  ["2026-08-07", "Batalla de Boyacá"],
  ["2026-08-17", "Asunción de la Virgen"],
  ["2026-10-12", "Día de la Raza"],
  ["2026-11-02", "Día de Todos los Santos"],
  ["2026-11-16", "Independencia de Cartagena"],
  ["2026-12-08", "Inmaculada Concepción"],
  ["2026-12-25", "Navidad"],
];

function ordenar(lista: { fecha: string; nombre: string }[]) {
  return [...lista].sort((a, b) => (a.fecha === b.fecha ? a.nombre.localeCompare(b.nombre) : a.fecha.localeCompare(b.fecha)));
}

describe("festivosColombia — verificado contra fuente oficial, no contra la propia implementación", () => {
  it("2025: 18 festivos, fechas exactas (incluye la coincidencia San Pedro y San Pablo / Sagrado Corazón el mismo lunes 30 de junio)", () => {
    const calculados = festivosColombia(2025).map((f) => ({ fecha: f.fecha.toISOString(), nombre: f.nombre }));
    const esperados = FESTIVOS_2025.map(([fechaISO, nombre]) => ({
      fecha: inicioDeFechaBogota(fechaISO).toISOString(),
      nombre,
    }));
    expect(ordenar(calculados)).toEqual(ordenar(esperados));
  });

  it("2026: 19 festivos — los 18 de siempre más el cuarto Emiliani de la Ley 2578 de 2026 (Chiquinquirá, observado el lunes 13 de julio)", () => {
    const calculados = festivosColombia(2026).map((f) => ({ fecha: f.fecha.toISOString(), nombre: f.nombre }));
    const esperados = FESTIVOS_2026.map(([fechaISO, nombre]) => ({
      fecha: inicioDeFechaBogota(fechaISO).toISOString(),
      nombre,
    }));
    expect(ordenar(calculados)).toEqual(ordenar(esperados));
  });

  it("antes de 2026 el festivo de la Ley 2578 no existía: 2024 no incluye el 9 ni el 13 de julio", () => {
    const calculados2024 = festivosColombia(2024).map((f) => f.fecha.toISOString());
    expect(calculados2024).not.toContain(inicioDeFechaBogota("2024-07-09").toISOString());
    expect(calculados2024).not.toContain(inicioDeFechaBogota("2024-07-13").toISOString());
  });
});
