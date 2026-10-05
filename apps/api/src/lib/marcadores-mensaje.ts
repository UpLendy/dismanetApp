// Lista de marcadores válidos por tipo de plantilla (PRD §5.9), en el mismo
// orden en que mensaje.ts los sustituye. Si se agrega un marcador nuevo al
// renderizador, agregarlo aquí también — si no, la pantalla de edición no
// sabrá listarlo ni validarlo.
const MARCADORES_COMUNES = [
  "codigoCompra",
  "fechaEnLetras",
  "fecha",
  "tipoCliente",
  "duracion",
  "fechaVencimiento",
  "precio",
] as const;

const MARCADORES_UNIDAD = [...MARCADORES_COMUNES, "plataforma", "perfil", "pin", "correo", "clave"] as const;

const MARCADORES_PAQUETE = [...MARCADORES_COMUNES, "paquete", "listaCuentas"] as const;

export const MARCADORES_POR_TIPO = {
  UNIDAD: MARCADORES_UNIDAD,
  PAQUETE: MARCADORES_PAQUETE,
} as const;

const TODOS_LOS_MARCADORES = new Set<string>([...MARCADORES_UNIDAD, ...MARCADORES_PAQUETE]);

export interface MarcadorInvalido {
  marcador: string;
  // "desconocido": no existe en ningún renderizador — probablemente un typo.
  // "no_aplica": existe para el OTRO tipo (ej. {{paquete}} en una plantilla
  // UNIDAD) — el renderizador lo deja literal, nunca lo sustituye.
  razon: "desconocido" | "no_aplica";
}

/**
 * Detecta marcadores `{{...}}` en una plantilla que el renderizador real
 * (mensaje.ts) nunca va a sustituir: o no existen en ningún tipo, o existen
 * pero no para este `tipo`. No modifica la plantilla — solo reporta, para
 * que la pantalla de edición (PUT /plantillas/:tipo) pueda rechazar el
 * guardado o advertir antes de persistir.
 */
export function validarMarcadores(plantilla: string, tipo: "UNIDAD" | "PAQUETE"): MarcadorInvalido[] {
  const validosDeEsteTipo = new Set<string>(MARCADORES_POR_TIPO[tipo]);
  const vistos = new Set<string>();
  const invalidos: MarcadorInvalido[] = [];

  for (const coincidencia of plantilla.matchAll(/\{\{(\w+)\}\}/g)) {
    const marcador = coincidencia[1] ?? "";
    if (vistos.has(marcador)) continue;
    vistos.add(marcador);
    if (validosDeEsteTipo.has(marcador)) continue;
    invalidos.push({ marcador, razon: TODOS_LOS_MARCADORES.has(marcador) ? "no_aplica" : "desconocido" });
  }

  return invalidos;
}
