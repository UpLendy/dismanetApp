import { Elysia } from "elysia";
import jwtPlugin from "@elysiajs/jwt";
import { Rol } from "../generated/prisma/client.ts";

export const NOMBRE_COOKIE_SESION = "sesion";
export const NOMBRE_COOKIE_EMPRESA_ACTIVA = "empresa_activa";
export const DURACION_SESION_SEGUNDOS = 60 * 60 * 24 * 7; // 7 días

// En desarrollo, web y API comparten host (localhost, puertos distintos) y
// "lax" basta. En producción viven en dominios distintos (Vercel/Railway),
// así que el navegador trata cada llamada del Eden Treaty del frontend al
// API como cross-site: con "lax" el Set-Cookie llega pero el navegador no
// la reenvía en esas peticiones, y el login parece funcionar y se cae de
// inmediato. "none" exige secure:true (ya puesto condicionalmente abajo),
// que a su vez exige HTTPS — lo cual ambas plataformas dan por defecto.
export const SAME_SITE_COOKIE_SESION = process.env.NODE_ENV === "production" ? "none" : "lax";

/** Lo único que lleva el JWT (ver R1/R4): nada que pueda quedar obsoleto. */
export interface PayloadJwt {
  usuarioId: string;
  rol: Rol;
  empresaId: string | null;
}

export interface ContextoPeticion {
  usuarioId: string | null;
  rol: Rol | null;
  empresaId: string | null;
}

const CONTEXTO_ANONIMO: ContextoPeticion = { usuarioId: null, rol: null, empresaId: null };

export const jwtSesion = new Elysia({ name: "jwt-sesion" }).use(
  jwtPlugin({
    name: "jwt",
    secret: process.env.JWT_SECRET as string,
    exp: `${DURACION_SESION_SEGUNDOS}s`,
  }),
);

/**
 * Resuelve { usuarioId, rol, empresaId } de cada petición a partir del JWT
 * guardado en la cookie de sesión. Si no hay token o es inválido, el
 * contexto queda anónimo (usuarioId nulo) — las rutas públicas siguen
 * funcionando; son las guardas (requiereAutenticacion/requiereRol) las que
 * exigen que el contexto no sea anónimo.
 *
 * Para SUPER_ADMIN, el JWT nunca lleva empresaId (no pertenece a ninguna
 * empresa): empresaId sale de la cookie separada "empresa_activa", que
 * indica en qué empresa está operando. Sin esa cookie, empresaId queda nulo
 * y solo puede usar endpoints de plataforma (fuera de cualquier empresa).
 */
export const contexto = new Elysia({ name: "contexto" })
  .use(jwtSesion)
  .derive({ as: "global" }, async ({ jwt, cookie }) => {
    const token = cookie[NOMBRE_COOKIE_SESION]?.value;
    if (!token || typeof token !== "string") return { contexto: CONTEXTO_ANONIMO };

    const payload = await jwt.verify(token);
    if (!payload) return { contexto: CONTEXTO_ANONIMO };

    const { usuarioId, rol, empresaId } = payload as unknown as PayloadJwt;

    if (rol === Rol.SUPER_ADMIN) {
      const empresaActiva = cookie[NOMBRE_COOKIE_EMPRESA_ACTIVA]?.value;
      return {
        contexto: {
          usuarioId,
          rol,
          empresaId: typeof empresaActiva === "string" && empresaActiva ? empresaActiva : null,
        } satisfies ContextoPeticion,
      };
    }

    return { contexto: { usuarioId, rol, empresaId: empresaId ?? null } satisfies ContextoPeticion };
  });
