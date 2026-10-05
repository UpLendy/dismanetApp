import { cookies } from "next/headers";
import { satisfaceRol, inicioParaRol, type Rol } from "./rol";

let URL_API = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
if (!URL_API.startsWith("http://") && !URL_API.startsWith("https://")) {
  URL_API = `https://${URL_API}`;
}

export type { Rol };
export { satisfaceRol, inicioParaRol };

export interface Sesion {
  usuario: { id: string; nombre: string; email: string; rol: Rol };
  empresaActiva: { id: string; nombre: string } | null;
}

/**
 * Verificación autoritativa de sesión contra GET /auth/yo, reenviando la
 * cookie de la petición actual. null si no hay sesión válida — el caller
 * decide a dónde redirigir (login, o la pantalla propia del rol).
 */
export async function obtenerSesion(): Promise<Sesion | null> {
  const cabeceraCookie = (await cookies()).toString();

  const respuesta = await fetch(`${URL_API}/auth/yo`, {
    headers: { cookie: cabeceraCookie },
    cache: "no-store",
  });

  if (!respuesta.ok) return null;
  return (await respuesta.json()) as Sesion;
}
