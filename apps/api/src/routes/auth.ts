import { Elysia, t } from "elysia";
import argon2 from "argon2";
import { prismaRaw } from "../lib/prisma.ts";
import { prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Rol } from "../generated/prisma/client.ts";
import {
  jwtSesion,
  DURACION_SESION_SEGUNDOS,
  NOMBRE_COOKIE_SESION,
  SAME_SITE_COOKIE_SESION,
  type PayloadJwt,
} from "../plugins/contexto.ts";
import { requiereAutenticacion } from "../plugins/guardas.ts";

// Hash "señuelo" contra el que se compara cuando el correo no existe, para
// que verificar credenciales tome un tiempo similar exista o no la cuenta
// (evita que el tiempo de respuesta revele si un correo está registrado).
const HASH_SEÑUELO = await argon2.hash("correo-no-registrado-en-el-sistema", { type: argon2.argon2id });

const respuestaUsuario = (usuario: { id: string; nombre: string; email: string; rol: Rol }) => ({
  id: usuario.id,
  nombre: usuario.nombre,
  email: usuario.email,
  rol: usuario.rol,
});

const esquemaUsuario = t.Object({
  id: t.String(),
  nombre: t.String(),
  email: t.String(),
  rol: t.Enum(Rol),
});

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

export const auth = new Elysia({ prefix: "/auth" })
  .use(jwtSesion)
  .post(
    "/login",
    async ({ body, jwt, cookie, set }) => {
      const { email, password } = body;

      // prismaRaw: excepción explícita de R1. Antes de este punto no se
      // conoce la empresa del usuario — es exactamente el caso documentado
      // en src/lib/prisma.ts ("solo se usa en el seed y en el login").
      const usuario = await prismaRaw.usuario.findUnique({
        where: { email },
        include: { empresa: true },
      });

      const contrasenaValida = await argon2
        .verify(usuario?.passwordHash ?? HASH_SEÑUELO, password)
        .catch(() => false);

      if (!usuario || !contrasenaValida) {
        set.status = 401;
        return { error: { codigo: "CREDENCIALES_INVALIDAS", mensaje: "Correo o contraseña incorrectos." } };
      }

      if (!usuario.activo) {
        set.status = 403;
        return {
          error: { codigo: "USUARIO_INACTIVO", mensaje: "Tu usuario está inactivo. Contacta a un administrador." },
        };
      }

      if (usuario.empresa && !usuario.empresa.activa) {
        set.status = 403;
        return {
          error: {
            codigo: "EMPRESA_INACTIVA",
            mensaje: "Tu empresa está inactiva. Contacta al administrador de la plataforma.",
          },
        };
      }

      const payload: PayloadJwt = {
        usuarioId: usuario.id,
        rol: usuario.rol,
        empresaId: usuario.empresaId,
        versionSesion: usuario.versionSesion,
      };
      const token = await jwt.sign(payload as unknown as Record<string, string | number | boolean | null>);

      cookie[NOMBRE_COOKIE_SESION].set({
        value: token,
        httpOnly: true,
        sameSite: SAME_SITE_COOKIE_SESION,
        secure: process.env.NODE_ENV === "production",
        maxAge: DURACION_SESION_SEGUNDOS,
        path: "/",
      });

      return {
        usuario: respuestaUsuario(usuario),
        empresa: usuario.empresa ? { id: usuario.empresa.id, nombre: usuario.empresa.nombre } : null,
      };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Object({
          usuario: esquemaUsuario,
          empresa: t.Union([t.Object({ id: t.String(), nombre: t.String() }), t.Null()]),
        }),
        401: esquemaError,
        403: esquemaError,
      },
    },
  )
  .post(
    "/logout",
    ({ cookie }) => {
      cookie[NOMBRE_COOKIE_SESION].remove();
      return { ok: true };
    },
    { response: { 200: t.Object({ ok: t.Boolean() }) } },
  )
  .use(requiereAutenticacion)
  .get("/yo", async ({ contexto }) => {
    // El propio registro de un SUPER_ADMIN tiene empresaId nulo, así que
    // ningún prismaParaEmpresa(x) puede alcanzarlo jamás (la extensión R1
    // siempre exige que empresaId coincida). Es la misma situación que el
    // login: se resuelve la propia identidad con prismaRaw, y solo por el id
    // ya verificado en el JWT — nunca con un id que vengan del cliente.
    const usuario =
      contexto.rol === Rol.SUPER_ADMIN
        ? await prismaRaw.usuario.findUniqueOrThrow({ where: { id: contexto.usuarioId! } })
        : await prismaParaEmpresa(contexto.empresaId).usuario.findUniqueOrThrow({
            where: { id: contexto.usuarioId! },
          });

    const empresaActiva = contexto.empresaId
      ? await prismaRaw.empresa.findUnique({ where: { id: contexto.empresaId } })
      : null;

    return {
      usuario: respuestaUsuario(usuario),
      empresaActiva: empresaActiva ? { id: empresaActiva.id, nombre: empresaActiva.nombre } : null,
    };
  }, {
    response: {
      200: t.Object({
        usuario: esquemaUsuario,
        empresaActiva: t.Union([t.Object({ id: t.String(), nombre: t.String() }), t.Null()]),
      }),
    },
  });
