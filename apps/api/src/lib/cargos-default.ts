// Toda empresa nueva arranca con estos cinco cargos. Son el oficio (Gerencia,
// Coordinación, Soporte técnico, Seguimiento, Asesores comerciales), no el
// Rol: no ordenan nada ni conceden ningún permiso (ver CLAUDE.md, "la
// decisión que define esta entrega" en F6.1). El admin los renombra o
// desactiva después; el valor inicial es este. Compartido entre el alta de
// empresa desde la API (routes/empresas.ts) y el script de backfill
// (prisma/migrar-cargos-default.ts), para que las listas no se desalineen.
export const CARGOS_POR_DEFECTO = [
  "Gerencia",
  "Coordinación",
  "Soporte técnico",
  "Seguimiento",
  "Asesores comerciales",
] as const;
