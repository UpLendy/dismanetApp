// Entrega 9, sección 4 — antes de producción. DATABASE_URL, JWT_SECRET y
// CLAVE_CIFRADO se usan de forma perezosa (el primer query, el primer login,
// el primer cifrar/descifrar), así que si faltan, el servidor arranca
// "bien" y falla más tarde con un error confuso, en medio de una petición
// real. Esta función se llama una sola vez al arrancar (src/index.ts), antes
// de aceptar tráfico: si falta algo, el proceso no arranca.
const VARIABLES_REQUERIDAS = ["DATABASE_URL", "JWT_SECRET", "CLAVE_CIFRADO"] as const;

export function verificarEntorno(entorno: Record<string, string | undefined> = process.env): void {
  const faltantes = VARIABLES_REQUERIDAS.filter((nombre) => !entorno[nombre]);
  if (faltantes.length > 0) {
    throw new Error(
      `Faltan variables de entorno obligatorias: ${faltantes.join(", ")}. ` +
        "El servidor no puede arrancar sin ellas (ver .env.example).",
    );
  }
}
