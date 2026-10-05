import type { Prisma } from "../generated/prisma/client.ts";

// Con @prisma/adapter-pg, P2002 no llena `error.meta.target` (eso es del
// motor binario/WASM): el nombre de la restricción violada viaja anidado en
// `error.meta.driverAdapterError.cause.constraint.index`. Se revisan ambas
// formas para no acoplarse a un solo modo de ejecución. Nunca leer
// `meta.target` directamente en otro lugar del código (ver CLAUDE.md).
export function restriccionViolada(error: Prisma.PrismaClientKnownRequestError): string {
  const meta = error.meta as
    | { target?: unknown; driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } }
    | undefined;
  if (Array.isArray(meta?.target)) return meta.target.join(",");
  const indice = meta?.driverAdapterError?.cause?.constraint?.index;
  return typeof indice === "string" ? indice : "";
}
