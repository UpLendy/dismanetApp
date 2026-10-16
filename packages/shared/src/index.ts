// Constantes compartidas entre apps/api y apps/web — fuente única para
// reglas que antes vivían repetidas como literales en varios archivos.

/** Reglas de PIN (F4.2, parte 2.1): longitud 4-6, nunca un literal de 4 suelto. */
export const PIN_LONGITUD_MIN = 4;
export const PIN_LONGITUD_MAX = 6;
export const PIN_PATRON = `^[0-9]{${PIN_LONGITUD_MIN},${PIN_LONGITUD_MAX}}$`;

export function esPinValido(valor: string): boolean {
  return new RegExp(PIN_PATRON).test(valor);
}

/** A, B, C... Z, luego envuelve (AA en adelante no existe en la práctica: más de 26 pantallas en una cuenta no ocurre). */
export function letraPerfil(indice: number): string {
  return String.fromCharCode(65 + (indice % 26));
}
