import { Elysia, t } from "elysia";
import argon2 from "argon2";
import type { prismaRaw } from "../lib/prisma.ts";
import { prismaParaEmpresa, datosSinEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol, TipoMovimientoSaldo } from "../generated/prisma/client.ts";
import { restriccionViolada } from "../lib/errores.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { bloquearUsuarioParaVenta } from "../lib/bloqueo-usuario.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

// Dinero como string decimal (CLAUDE.md: nunca number flotante). Igual
// patrón que precios.ts, duplicado a propósito — son archivos sin relación.
const PATRON_DINERO_POSITIVO = /^\d+(\.\d{1,2})?$/;
const PATRON_DINERO_CON_SIGNO = /^-?\d+(\.\d{1,2})?$/;
const dineroPositivo = t.String({ pattern: PATRON_DINERO_POSITIVO.source });
const dineroConSigno = t.String({ pattern: PATRON_DINERO_CON_SIGNO.source });

const esquemaUsuario = t.Object({
  id: t.String(),
  nombre: t.String(),
  email: t.String(),
  rol: t.Enum(Rol),
  activo: t.Boolean(),
  usaSaldo: t.Boolean(),
  saldo: t.String(),
});

// usaSaldo en la respuesta se deriva del rol, nunca de la columna Usuario.usaSaldo
// (que ya no se lee en código): el saldo es exclusivo de VENDEDOR desde que
// EMPLEADO existe como rol separado.
const respuestaUsuario = (usuario: {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  saldo: Prisma.Decimal;
}) => ({
  id: usuario.id,
  nombre: usuario.nombre,
  email: usuario.email,
  rol: usuario.rol,
  activo: usuario.activo,
  usaSaldo: usuario.rol === Rol.VENDEDOR,
  saldo: usuario.saldo.toString(),
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

// Un ADMIN nunca puede dejar su empresa sin ningún ADMIN activo: ni
// desactivando al último, ni cambiándole el rol a VENDEDOR. `excluirId` es
// el usuario sobre el que se está operando (se excluye del conteo de "los
// demás admins activos").
async function quedaSinAdminActivo(
  cliente: ReturnType<typeof prismaParaEmpresa<typeof prismaRaw>>,
  excluirId: string,
): Promise<boolean> {
  const otrosAdminsActivos = await cliente.usuario.count({
    where: { rol: Rol.ADMIN, activo: true, id: { not: excluirId } },
  });
  return otrosAdminsActivos === 0;
}

export const usuarios = new Elysia({ prefix: "/usuarios" })
  // Gestión de usuarios: ADMIN (o SUPER_ADMIN, jerarquía), dentro de su
  // propia empresa (PRD sección 5.3).
  .use(requiereRol(Rol.ADMIN))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: {
          codigo: "SIN_EMPRESA_ACTIVA",
          mensaje: "Selecciona una empresa antes de gestionar sus usuarios.",
        },
      };
    }
  })
  .get(
    "/",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const filas = await cliente.usuario.findMany({ orderBy: { createdAt: "asc" } });
      return { usuarios: filas.map(respuestaUsuario) };
    },
    { response: { 200: t.Object({ usuarios: t.Array(esquemaUsuario) }) } },
  )
  .post(
    "/",
    async ({ body, contexto, set }) => {
      if (body.rol === Rol.SUPER_ADMIN) {
        set.status = 403;
        return {
          error: { codigo: "ROL_NO_PERMITIDO", mensaje: "Un ADMIN no puede crear usuarios con rol SUPER_ADMIN." },
        };
      }

      const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
      const cliente = prismaParaEmpresa(contexto.empresaId);

      try {
        const usuario = await cliente.usuario.create({
          data: { email: body.email, passwordHash, nombre: body.nombre, rol: body.rol },
        });
        set.status = 201;
        return { usuario: respuestaUsuario(usuario) };
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
        password: t.String({ minLength: 8 }),
        rol: t.Enum(Rol),
      }),
      response: {
        201: t.Object({ usuario: esquemaUsuario }),
        403: esquemaError,
        409: esquemaError,
      },
    },
  )
  .patch(
    "/:id/desactivar",
    async ({ params, contexto, set }) => {
      if (params.id === contexto.usuarioId) {
        set.status = 403;
        return { error: { codigo: "AUTO_MODIFICACION", mensaje: "No puedes desactivar tu propio usuario." } };
      }

      const cliente = prismaParaEmpresa(contexto.empresaId);
      const usuario = await cliente.usuario.findUnique({ where: { id: params.id } });
      if (!usuario) {
        set.status = 404;
        return { error: { codigo: "USUARIO_NO_ENCONTRADO", mensaje: "El usuario no existe." } };
      }

      if (usuario.rol === Rol.ADMIN && usuario.activo && (await quedaSinAdminActivo(cliente, usuario.id))) {
        set.status = 409;
        return {
          error: {
            codigo: "ULTIMO_ADMIN",
            mensaje: "No puedes desactivar al único ADMIN activo de la empresa.",
          },
        };
      }

      const actualizado = await cliente.usuario.update({ where: { id: params.id }, data: { activo: false } });
      return { usuario: respuestaUsuario(actualizado) };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ usuario: esquemaUsuario }),
        403: esquemaError,
        404: esquemaError,
        409: esquemaError,
      },
    },
  )
  .patch(
    "/:id/reactivar",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const actualizado = await cliente.usuario.update({ where: { id: params.id }, data: { activo: true } });
        return { usuario: respuestaUsuario(actualizado) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "USUARIO_NO_ENCONTRADO", mensaje: "El usuario no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ usuario: esquemaUsuario }), 404: esquemaError },
    },
  )
  .patch(
    "/:id/rol",
    async ({ params, body, contexto, set }) => {
      if (params.id === contexto.usuarioId) {
        set.status = 403;
        return { error: { codigo: "AUTO_MODIFICACION", mensaje: "No puedes cambiar tu propio rol." } };
      }

      if (body.rol === Rol.SUPER_ADMIN) {
        set.status = 403;
        return {
          error: { codigo: "ROL_NO_PERMITIDO", mensaje: "Un ADMIN no puede asignar el rol SUPER_ADMIN." },
        };
      }

      const cliente = prismaParaEmpresa(contexto.empresaId);
      const usuario = await cliente.usuario.findUnique({ where: { id: params.id } });
      if (!usuario) {
        set.status = 404;
        return { error: { codigo: "USUARIO_NO_ENCONTRADO", mensaje: "El usuario no existe." } };
      }

      const dejaDeSerAdmin = usuario.rol === Rol.ADMIN && usuario.activo && body.rol !== Rol.ADMIN;
      if (dejaDeSerAdmin && (await quedaSinAdminActivo(cliente, usuario.id))) {
        set.status = 409;
        return {
          error: {
            codigo: "ULTIMO_ADMIN",
            mensaje: "No puedes quitarle el rol de ADMIN al único ADMIN activo de la empresa.",
          },
        };
      }

      const actualizado = await cliente.usuario.update({ where: { id: params.id }, data: { rol: body.rol } });
      return { usuario: respuestaUsuario(actualizado) };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ rol: t.Enum(Rol) }),
      response: {
        200: t.Object({ usuario: esquemaUsuario }),
        403: esquemaError,
        404: esquemaError,
        409: esquemaError,
      },
    },
  )
  // Cargar saldo: mueve plata a favor del revendedor. Misma disciplina de
  // bloqueo que la venta (lib/bloqueo-usuario.ts) — bloquear la fila de
  // Usuario antes de leer su saldo, para no perder una carga concurrente con
  // una venta o con otra carga sobre el mismo usuario.
  .post(
    "/:id/saldo/cargar",
    async ({ params, body, contexto, set }) => {
      const monto = new Prisma.Decimal(body.monto);
      if (!monto.greaterThan(0)) {
        set.status = 400;
        return { error: { codigo: "MONTO_INVALIDO", mensaje: "El monto a cargar debe ser mayor que cero." } };
      }

      const cliente = prismaParaEmpresa(contexto.empresaId);
      const resultado = await cliente.$transaction(async (tx) => {
        const usuarioBloqueado = await bloquearUsuarioParaVenta(tx, contexto.empresaId!, params.id);
        if (!usuarioBloqueado) return { tipo: "no_encontrado" as const };
        if (usuarioBloqueado.rol !== Rol.VENDEDOR) return { tipo: "sin_saldo" as const };

        const saldoResultante = usuarioBloqueado.saldo.plus(monto);
        await tx.movimientoSaldo.create({
          data: datosSinEmpresa<Prisma.MovimientoSaldoUncheckedCreateInput>({
            usuarioId: params.id,
            tipo: "CARGA",
            monto,
            saldoResultante,
            nota: body.nota ?? null,
            creadoPorId: contexto.usuarioId!,
          }),
        });
        const actualizado = await tx.usuario.update({ where: { id: params.id }, data: { saldo: saldoResultante } });
        return { tipo: "ok" as const, usuario: actualizado };
      });

      if (resultado.tipo === "no_encontrado") {
        set.status = 404;
        return { error: { codigo: "USUARIO_NO_ENCONTRADO", mensaje: "El usuario no existe." } };
      }
      if (resultado.tipo === "sin_saldo") {
        set.status = 409;
        return { error: { codigo: "USUARIO_SIN_SALDO", mensaje: "Este usuario no vende contra saldo." } };
      }
      return { usuario: respuestaUsuario(resultado.usuario) };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ monto: dineroPositivo, nota: t.Optional(t.String()) }),
      response: {
        200: t.Object({ usuario: esquemaUsuario }),
        400: esquemaError,
        404: esquemaError,
        409: esquemaError,
      },
    },
  )
  // Ajuste: corrección manual del saldo, con nota obligatoria (R3 — los
  // movimientos nunca se editan ni se borran; un error se corrige con un
  // movimiento nuevo, nunca modificando uno existente). Monto con signo:
  // positivo suma, negativo resta.
  .post(
    "/:id/saldo/ajuste",
    async ({ params, body, contexto, set }) => {
      const monto = new Prisma.Decimal(body.monto);
      if (monto.isZero()) {
        set.status = 400;
        return { error: { codigo: "MONTO_INVALIDO", mensaje: "El monto del ajuste no puede ser cero." } };
      }

      const cliente = prismaParaEmpresa(contexto.empresaId);
      const resultado = await cliente.$transaction(async (tx) => {
        const usuarioBloqueado = await bloquearUsuarioParaVenta(tx, contexto.empresaId!, params.id);
        if (!usuarioBloqueado) return { tipo: "no_encontrado" as const };
        if (usuarioBloqueado.rol !== Rol.VENDEDOR) return { tipo: "sin_saldo" as const };

        const saldoResultante = usuarioBloqueado.saldo.plus(monto);
        await tx.movimientoSaldo.create({
          data: datosSinEmpresa<Prisma.MovimientoSaldoUncheckedCreateInput>({
            usuarioId: params.id,
            tipo: "AJUSTE",
            monto,
            saldoResultante,
            nota: body.nota,
            creadoPorId: contexto.usuarioId!,
          }),
        });
        const actualizado = await tx.usuario.update({ where: { id: params.id }, data: { saldo: saldoResultante } });
        return { tipo: "ok" as const, usuario: actualizado };
      });

      if (resultado.tipo === "no_encontrado") {
        set.status = 404;
        return { error: { codigo: "USUARIO_NO_ENCONTRADO", mensaje: "El usuario no existe." } };
      }
      if (resultado.tipo === "sin_saldo") {
        set.status = 409;
        return { error: { codigo: "USUARIO_SIN_SALDO", mensaje: "Este usuario no vende contra saldo." } };
      }
      return { usuario: respuestaUsuario(resultado.usuario) };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ monto: dineroConSigno, nota: t.String({ minLength: 1 }) }),
      response: {
        200: t.Object({ usuario: esquemaUsuario }),
        400: esquemaError,
        404: esquemaError,
        409: esquemaError,
      },
    },
  )
  .get(
    "/:id/saldo/movimientos",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const usuario = await cliente.usuario.findUnique({ where: { id: params.id } });
      if (!usuario) {
        set.status = 404;
        return { error: { codigo: "USUARIO_NO_ENCONTRADO", mensaje: "El usuario no existe." } };
      }

      const movimientos = await cliente.movimientoSaldo.findMany({
        where: { usuarioId: params.id },
        orderBy: { createdAt: "desc" },
      });
      return { usuario: respuestaUsuario(usuario), movimientos: movimientos.map(respuestaMovimientoSaldo) };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ usuario: esquemaUsuario, movimientos: t.Array(esquemaMovimientoSaldo) }),
        404: esquemaError,
      },
    },
  );
