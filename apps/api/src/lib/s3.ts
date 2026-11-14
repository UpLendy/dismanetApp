import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// F6.7 — los archivos de instrucciones (imágenes y video) van directo del
// navegador a S3 con URLs prefirmadas: el API nunca recibe el archivo
// completo (PROMPT-F6.7, Parte 1). El bucket es privado: sin ACL pública ni
// acceso anónimo, toda lectura también pasa por una URL prefirmada de vida
// corta.
//
// Las pruebas mockean este módulo entero con mock.module (ver
// routes/instrucciones.test.ts) — recordar que en Bun ese mock es global al
// proceso (CLAUDE.md), así que ningún otro archivo de prueba debe mockear
// "./s3.ts" con una superficie distinta.

/** Minutos, no horas (regla no negociable de PROMPT-F6.7). */
const SEGUNDOS_VIDA_URL_SUBIDA = 5 * 60;
const SEGUNDOS_VIDA_URL_LECTURA = 5 * 60;

const TAMANO_MAXIMO_BYTES_DEFECTO = 200 * 1024 * 1024; // 200 MB — razonable para un video semanal corto.

export const CONTENT_TYPES_PERMITIDOS = ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"] as const;
export type ContentTypePermitido = (typeof CONTENT_TYPES_PERMITIDOS)[number];

export function esContentTypePermitido(valor: string): valor is ContentTypePermitido {
  return (CONTENT_TYPES_PERMITIDOS as readonly string[]).includes(valor);
}

/** "IMAGEN" o "VIDEO" (TipoArchivoInstruccion) a partir del contentType ya validado contra la lista blanca. */
export function tipoArchivoDeContentType(contentType: ContentTypePermitido): "IMAGEN" | "VIDEO" {
  return contentType.startsWith("image/") ? "IMAGEN" : "VIDEO";
}

const EXTENSION_POR_CONTENT_TYPE: Record<ContentTypePermitido, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/** Tamaño máximo por archivo, en bytes — configurable, con un valor por defecto razonable para video. */
export function tamanoMaximoBytes(): number {
  const valor = process.env.S3_TAMANO_MAXIMO_BYTES;
  if (!valor) return TAMANO_MAXIMO_BYTES_DEFECTO;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : TAMANO_MAXIMO_BYTES_DEFECTO;
}

function cliente(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}

function bucket(): string {
  return process.env.S3_BUCKET!;
}

/**
 * Genera la CLAVE del objeto — nunca la elige el cliente (regla de
 * seguridad no negociable): si el navegador pudiera elegirla, podría
 * escribir en cualquier parte del bucket. Namespaced por empresa e
 * instrucción (R1): si algún día se cuela un error de aislamiento, el
 * prefijo lo contiene.
 */
export function generarClaveArchivo(
  empresaId: string,
  instruccionId: string,
  contentType: ContentTypePermitido,
): string {
  const extension = EXTENSION_POR_CONTENT_TYPE[contentType];
  return `empresas/${empresaId}/instrucciones/${instruccionId}/${randomUUID()}.${extension}`;
}

/**
 * URL de PUT prefirmada. Firma el ContentType y el ContentLength como parte
 * de la petición: el navegador tiene que subir exactamente ese tipo y ese
 * tamaño, o S3 rechaza la firma — así el máximo se exige "al pedir la URL",
 * no después de recibir el archivo entero.
 */
export async function urlSubidaPrefirmada(clave: string, contentType: string, bytes: number): Promise<string> {
  const comando = new PutObjectCommand({ Bucket: bucket(), Key: clave, ContentType: contentType, ContentLength: bytes });
  return getSignedUrl(cliente(), comando, { expiresIn: SEGUNDOS_VIDA_URL_SUBIDA });
}

/** URL de GET prefirmada, de vida corta — nunca una URL pública ni un bucket con ACL abierta. */
export async function urlLecturaPrefirmada(clave: string): Promise<string> {
  const comando = new GetObjectCommand({ Bucket: bucket(), Key: clave });
  return getSignedUrl(cliente(), comando, { expiresIn: SEGUNDOS_VIDA_URL_LECTURA });
}

/**
 * Tamaño real del objeto en S3, o `null` si no existe. Se usa para dos
 * cosas: confirmar que la subida terminó antes de registrar la fila (si la
 * subida falló a mitad, no debe quedar una fila que apunta a nada), y
 * comparar contra lo que el cliente dice haber subido.
 */
export async function tamanoDeObjeto(clave: string): Promise<number | null> {
  try {
    const resultado = await cliente().send(new HeadObjectCommand({ Bucket: bucket(), Key: clave }));
    return resultado.ContentLength ?? null;
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "NotFound") {
      return null;
    }
    throw error;
  }
}

export async function eliminarObjeto(clave: string): Promise<void> {
  await cliente().send(new DeleteObjectCommand({ Bucket: bucket(), Key: clave }));
}
