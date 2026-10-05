import { beforeAll, describe, expect, it } from "bun:test";
import { cifrar, descifrar } from "./cifrado";

beforeAll(() => {
  process.env.CLAVE_CIFRADO = "0123456789abcdef".repeat(4);
});

describe("cifrar/descifrar", () => {
  it("descifra exactamente el texto original", () => {
    const original = "correo@ejemplo.com:contraseñaSecreta123";
    expect(descifrar(cifrar(original))).toBe(original);
  });

  it("produce ciphertext distinto en cada llamada (IV aleatorio)", () => {
    const a = cifrar("1234");
    const b = cifrar("1234");
    expect(a).not.toBe(b);
  });

  it("soporta cadenas vacías", () => {
    expect(descifrar(cifrar(""))).toBe("");
  });

  it("soporta caracteres unicode (tildes, ñ, emoji)", () => {
    const original = "ñandú café 🔒";
    expect(descifrar(cifrar(original))).toBe(original);
  });

  it("falla al descifrar con datos manipulados", () => {
    const cifrado = cifrar("dato sensible");
    const bytes = Buffer.from(cifrado, "base64");
    bytes[bytes.length - 1] ^= 0xff;
    const manipulado = bytes.toString("base64");
    expect(() => descifrar(manipulado)).toThrow();
  });

  it("lanza si CLAVE_CIFRADO no está definida", () => {
    const original = process.env.CLAVE_CIFRADO;
    delete process.env.CLAVE_CIFRADO;
    expect(() => cifrar("x")).toThrow();
    process.env.CLAVE_CIFRADO = original;
  });
});
