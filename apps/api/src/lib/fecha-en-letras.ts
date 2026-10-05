const DIAS_EN_PALABRAS = [
  "Uno",
  "Dos",
  "Tres",
  "Cuatro",
  "Cinco",
  "Seis",
  "Siete",
  "Ocho",
  "Nueve",
  "Diez",
  "Once",
  "Doce",
  "Trece",
  "Catorce",
  "Quince",
  "Dieciséis",
  "Diecisiete",
  "Dieciocho",
  "Diecinueve",
  "Veinte",
  "Veintiuno",
  "Veintidós",
  "Veintitrés",
  "Veinticuatro",
  "Veinticinco",
  "Veintiséis",
  "Veintisiete",
  "Veintiocho",
  "Veintinueve",
  "Treinta",
  "Treinta y uno",
] as const;

const MESES_EN_PALABRAS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/**
 * Convierte una fecha a texto en español, sin año: "Veintisiete de septiembre".
 * Usa el día y el mes en hora local de `fecha` (la conversión a
 * America/Bogota ya debe haberse hecho antes de llamar esta función).
 */
export function fechaEnLetras(fecha: Date): string {
  const dia = DIAS_EN_PALABRAS[fecha.getDate() - 1];
  const mes = MESES_EN_PALABRAS[fecha.getMonth()];
  return `${dia} de ${mes}`;
}
