import { describe, expect, it } from "bun:test";
import { credencialSeed } from "./credenciales-seed.ts";

describe("credencialSeed (Entrega 9, 4a y prueba obligatoria f)", () => {
  it("usa el valor de la variable de entorno cuando está definida, sin importar NODE_ENV", () => {
    expect(credencialSeed("X", "default", { X: "valor-real" })).toBe("valor-real");
    expect(credencialSeed("X", "default", { X: "valor-real", NODE_ENV: "production" })).toBe("valor-real");
  });

  it("fuera de producción, usa el valor por defecto de desarrollo si la variable no está definida", () => {
    expect(credencialSeed("X", "default", {})).toBe("default");
    expect(credencialSeed("X", "default", { NODE_ENV: "development" })).toBe("default");
    expect(credencialSeed("X", "default", { NODE_ENV: "test" })).toBe("default");
  });

  it("(f) en producción, falla en vez de usar el valor de desarrollo si la variable no está definida", () => {
    expect(() => credencialSeed("SEED_ADMIN_PASSWORD", "default", { NODE_ENV: "production" })).toThrow(
      /SEED_ADMIN_PASSWORD/,
    );
  });

  it("(f) en producción, una variable vacía se trata igual que si no existiera", () => {
    expect(() => credencialSeed("SEED_ADMIN_PASSWORD", "default", { NODE_ENV: "production", SEED_ADMIN_PASSWORD: "" })).toThrow();
  });
});
