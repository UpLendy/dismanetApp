import { describe, expect, it } from "bun:test";
import {
  inicioDiaBogota,
  inicioMesBogota,
  inicioSemanaBogota,
  finDiaBogota,
  finSemanaBogota,
  finMesBogota,
  inicioMesAnteriorBogota,
  inicioDeFechaBogota,
  finDeFechaBogota,
} from "./periodos.ts";

describe("periodos — límites de hoy/semana/mes en hora de Bogotá (UTC-5)", () => {
  it("inicioDiaBogota: 03:00 UTC del 2 de octubre es 22:00 del 1 en Bogotá, así que el día sigue siendo el 1", () => {
    const ahora = new Date("2026-10-02T03:00:00.000Z");
    expect(inicioDiaBogota(ahora).toISOString()).toBe("2026-10-01T05:00:00.000Z");
  });

  it("inicioDiaBogota: 05:00 UTC en punto ya es medianoche en Bogotá, el día cambia", () => {
    const ahora = new Date("2026-10-02T05:00:00.000Z");
    expect(inicioDiaBogota(ahora).toISOString()).toBe("2026-10-02T05:00:00.000Z");
  });

  it("inicioSemanaBogota: un jueves retrocede al lunes de esa semana", () => {
    // 2026-10-01 es jueves en Bogotá (ahora - 5h sigue siendo jueves 1).
    const ahora = new Date("2026-10-01T12:00:00.000Z");
    expect(inicioSemanaBogota(ahora).toISOString()).toBe("2026-09-28T05:00:00.000Z");
  });

  it("inicioSemanaBogota: un domingo retrocede al lunes anterior, no se queda en el mismo día", () => {
    // 2026-10-04 es domingo en Bogotá.
    const ahora = new Date("2026-10-04T12:00:00.000Z");
    expect(inicioSemanaBogota(ahora).toISOString()).toBe("2026-09-28T05:00:00.000Z");
  });

  it("inicioMesBogota: cualquier día del mes retrocede al día 1, medianoche Bogotá", () => {
    const ahora = new Date("2026-10-15T23:00:00.000Z");
    expect(inicioMesBogota(ahora).toISOString()).toBe("2026-10-01T05:00:00.000Z");
  });

  it("finDiaBogota: una venta a las 23:00 Bogotá (04:00 UTC del día siguiente) del último día del mes sigue cayendo antes del límite de ese mismo día", () => {
    // 2026-10-31 23:00 Bogotá = 2026-11-01T04:00:00.000Z.
    const ventaDeLasOnceDeLaNoche = new Date("2026-11-01T04:00:00.000Z");
    const ahora = new Date("2026-10-31T12:00:00.000Z"); // mismo día calendario en Bogotá
    expect(ventaDeLasOnceDeLaNoche.getTime() < finDiaBogota(ahora).getTime()).toBe(true);
    expect(ventaDeLasOnceDeLaNoche.getTime() >= inicioDiaBogota(ahora).getTime()).toBe(true);
  });

  it("finSemanaBogota: una semana después del inicio, en el instante exacto del próximo lunes", () => {
    const ahora = new Date("2026-10-01T12:00:00.000Z");
    expect(finSemanaBogota(ahora).toISOString()).toBe("2026-10-05T05:00:00.000Z");
  });

  it("finMesBogota: el 1 del mes siguiente, medianoche Bogotá — no es una suma fija de milisegundos (los meses no duran lo mismo)", () => {
    const octubre = new Date("2026-10-15T12:00:00.000Z");
    expect(finMesBogota(octubre).toISOString()).toBe("2026-11-01T05:00:00.000Z");

    // Febrero (28 días en 2026, no bisiesto) vs. octubre (31 días): si
    // finMesBogota sumara milisegundos fijos, esta prueba fallaría.
    const febrero = new Date("2026-02-10T12:00:00.000Z");
    expect(finMesBogota(febrero).toISOString()).toBe("2026-03-01T05:00:00.000Z");
  });

  it("inicioMesAnteriorBogota: retrocede un mes completo, incluso cruzando de enero a diciembre del año anterior", () => {
    const octubre = new Date("2026-10-15T12:00:00.000Z");
    expect(inicioMesAnteriorBogota(octubre).toISOString()).toBe("2026-09-01T05:00:00.000Z");

    const enero = new Date("2026-01-15T12:00:00.000Z");
    expect(inicioMesAnteriorBogota(enero).toISOString()).toBe("2025-12-01T05:00:00.000Z");
  });

  it("inicioDeFechaBogota/finDeFechaBogota: un rango libre 'desde=2026-10-15&hasta=2026-10-15' cubre el día completo en Bogotá, no en UTC", () => {
    expect(inicioDeFechaBogota("2026-10-15").toISOString()).toBe("2026-10-15T05:00:00.000Z");
    expect(finDeFechaBogota("2026-10-15").toISOString()).toBe("2026-10-16T05:00:00.000Z");

    // Una venta a las 23:30 Bogotá del 15 (04:30 UTC del 16) queda dentro
    // del rango [inicioDeFechaBogota("2026-10-15"), finDeFechaBogota("2026-10-15")).
    const ventaTardia = new Date("2026-10-16T04:30:00.000Z");
    expect(ventaTardia.getTime() >= inicioDeFechaBogota("2026-10-15").getTime()).toBe(true);
    expect(ventaTardia.getTime() < finDeFechaBogota("2026-10-15").getTime()).toBe(true);
  });
});
