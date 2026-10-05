export type Rol = "VENDEDOR" | "ADMIN" | "SUPER_ADMIN";

const RANGO_ROL: Record<Rol, number> = { VENDEDOR: 0, ADMIN: 1, SUPER_ADMIN: 2 };

/**
 * Jerarquía, no lista cerrada de roles — igual que requiereRol en el API.
 *
 * Separado de sesion.ts (que importa next/headers) porque esta función se
 * usa también desde componentes de cliente (app-shell.tsx, nav.ts): si
 * vive junto a next/headers, el bundler arrastra ese import al cliente y
 * Next lo rechaza en build.
 */
export function satisfaceRol(rol: Rol, rolMinimo: Rol): boolean {
  return RANGO_ROL[rol] >= RANGO_ROL[rolMinimo];
}

/** La pantalla propia de cada rol — a dónde mandar a quien no califica para la ruta que pidió. */
export function inicioParaRol(rol: Rol): string {
  return rol === "VENDEDOR" ? "/vender" : "/panel";
}
