/**
 * Regla de negocio única para "a quién le aplica una instrucción": `null`
 * en `cargoId` significa "todos los empleados" (CLAUDE.md: no se construye
 * una tabla de asignación múltiple); cualquier otro valor exige coincidencia
 * exacta de cargo. La usan tanto la consulta del empleado (sumada a
 * `publicada`) como `/cumplimiento` del ADMIN (sin ese filtro de
 * `publicada`, porque el ADMIN sí puede revisar una instrucción todavía sin
 * publicar).
 */
export function aplicaACargo(cargoIdInstruccion: string | null, cargoIdUsuario: string | null): boolean {
  return cargoIdInstruccion === null || cargoIdInstruccion === cargoIdUsuario;
}

/**
 * Una instrucción solo es visible para un empleado si está publicada y le
 * aplica su cargo. Un VENDEDOR nunca llega aquí: el prefijo entero exige
 * EMPLEADO en adelante, mismo criterio que F6.3/F6.4. Una instrucción no
 * publicada no sale en ninguna consulta de empleado, ni pidiendo su id
 * directo — por eso toda ruta de lectura de empleado filtra con esto, nunca
 * solo con el id.
 */
export function instruccionVisiblePara(
  instruccion: { publicada: boolean; cargoId: string | null },
  cargoIdUsuario: string | null,
): boolean {
  return instruccion.publicada && aplicaACargo(instruccion.cargoId, cargoIdUsuario);
}
