import { describe, expect, it } from "bun:test";
import { verificarEntorno } from "./entorno.ts";

const TODAS_DEFINIDAS = {
  DATABASE_URL: "postgresql://x",
  JWT_SECRET: "secreto",
  CLAVE_CIFRADO: "a".repeat(64),
  S3_BUCKET: "bucket",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "clave",
  S3_SECRET_ACCESS_KEY: "secreto",
};

describe("verificarEntorno (Entrega 9, sección 4; S3 agregado en F6.7)", () => {
  it("no lanza si todas las variables requeridas están definidas", () => {
    expect(() => verificarEntorno(TODAS_DEFINIDAS)).not.toThrow();
  });

  it("lanza con los nombres de las variables que faltan", () => {
    expect(() => verificarEntorno({ DATABASE_URL: "postgresql://x" })).toThrow(/JWT_SECRET/);
    expect(() => verificarEntorno({ DATABASE_URL: "postgresql://x" })).toThrow(/S3_BUCKET/);
  });

  it("lanza si todas las variables faltan", () => {
    expect(() => verificarEntorno({})).toThrow(/DATABASE_URL/);
  });
});
