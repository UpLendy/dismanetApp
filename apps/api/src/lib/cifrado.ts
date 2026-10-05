import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Cifrado reversible (NO hash) para datos que deben poder mostrarse al
// vendedor: Cuenta.password, Pantalla.pin y sus copias en VentaDetalle.
//
// Las contraseñas de USUARIOS son distintas: esas van con Argon2id (hash,
// irreversible). No usar este módulo para eso.
//
// La clave sale de CLAVE_CIFRADO (32 bytes en hex). Generarla con:
//   openssl rand -hex 32
// Si se pierde la clave, todo lo cifrado con ella es IRRECUPERABLE: no hay
// forma de recuperar el texto plano sin ella.

const ALGORITMO = "aes-256-gcm";
const LONGITUD_IV = 12;
const LONGITUD_TAG = 16;

function obtenerClave(): Buffer {
  const claveHex = process.env.CLAVE_CIFRADO;
  if (!claveHex) {
    throw new Error(
      "CLAVE_CIFRADO no está definida. Generarla con: openssl rand -hex 32",
    );
  }
  const clave = Buffer.from(claveHex, "hex");
  if (clave.length !== 32) {
    throw new Error(
      "CLAVE_CIFRADO debe ser 32 bytes en hexadecimal (64 caracteres)",
    );
  }
  return clave;
}

/** Cifra texto plano. Cada llamada usa un IV aleatorio distinto. */
export function cifrar(textoPlano: string): string {
  const clave = obtenerClave();
  const iv = randomBytes(LONGITUD_IV);
  const cipher = createCipheriv(ALGORITMO, clave, iv);
  const cifrado = Buffer.concat([
    cipher.update(textoPlano, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, cifrado]).toString("base64");
}

/** Descifra un valor producido por cifrar(). Lanza si la clave o los datos no coinciden. */
export function descifrar(textoCifrado: string): string {
  const clave = obtenerClave();
  const datos = Buffer.from(textoCifrado, "base64");
  const iv = datos.subarray(0, LONGITUD_IV);
  const tag = datos.subarray(LONGITUD_IV, LONGITUD_IV + LONGITUD_TAG);
  const cifrado = datos.subarray(LONGITUD_IV + LONGITUD_TAG);

  const decipher = createDecipheriv(ALGORITMO, clave, iv);
  decipher.setAuthTag(tag);
  const textoPlano = Buffer.concat([
    decipher.update(cifrado),
    decipher.final(),
  ]);
  return textoPlano.toString("utf8");
}
