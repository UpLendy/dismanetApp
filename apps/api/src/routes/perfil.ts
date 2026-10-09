import { Elysia, t } from "elysia";
import argon2 from "argon2";
// prismaRaw: excepción explícita de R1 (lista blanca en
// prisma-raw-lista-blanca.test.ts). El propio registro de un SUPER_ADMIN
// tiene empresaId nulo, igual que en /auth/yo — ningún prismaParaEmpresa(x)
// puede alcanzarlo. Para ADMIN/VENDEDOR sí se usa el cliente extendido.
import { prismaRaw } from "../lib/prisma.ts";
import { prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol, TipoMovimientoSaldo } from "../generated/prisma/client.ts";
import { restriccionViolada } from "../lib/errores.ts";
import {
  jwtSesion,
  DURACION_SESION_SEGUNDOS,
  NOMBRE_COOKIE_SESION,
  SAME_SITE_COOKIE_SESION,
  type PayloadJwt,
} from "../plugins/contexto.ts";
import { requiereAutenticacion } from "../plugins/guardas.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaUsuario = t.Object({
  id: t.String(),
  nombre: t.String(),
  email: t.String(),
  rol: t.Enum(Rol),
});

const respuestaUsuario = (usuario: { id: string; nombre: string; email: string; rol: Rol }) => ({
  id: usuario.id,
  nombre: usuario.nombre,
  email: usuario.email,
  rol: usuario.rol,
});

const esquemaMovimientoSaldo = t.Object({
  id: t.String(),
  tipo: t.Enum(TipoMovimientoSaldo),
  monto: t.String(),
  saldoResultante: t.String(),
  ventaId: t.Union([t.String(), t.Null()]),
  nota: t.Union([t.String(), t.Null()]),
  creadoPorId: t.String(),
  createdAt: t.String(),
});

const respuestaMovimientoSaldo = (movimiento: {
  id: string;
  tipo: TipoMovimientoSaldo;
  monto: Prisma.Decimal;
  saldoResultante: Prisma.Decimal;
  ventaId: string | null;
  nota: string | null;
  creadoPorId: string;
  createdAt: Date;
}) => ({
  id: movimiento.id,
  tipo: movimiento.tipo,
  monto: movimiento.monto.toString(),
  saldoResultante: movimiento.saldoResultante.toString(),
  ventaId: movimiento.ventaId,
  nota: movimiento.nota,
  creadoPorId: movimiento.creadoPorId,
  createdAt: movimiento.createdAt.toISOString(),
});

/**
 * El usuario autenticado opera sobre su propia fila. Para SUPER_ADMIN
 * (empresaId nulo en su propio registro) no hay cliente extendido posible;
 * para ADMIN/VENDEDOR sí, y es el que se usa (R1). Misma distinción que
 * /auth/yo en auth.ts.
 */
function clientePropio(contexto: { rol: Rol | null; empresaId: string | null }) {
  return contexto.rol === Rol.SUPER_ADMIN ? prismaRaw : prismaParaEmpresa(contexto.empresaId);
}

export const perfil = new Elysia({ prefix: "/perfil" })
  .use(jwtSesion)
  .use(requiereAutenticacion)
  .get(
    "/",
    async ({ contexto }) => {
      const usuario = await clientePropio(contexto).usuario.findUniqueOrThrow({
        where: { id: contexto.usuarioId! },
      });
      return { usuario: respuestaUsuario(usuario) };
    },
    { response: { 200: t.Object({ usuario: esquemaUsuario }) } },
  )
  .put(
    "/",
    async ({ body, contexto, set }) => {
      const cliente = clientePropio(contexto);
      try {
        const actualizado = await cliente.usuario.update({
          where: { id: contexto.usuarioId! },
          data: { nombre: body.nombre, email: body.email },
        });
        return { usuario: respuestaUsuario(actualizado) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("email")) {
            set.status = 409;
            return {
              error: { codigo: "CORREO_EN_USO", mensaje: "Ya existe un usuario registrado con ese correo." },
            };
          }
        }
        throw error;
      }
    },
    {
      body: t.Object({
        nombre: t.String({ minLength: 1 }),
        email: t.String({ format: "email" }),
      }),
      response: {
        200: t.Object({ usuario: esquemaUsuario }),
        409: esquemaError,
      },
    },
  )
  .put(
    "/contrasena",
    async ({ body, contexto, jwt, cookie, set }) => {
      const cliente = clientePropio(contexto);
      const usuario = await cliente.usuario.findUniqueOrThrow({ where: { id: contexto.usuarioId! } });

      const contrasenaValida = await argon2.verify(usuario.passwordHash, body.passwordActual).catch(() => false);
      if (!contrasenaValida) {
        set.status = 401;
        return {
          error: { codigo: "CONTRASENA_ACTUAL_INCORRECTA", mensaje: "La contraseña actual no es correcta." },
        };
      }

      const passwordHash = await argon2.hash(body.passwordNueva, { type: argon2.argon2id });
      // Incrementar versionSesion es lo que invalida el resto de sesiones
      // (ver plugins/contexto.ts): cualquier JWT firmado con la versión
      // anterior deja de pasar la comparación en la próxima petición. La
      // sesión actual sigue viva porque abajo se firma y se cookea un JWT
      // nuevo con la versión recién incrementada.
      const actualizado = await cliente.usuario.update({
        where: { id: contexto.usuarioId! },
        data: { passwordHash, versionSesion: { increment: 1 } },
      });

      const payload: PayloadJwt = {
        usuarioId: actualizado.id,
        rol: actualizado.rol,
        empresaId: actualizado.empresaId,
        versionSesion: actualizado.versionSesion,
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

      return { ok: true };
    },
    {
      body: t.Object({
        passwordActual: t.String({ minLength: 1 }),
        passwordNueva: t.String({ minLength: 8 }),
      }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: esquemaError,
      },
    },
  )
  // Saldo propio del revendedor — visible en la barra superior y antes de
  // confirmar una venta en /vender. El saldo es exclusivo de rol VENDEDOR
  // (nunca de la columna usaSaldo, que ya no se lee en código): `saldo: null`
  // para un EMPLEADO, que nunca ve ni un saldo en cero ni uno deshabilitado,
  // simplemente no hay dato que mostrar y el frontend no renderiza nada.
  .get(
    "/saldo",
    async ({ contexto }) => {
      if (contexto.rol !== Rol.VENDEDOR) return { usaSaldo: false, saldo: null };
      const usuario = await clientePropio(contexto).usuario.findUniqueOrThrow({
        where: { id: contexto.usuarioId! },
        select: { saldo: true },
      });
      return { usaSaldo: true, saldo: usuario.saldo.toString() };
    },
    { response: { 200: t.Object({ usaSaldo: t.Boolean(), saldo: t.Union([t.String(), t.Null()]) }) } },
  )
  // Historial propio, nunca el de otro usuario (R4): siempre filtrado por
  // contexto.usuarioId, nunca por un :id de la URL.
  .get(
    "/saldo/movimientos",
    async ({ contexto }) => {
      // Un EMPLEADO nunca tuvo movimientos: la lista queda vacía de forma
      // natural, sin necesidad de un caso especial.
      const movimientos =
        contexto.rol === Rol.VENDEDOR
          ? await clientePropio(contexto).movimientoSaldo.findMany({
              where: { usuarioId: contexto.usuarioId! },
              orderBy: { createdAt: "desc" },
            })
          : [];
      return { movimientos: movimientos.map(respuestaMovimientoSaldo) };
    },
    { response: { 200: t.Object({ movimientos: t.Array(esquemaMovimientoSaldo) }) } },
  );
