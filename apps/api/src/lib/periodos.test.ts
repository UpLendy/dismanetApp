import { describe, expect, it } from "bun:test";
import { inicioDiaBogota, inicioMesBogota, inicioSemanaBogota } from "./periodos.ts";

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
});
