import { describe, expect, it } from "bun:test";
import { verificarEntorno } from "./entorno.ts";

describe("verificarEntorno (Entrega 9, sección 4)", () => {
  it("no lanza si las tres variables requeridas están definidas", () => {
    expect(() =>
      verificarEntorno({ DATABASE_URL: "postgresql://x", JWT_SECRET: "secreto", CLAVE_CIFRADO: "a".repeat(64) }),
    ).not.toThrow();
  });

  it("lanza con los nombres de las variables que faltan", () => {
    expect(() => verificarEntorno({ DATABASE_URL: "postgresql://x" })).toThrow(/JWT_SECRET.*CLAVE_CIFRADO|CLAVE_CIFRADO.*JWT_SECRET/);
  });

  it("lanza si todas las variables faltan", () => {
    expect(() => verificarEntorno({})).toThrow(/DATABASE_URL/);
  });
});
