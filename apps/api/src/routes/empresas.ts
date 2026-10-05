import { Elysia, t } from "elysia";
import argon2 from "argon2";
import { prismaRaw } from "../lib/prisma.ts";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { restriccionViolada } from "../lib/errores.ts";
import {
  DURACION_SESION_SEGUNDOS,
  NOMBRE_COOKIE_EMPRESA_ACTIVA,
  SAME_SITE_COOKIE_SESION,
} from "../plugins/contexto.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { PLANTILLA_PAQUETE_POR_DEFECTO, PLANTILLA_UNIDAD_POR_DEFECTO } from "../lib/plantillas-default.ts";
import { TIPOS_CLIENTE_POR_DEFECTO } from "../lib/tipos-cliente-default.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaEmpresa = t.Object({
  id: t.String(),
  nombre: t.String(),
  nit: t.Union([t.String(), t.Null()]),
  prefijoCodigo: t.String(),
  activa: t.Boolean(),
});

const respuestaEmpresa = (empresa: { id: string; nombre: string; nit: string | null; prefijoCodigo: string; activa: boolean }) => ({
  id: empresa.id,
  nombre: empresa.nombre,
  nit: empresa.nit,
  prefijoCodigo: empresa.prefijoCodigo,
  activa: empresa.activa,
});

const cuerpoCrearEmpresa = t.Object({
  nombre: t.String({ minLength: 1 }),
  nit: t.Optional(t.String()),
  prefijoCodigo: t.String({ pattern: "^[A-Z]{3}$" }),
  adminNombre: t.String({ minLength: 1 }),
  adminEmail: t.String({ format: "email" }),
  adminPassword: t.String({ minLength: 8 }),
});

export const empresas = new Elysia({ prefix: "/empresas" })
  // Crear empresa: ADMIN o SUPER_ADMIN (decisión D2 del PRD). El ADMIN que
  // crea la empresa no obtiene ningún acceso a ella — solo queda registrado
  // en Empresa.creadaPorUsuarioId, con fines de trazabilidad.
  .use(requiereRol(Rol.ADMIN))
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const { nombre, nit, prefijoCodigo, adminNombre, adminEmail, adminPassword } = body;

      // El hash se calcula ANTES de abrir la transacción: es una operación
      // de CPU (Argon2id), no debe mantener ocupada la conexión/transacción
      // de Postgres mientras corre.
      const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });

      try {
        const resultado = await prismaRaw.$transaction(async (tx) => {
          // Empresa no tiene empresaId (R1): se crea con el cliente sin
          // extender, dentro de la transacción — excepción autorizada
          // (lista blanca de R1: rutas de empresas que escriben Empresa).
          const empresa = await tx.empresa.create({
            data: { nombre, nit: nit ?? null, prefijoCodigo, creadaPorUsuarioId: contexto.usuarioId },
          });

          // El primer ADMIN de la empresa nueva SÍ pasa por prismaParaEmpresa
          // (R1), operando sobre `tx` — misma conexión/transacción que la
          // creación de la empresa, así que si esto falla (ej. correo
          // duplicado) la empresa recién creada se revierte también.
          const admin = await prismaParaEmpresa(empresa.id, tx).usuario.create({
            data: { email: adminEmail, passwordHash, nombre: adminNombre, rol: Rol.ADMIN },
          });

          // Plantillas de mensaje por defecto (Anexo B): sin esto la empresa
          // nueva no podría vender nada — realizarVenta necesita una
          // PlantillaMensaje por tipo para generar el mensaje de WhatsApp.
          // El ADMIN las podrá editar más adelante; el valor inicial es este.
          const clienteEmpresa = prismaParaEmpresa(empresa.id, tx);
          await clienteEmpresa.plantillaMensaje.create({
            data: datosSinEmpresa<Prisma.PlantillaMensajeUncheckedCreateInput>({
              tipo: "UNIDAD",
              contenido: PLANTILLA_UNIDAD_POR_DEFECTO,
            }),
          });
          await clienteEmpresa.plantillaMensaje.create({
            data: datosSinEmpresa<Prisma.PlantillaMensajeUncheckedCreateInput>({
              tipo: "PAQUETE",
              contenido: PLANTILLA_PAQUETE_POR_DEFECTO,
            }),
          });

          // Tipos de cliente por defecto: sin al menos uno, el admin no
          // puede ni registrar un Precio (Precio exige tipoClienteId). El
          // admin los renombra o desactiva después.
          for (const nombre of TIPOS_CLIENTE_POR_DEFECTO) {
            await clienteEmpresa.tipoCliente.create({
              data: datosSinEmpresa<Prisma.TipoClienteUncheckedCreateInput>({ nombre }),
            });
          }

          return { empresa, admin };
        });

        set.status = 201;
        return { empresa: respuestaEmpresa(resultado.empresa) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("prefijoCodigo")) {
            set.status = 409;
            return {
              error: {
                codigo: "PREFIJO_EN_USO",
                mensaje: `Ya existe una empresa con el prefijo "${prefijoCodigo}".`,
              },
            };
          }
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
      body: cuerpoCrearEmpresa,
      response: {
        201: t.Object({ empresa: esquemaEmpresa }),
        409: esquemaError,
      },
    },
  )
  // Todo lo demás (listar, activar/desactivar, entrar/salir) es exclusivo
  // de SUPER_ADMIN: administración de la plataforma completa.
  .use(requiereRol(Rol.SUPER_ADMIN))
  .get(
    "/",
    async () => {
      // prismaRaw: excepción explícita de R1 — Empresa no tiene empresaId.
      const filas = await prismaRaw.empresa.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          nombre: true,
          nit: true,
          prefijoCodigo: true,
          activa: true,
          _count: { select: { usuarios: { where: { activo: true } } } },
        },
      });

      return {
        empresas: filas.map((fila) => ({
          ...respuestaEmpresa(fila),
          usuariosActivos: fila._count.usuarios,
        })),
      };
    },
    {
      response: {
        200: t.Object({
          empresas: t.Array(
            t.Object({
              id: t.String(),
              nombre: t.String(),
              nit: t.Union([t.String(), t.Null()]),
              prefijoCodigo: t.String(),
              activa: t.Boolean(),
              usuariosActivos: t.Number(),
            }),
          ),
        }),
      },
    },
  )
  .patch(
    "/:id/activar",
    async ({ params, set }) => {
      try {
        // prismaRaw: excepción explícita de R1 — Empresa no tiene empresaId.
        const empresa = await prismaRaw.empresa.update({ where: { id: params.id }, data: { activa: true } });
        return { empresa: respuestaEmpresa(empresa) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "EMPRESA_NO_ENCONTRADA", mensaje: "La empresa no existe." } };
        }
        throw error;
      }
    },
    { params: t.Object({ id: t.String() }), response: { 200: t.Object({ empresa: esquemaEmpresa }), 404: esquemaError } },
  )
  .patch(
    "/:id/desactivar",
    async ({ params, set }) => {
      try {
        // prismaRaw: excepción explícita de R1 — Empresa no tiene empresaId.
        const empresa = await prismaRaw.empresa.update({ where: { id: params.id }, data: { activa: false } });
        return { empresa: respuestaEmpresa(empresa) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "EMPRESA_NO_ENCONTRADA", mensaje: "La empresa no existe." } };
        }
        throw error;
      }
    },
    { params: t.Object({ id: t.String() }), response: { 200: t.Object({ empresa: esquemaEmpresa }), 404: esquemaError } },
  )
  .post(
    "/:id/entrar",
    async ({ params, cookie, set }) => {
      // prismaRaw: excepción explícita de R1 — Empresa no tiene empresaId.
      const empresa = await prismaRaw.empresa.findUnique({ where: { id: params.id } });
      if (!empresa) {
        set.status = 404;
        return { error: { codigo: "EMPRESA_NO_ENCONTRADA", mensaje: "La empresa no existe." } };
      }

      cookie[NOMBRE_COOKIE_EMPRESA_ACTIVA].set({
        value: empresa.id,
        httpOnly: true,
        sameSite: SAME_SITE_COOKIE_SESION,
        secure: process.env.NODE_ENV === "production",
        maxAge: DURACION_SESION_SEGUNDOS,
        path: "/",
      });

      return { empresa: { id: empresa.id, nombre: empresa.nombre } };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ empresa: t.Object({ id: t.String(), nombre: t.String() }) }),
        404: esquemaError,
      },
    },
  )
  .post(
    "/salir",
    ({ cookie }) => {
      cookie[NOMBRE_COOKIE_EMPRESA_ACTIVA].remove();
      return { ok: true };
    },
    { response: { 200: t.Object({ ok: t.Boolean() }) } },
  );
