import { describe, expect, it } from "bun:test";
import { fechaEnLetras } from "./fecha-en-letras";

const DIAS = [
  "Uno",
  "Dos",
  "Tres",
  "Cuatro",
  "Cinco",
  "Seis",
  "Siete",
  "Ocho",
  "Nueve",
  "Diez",
  "Once",
  "Doce",
  "Trece",
  "Catorce",
  "Quince",
  "Dieciséis",
  "Diecisiete",
  "Dieciocho",
  "Diecinueve",
  "Veinte",
  "Veintiuno",
  "Veintidós",
  "Veintitrés",
  "Veinticuatro",
  "Veinticinco",
  "Veintiséis",
  "Veintisiete",
  "Veintiocho",
  "Veintinueve",
  "Treinta",
  "Treinta y uno",
];

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

describe("fechaEnLetras", () => {
  it("ejemplo del PRD: 27 de septiembre", () => {
    expect(fechaEnLetras(new Date(2026, 8, 27))).toBe("Veintisiete de septiembre");
  });

  it.each(DIAS.map((palabra, i) => [i + 1, palabra] as const))(
    "día %i en enero → %s de enero",
    (dia, palabra) => {
      expect(fechaEnLetras(new Date(2025, 0, dia))).toBe(`${palabra} de enero`);
    },
  );

  it.each(MESES.map((nombre, i) => [i, nombre] as const))(
    "mes índice %i → 1 de %s",
    (mesIndex, nombre) => {
      expect(fechaEnLetras(new Date(2025, mesIndex, 1))).toBe(`Uno de ${nombre}`);
    },
  );
});
