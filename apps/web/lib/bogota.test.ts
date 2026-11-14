import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { etiquetaDiaBogota } from "./bogota.ts";

describe("etiquetaDiaBogota", () => {
  let tzOriginal: string | undefined;

  // El bug solo se reproduce con el proceso en una zona de desplazamiento
  // negativo: "1 de noviembre" en UTC medianoche cae en "31 de octubre,
  // 19:00" en hora local de Bogotá. Con TZ=UTC (frecuente en CI) la
  // medianoche local coincide con la UTC y el bug queda invisible — por
  // eso la zona del proceso se fuerza aquí, no se deja al entorno.
  beforeAll(() => {
    tzOriginal = process.env.TZ;
    process.env.TZ = "America/Bogota";
  });

  afterAll(() => {
    process.env.TZ = tzOriginal;
  });

  it("el 1 de noviembre se etiqueta como 'nov', no como 'oct'", () => {
    // Mediodía en Bogotá del 1 de noviembre (no medianoche UTC): el día
    // calendario en Bogotá ya es inequívocamente el 1 de noviembre, así
    // que cualquier corrimiento a "oct." solo puede venir del paso de
    // formateo del nombre del mes, que es justo el que tenía el bug.
    expect(etiquetaDiaBogota("2026-11-01T17:00:00.000Z")).toBe("1 nov.");
  });
});
