import { describe, expect, it } from "bun:test";
import { calcularVencimiento } from "./duracion";

describe("calcularVencimiento", () => {
  it("31 de enero + 1 mes = 28 de febrero (año no bisiesto)", () => {
    const resultado = calcularVencimiento(new Date(2025, 0, 31), 1, "MESES");
    expect(resultado).toEqual(new Date(2025, 1, 28));
  });

  it("31 de enero + 1 mes = 29 de febrero (año bisiesto)", () => {
    const resultado = calcularVencimiento(new Date(2024, 0, 31), 1, "MESES");
    expect(resultado).toEqual(new Date(2024, 1, 29));
  });

  it("31 de marzo + 1 mes = 30 de abril", () => {
    const resultado = calcularVencimiento(new Date(2025, 2, 31), 1, "MESES");
    expect(resultado).toEqual(new Date(2025, 3, 30));
  });

  it("15 de junio + 3 meses = 15 de septiembre", () => {
    const resultado = calcularVencimiento(new Date(2025, 5, 15), 3, "MESES");
    expect(resultado).toEqual(new Date(2025, 8, 15));
  });

  it("1 de enero + 12 meses = 1 de enero del año siguiente", () => {
    const resultado = calcularVencimiento(new Date(2025, 0, 1), 12, "MESES");
    expect(resultado).toEqual(new Date(2026, 0, 1));
  });

  it("DIAS suma días exactos", () => {
    const resultado = calcularVencimiento(new Date(2025, 0, 20), 14, "DIAS");
    expect(resultado).toEqual(new Date(2025, 1, 3));
  });

  it("DIAS cruza fin de mes sin ajustar", () => {
    const resultado = calcularVencimiento(new Date(2025, 0, 25), 28, "DIAS");
    expect(resultado).toEqual(new Date(2025, 1, 22));
  });
});
