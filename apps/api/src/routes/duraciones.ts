import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol, type UnidadDuracion } from "../generated/prisma/client.ts";
import { restriccionViolada } from "../lib/errores.ts";
import { impactoDesactivarDuracion } from "../lib/impacto-catalogo.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaDuracion = t.Object({
  id: t.String(),
  nombre: t.String(),
  cantidad: t.Number(),
  unidad: t.Union([t.Literal("DIAS"), t.Literal("MESES")]),
  activa: t.Boolean(),
});

const esquemaImpacto = t.Object({
  preciosActivos: t.Number(),
  paquetesAfectados: t.Array(t.Object({ id: t.String(), nombre: t.String() })),
});

interface FilaDuracion {
  id: string;
  nombre: string;
  cantidad: number;
  unidad: UnidadDuracion;
  activa: boolean;
}

const respuestaDuracion = (fila: FilaDuracion) => ({
  id: fila.id,
  nombre: fila.nombre,
  cantidad: fila.cantidad,
  unidad: fila.unidad,
  activa: fila.activa,
});

const cuerpoDuracion = t.Object({
  nombre: t.String({ minLength: 1 }),
  cantidad: t.Integer({ minimum: 1 }),
  unidad: t.Union([t.Literal("DIAS"), t.Literal("MESES")]),
});

// Catálogo — CRUD sin borrado (R3/Parte 6): las entidades de catálogo se
// desactivan, nunca se borran, porque hay ventas históricas que las
// referencian. No existe ningún endpoint DELETE aquí.
export const duraciones = new Elysia({ prefix: "/duraciones" })
  .use(requiereRol(Rol.ADMIN))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: {
          codigo: "SIN_EMPRESA_ACTIVA",
          mensaje: "Selecciona una empresa antes de gestionar su catálogo.",
        },
      };
    }
  })
  .get(
    "/",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const filas = await cliente.duracion.findMany({ orderBy: { nombre: "asc" } });
      return { duraciones: filas.map(respuestaDuracion) };
    },
    { response: { 200: t.Object({ duraciones: t.Array(esquemaDuracion) }) } },
  )
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const duracion = await cliente.duracion.create({
          data: datosSinEmpresa<Prisma.DuracionUncheckedCreateInput>({
            nombre: body.nombre,
            cantidad: body.cantidad,
            unidad: body.unidad,
          }),
        });
        set.status = 201;
        return { duracion: respuestaDuracion(duracion) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: { codigo: "NOMBRE_EN_USO", mensaje: `Ya existe una duración activa llamada "${body.nombre}".` },
            };
          }
        }
        throw error;
      }
    },
    { body: cuerpoDuracion, response: { 201: t.Object({ duracion: esquemaDuracion }), 409: esquemaError } },
  )
  .patch(
    "/:id",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const duracion = await cliente.duracion.update({
          where: { id: params.id },
          data: { nombre: body.nombre, cantidad: body.cantidad, unidad: body.unidad },
        });
        return { duracion: respuestaDuracion(duracion) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: { codigo: "NOMBRE_EN_USO", mensaje: `Ya existe una duración activa llamada "${body.nombre}".` },
            };
          }
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "DURACION_NO_ENCONTRADA", mensaje: "La duración no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: cuerpoDuracion,
      response: { 200: t.Object({ duracion: esquemaDuracion }), 404: esquemaError, 409: esquemaError },
    },
  )
  .get(
    "/:id/impacto-desactivacion",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const duracion = await cliente.duracion.findUnique({ where: { id: params.id } });
      if (!duracion) {
        set.status = 404;
        return { error: { codigo: "DURACION_NO_ENCONTRADA", mensaje: "La duración no existe." } };
      }
      return await impactoDesactivarDuracion(cliente, params.id);
    },
    { params: t.Object({ id: t.String() }), response: { 200: esquemaImpacto, 404: esquemaError } },
  )
  .patch(
    "/:id/activar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const duracion = await cliente.duracion.update({ where: { id: params.id }, data: { activa: true } });
        return { duracion: respuestaDuracion(duracion) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "DURACION_NO_ENCONTRADA", mensaje: "La duración no existe." } };
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          set.status = 409;
          return {
            error: {
              codigo: "NOMBRE_EN_USO",
              mensaje: "Ya existe otra duración activa con este nombre. Cambia el nombre antes de reactivarla.",
            },
          };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ duracion: esquemaDuracion }), 404: esquemaError, 409: esquemaError },
    },
  )
  .patch(
    "/:id/desactivar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const duracion = await cliente.duracion.update({ where: { id: params.id }, data: { activa: false } });
        return { duracion: respuestaDuracion(duracion) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "DURACION_NO_ENCONTRADA", mensaje: "La duración no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ duracion: esquemaDuracion }), 404: esquemaError },
    },
  );
