/**
 * Helpers compartidos para leer el cuerpo de error de Eden Treaty
 * ({ error: { codigo, mensaje } }, ver CLAUDE.md "Errores"). Cada pantalla
 * tiene su propio mensajeDeError local; estos dos se comparten porque el
 * código de error (no solo el mensaje) ahora decide qué se renderiza.
 */
export function codigoDeError(errorRespuesta: unknown): string | undefined {
  return (errorRespuesta as { value?: { error?: { codigo?: string } } } | undefined)?.value?.error?.codigo;
}

export function esSinEmpresaActiva(errorRespuesta: unknown): boolean {
  return codigoDeError(errorRespuesta) === "SIN_EMPRESA_ACTIVA";
}
