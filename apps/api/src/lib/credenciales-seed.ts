// Entrega 9, sección 4a — las credenciales que el seed crea (SUPER_ADMIN,
// ADMIN y VENDEDOR de ejemplo) deben salir de variables de entorno. Fuera de
// producción se admite un valor de desarrollo fijo, para que `bun run seed`
// funcione sin configuración extra en una máquina nueva. En producción
// (NODE_ENV=production) ese valor de desarrollo nunca se usa: si falta la
// variable, el seed debe fallar ruidosamente en vez de crear una cuenta con
// una contraseña conocida y pública (la de este mismo repositorio).
export function credencialSeed(
  nombreVariable: string,
  valorPorDefectoDesarrollo: string,
  entorno: Record<string, string | undefined> = process.env,
): string {
  const valor = entorno[nombreVariable];
  if (valor) return valor;

  if (entorno.NODE_ENV === "production") {
    throw new Error(
      `Falta la variable de entorno ${nombreVariable}. Es obligatoria cuando NODE_ENV=production: ` +
        "el seed no puede usar la contraseña de desarrollo (pública en el repositorio) en producción.",
    );
  }

  return valorPorDefectoDesarrollo;
}
