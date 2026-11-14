import { describe, expect, test } from "bun:test";
import { MAXIMO_TRAMOS, aplicarProgreso, fusionarTramos, recortarPorPresupuesto, segundosCubiertos, type EstadoVisualizacion } from "./visualizacion.ts";

function estado(parcial: Partial<EstadoVisualizacion>): EstadoVisualizacion {
  return {
    tramos: [],
    segundosVistos: 0,
    primerReporte: new Date("2026-01-01T00:00:00Z"),
    ultimoReporte: new Date("2026-01-01T00:00:00Z"),
    completadoEn: null,
    ...parcial,
  };
}

describe("fusionarTramos / segundosCubiertos", () => {
  test("tramos solapados se fusionan sin inflar segundosVistos", () => {
    const fusionados = fusionarTramos([
      [0, 100],
      [90, 200],
      [500, 600],
    ]);
    expect(fusionados).toEqual([
      [0, 200],
      [500, 600],
    ]);
    expect(segundosCubiertos(fusionados)).toBe(300);
  });

  test("tramos adyacentes también se fusionan", () => {
    expect(fusionarTramos([[0, 50], [50, 100]])).toEqual([[0, 100]]);
  });
});

describe("recortarPorPresupuesto", () => {
  test("reporte imposible: 600 segundos nuevos con solo 5 de reloj (presupuesto 10) se recorta a 10", () => {
    const hasta = recortarPorPresupuesto([], 0, 600, 10);
    expect(hasta).toBe(10);
  });

  test("un reporte que cabe en el presupuesto no se recorta", () => {
    expect(recortarPorPresupuesto([], 0, 8, 10)).toBe(8);
  });

  test("lo ya cubierto no consume presupuesto", () => {
    // [0,100] ya visto; pedir [0,200] con presupuesto 10 solo paga el hueco [100,200].
    expect(recortarPorPresupuesto([[0, 100]], 0, 200, 10)).toBe(110);
  });
});

describe("aplicarProgreso", () => {
  test("arrastrar al final: un solo reporte del último segundo no completa", () => {
    const resultado = aplicarProgreso({
      estadoPrevio: null,
      desde: 599,
      hasta: 600,
      ahora: new Date("2026-01-01T00:10:00Z"),
      duracionSegundos: 600,
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("unreachable");
    expect(resultado.cobertura).toBeLessThan(0.95);
    expect(resultado.estado.completadoEn).toBeNull();
  });

  test("reproducción normal simulada avanzando el reloj: completa", () => {
    const inicio = new Date("2026-01-01T00:00:00Z");
    const duracionSegundos = 60;

    // Primer reporte: cubre la primera mitad, tal como reportaría el
    // navegador tras ~10s de reproducción real (varios reportes de 10s).
    let resultado = aplicarProgreso({ estadoPrevio: null, desde: 0, hasta: 30, ahora: inicio, duracionSegundos });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("unreachable");

    // Avanza el reloj real ~55s (≥ 90% de 60s) y reporta el resto: dentro
    // del presupuesto (55s de reloj × 2 = 110s, más que suficiente para los
    // 30s nuevos).
    const luego = new Date(inicio.getTime() + 55_000);
    resultado = aplicarProgreso({ estadoPrevio: resultado.estado, desde: 30, hasta: 60, ahora: luego, duracionSegundos });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("unreachable");
    expect(resultado.cobertura).toBeGreaterThanOrEqual(0.95);
    expect(resultado.estado.completadoEn).not.toBeNull();
  });

  test("reporte imposible: pedir 600 segundos nuevos con 5 de reloj transcurrido se recorta y la cobertura lo refleja", () => {
    const inicio = new Date("2026-01-01T00:00:00Z");
    const previo = estado({ tramos: [[0, 1]], segundosVistos: 1, primerReporte: inicio, ultimoReporte: inicio });
    const ahora = new Date(inicio.getTime() + 5_000);

    const resultado = aplicarProgreso({ estadoPrevio: previo, desde: 1, hasta: 601, ahora, duracionSegundos: 600 });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("unreachable");
    // presupuesto = 5s × 2 = 10s nuevos; se acreditan 1 (previo) + 10 = 11.
    expect(resultado.estado.segundosVistos).toBe(11);
    expect(resultado.estado.completadoEn).toBeNull();
  });

  test("visualización en dos sesiones: primera mitad hoy, segunda al día siguiente, completa", () => {
    const dia1 = new Date("2026-01-01T00:00:00Z");
    let resultado = aplicarProgreso({ estadoPrevio: null, desde: 0, hasta: 50, ahora: dia1, duracionSegundos: 100 });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("unreachable");

    const dia2 = new Date(dia1.getTime() + 24 * 60 * 60 * 1000);
    resultado = aplicarProgreso({ estadoPrevio: resultado.estado, desde: 50, hasta: 100, ahora: dia2, duracionSegundos: 100 });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("unreachable");
    expect(resultado.cobertura).toBeGreaterThanOrEqual(0.95);
    // Un día entero de reloj transcurrido sobra para el 90% de tiempo real.
    expect(resultado.estado.completadoEn).not.toBeNull();
  });

  test("más de 50 tramos: el reporte se rechaza", () => {
    const tramos: [number, number][] = [];
    for (let i = 0; i < MAXIMO_TRAMOS; i++) tramos.push([i * 10, i * 10 + 1]);
    const previo = estado({ tramos, segundosVistos: segundosCubiertos(tramos) });

    // Un tramo nuevo que no se funde con ninguno de los 50 existentes.
    const resultado = aplicarProgreso({
      estadoPrevio: previo,
      desde: MAXIMO_TRAMOS * 10 + 5,
      hasta: MAXIMO_TRAMOS * 10 + 6,
      ahora: new Date(previo.ultimoReporte.getTime() + 60_000),
      duracionSegundos: 10_000,
    });
    expect(resultado.ok).toBe(false);
  });

  test("sin duracionSegundos, nunca completa aunque la cobertura reportada sea total", () => {
    const resultado = aplicarProgreso({
      estadoPrevio: null,
      desde: 0,
      hasta: 100,
      ahora: new Date("2026-01-01T00:00:00Z"),
      duracionSegundos: null,
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("unreachable");
    expect(resultado.estado.completadoEn).toBeNull();
  });
});
