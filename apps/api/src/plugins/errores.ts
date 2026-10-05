import { Elysia } from "elysia";

// Red de seguridad para todo lo que NO se convirtió en una respuesta
// { error: { codigo, mensaje } } dentro de un handler (CLAUDE.md "Errores").
//
// El cuerpo que sale de aquí es lo único que el usuario llega a leer, así
// que NUNCA incluye nada que venga de la excepción original: ni su mensaje
// (puede traer ids internos, nombres de tablas o fragmentos de SQL), ni la
// descripción del esquema de validación (revela nombres de campos y tipos).
// El detalle completo va al registro del servidor, no a la respuesta.
//
// Vive en un plugin (y no inline en index.ts) para que la prueba de la app
// compuesta lo monte exactamente igual que producción.
export const manejadorErrores = new Elysia({ name: "manejador-errores" }).onError({ as: "global" }, ({ code, error, set }) => {
  if (code === "VALIDATION") {
    console.warn("[validación]", error.message);
    set.status = 422;
    return {
      error: {
        codigo: "DATOS_INVALIDOS",
        mensaje: "Los datos enviados no son válidos. Revisa la información e inténtalo de nuevo.",
      },
    };
  }

  if (code === "PARSE") {
    set.status = 400;
    return {
      error: { codigo: "PETICION_INVALIDA", mensaje: "No se pudo leer la información enviada. Inténtalo de nuevo." },
    };
  }

  if (code === "NOT_FOUND") {
    set.status = 404;
    return { error: { codigo: "NO_ENCONTRADO", mensaje: "No se encontró lo que buscas." } };
  }

  console.error(`[error no manejado] [${code}]`, error);
  set.status = 500;
  return {
    error: {
      codigo: "ERROR_INTERNO",
      mensaje: "Ocurrió un error inesperado. Intenta de nuevo en unos segundos.",
    },
  };
});
