import { Elysia } from "elysia";
import jwtPlugin from "@elysiajs/jwt";
import { Rol } from "../generated/prisma/client.ts";
import { prismaRaw } from "../lib/prisma.ts";

export const NOMBRE_COOKIE_SESION = "sesion";
export const NOMBRE_COOKIE_EMPRESA_ACTIVA = "empresa_activa";
export const DURACION_SESION_SEGUNDOS = 60 * 60 * 24 * 7; // 7 días

// El proxy nativo de Next.js (apps/web/next.config.ts, rewrites de /api/*
// hacia Railway) hace que el navegador SOLO le hable al dominio de Vercel:
// es Vercel quien retransmite servidor-a-servidor al API. Para el
// navegador, todo el tráfico es del mismo origen — "lax" basta, en
// desarrollo y en producción por igual. Ya no hace falta "none" (que exige
// secure:true + HTTPS y, sobre todo, deja cualquier sitio de terceros
// disparar peticiones autenticadas contra el API mientras el navegador
// conserve la cookie).
//
// Si algún día se quita el proxy (el frontend vuelve a llamar directo al
// dominio de Railway), esto se rompe: el navegador deja de reenviar la
// cookie en esas llamadas cross-site y el login "funciona" pero se cae de
// inmediato. Ver DEPLOYMENT.md sección 5. SAME_SITE_COOKIE_SESION admite
// override por variable de entorno para ese escenario, sin tocar código.
const SAME_SITE_VALIDOS = ["lax", "strict", "none"] as const;
type ValorSameSite = (typeof SAME_SITE_VALIDOS)[number];

function leerSameSiteCookieSesion(): ValorSameSite {
  const valor = process.env.SAME_SITE_COOKIE_SESION;
  if (valor && (SAME_SITE_VALIDOS as readonly string[]).includes(valor)) return valor as ValorSameSite;
  return "lax";
}

export const SAME_SITE_COOKIE_SESION = leerSameSiteCookieSesion();

/**
 * Lo único que lleva el JWT (ver R1/R4). `versionSesion` es la excepción
 * deliberada a "nada que pueda quedar obsoleto": es justo el campo que SÍ
 * se compara contra la base en cada petición, para poder invalidar sesiones
 * (PUT /perfil/contrasena) sin mantener un almacén de sesiones aparte.
 */
export interface PayloadJwt {
  usuarioId: string;
  rol: Rol;
  empresaId: string | null;
  versionSesion: number;
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

    const { usuarioId, empresaId, versionSesion } = payload as unknown as PayloadJwt;

    // prismaRaw: excepción explícita de R1 (lista blanca en
    // prisma-raw-lista-blanca.test.ts). Usuario no tiene empresaId fijo
    // aquí todavía (para SUPER_ADMIN nunca lo tiene) — es la misma situación
    // que el login. Se compara versionSesion contra la base en cada
    // petición autenticada: es lo que permite que PUT /perfil/contrasena
    // invalide el resto de sesiones sin un almacén de sesiones aparte.
    // rol también se lee de la base, nunca del JWT: un cambio de rol
    // (ADMIN mueve a alguien de VENDEDOR a EMPLEADO) debe tomar efecto en la
    // siguiente petición, no en el próximo login.
    const usuario = await prismaRaw.usuario.findUnique({
      where: { id: usuarioId },
      select: { versionSesion: true, rol: true },
    });
    if (!usuario || usuario.versionSesion !== versionSesion) return { contexto: CONTEXTO_ANONIMO };

    if (usuario.rol === Rol.SUPER_ADMIN) {
      const empresaActiva = cookie[NOMBRE_COOKIE_EMPRESA_ACTIVA]?.value;
      return {
        contexto: {
          usuarioId,
          rol: usuario.rol,
          empresaId: typeof empresaActiva === "string" && empresaActiva ? empresaActiva : null,
        } satisfies ContextoPeticion,
      };
    }

    return { contexto: { usuarioId, rol: usuario.rol, empresaId: empresaId ?? null } satisfies ContextoPeticion };
  });
