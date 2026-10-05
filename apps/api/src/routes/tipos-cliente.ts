import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { restriccionViolada } from "../lib/errores.ts";
import { impactoDesactivarTipoCliente } from "../lib/impacto-catalogo.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaTipoCliente = t.Object({
  id: t.String(),
  nombre: t.String(),
  activo: t.Boolean(),
});

const esquemaImpacto = t.Object({
  preciosActivos: t.Number(),
  paquetesAfectados: t.Array(t.Object({ id: t.String(), nombre: t.String() })),
});

interface FilaTipoCliente {
  id: string;
  nombre: string;
  activo: boolean;
}

const respuestaTipoCliente = (fila: FilaTipoCliente) => ({
  id: fila.id,
  nombre: fila.nombre,
  activo: fila.activo,
});

const cuerpoTipoCliente = t.Object({
  nombre: t.String({ minLength: 1 }),
});

// Catálogo — CRUD sin borrado (R3/Parte 6): las entidades de catálogo se
// desactivan, nunca se borran, porque hay ventas históricas que las
// referencian. No existe ningún endpoint DELETE aquí.
export const tiposCliente = new Elysia({ prefix: "/tipos-cliente" })
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
      const filas = await cliente.tipoCliente.findMany({ orderBy: { nombre: "asc" } });
      return { tiposCliente: filas.map(respuestaTipoCliente) };
    },
    { response: { 200: t.Object({ tiposCliente: t.Array(esquemaTipoCliente) }) } },
  )
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const tipoCliente = await cliente.tipoCliente.create({
          data: datosSinEmpresa<Prisma.TipoClienteUncheckedCreateInput>({ nombre: body.nombre }),
        });
        set.status = 201;
        return { tipoCliente: respuestaTipoCliente(tipoCliente) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: {
                codigo: "NOMBRE_EN_USO",
                mensaje: `Ya existe un tipo de cliente activo llamado "${body.nombre}".`,
              },
            };
          }
        }
        throw error;
      }
    },
    { body: cuerpoTipoCliente, response: { 201: t.Object({ tipoCliente: esquemaTipoCliente }), 409: esquemaError } },
  )
  .patch(
    "/:id",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const tipoCliente = await cliente.tipoCliente.update({
          where: { id: params.id },
          data: { nombre: body.nombre },
        });
        return { tipoCliente: respuestaTipoCliente(tipoCliente) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: {
                codigo: "NOMBRE_EN_USO",
                mensaje: `Ya existe un tipo de cliente activo llamado "${body.nombre}".`,
              },
            };
          }
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "TIPO_CLIENTE_NO_ENCONTRADO", mensaje: "El tipo de cliente no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: cuerpoTipoCliente,
      response: { 200: t.Object({ tipoCliente: esquemaTipoCliente }), 404: esquemaError, 409: esquemaError },
    },
  )
  .get(
    "/:id/impacto-desactivacion",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const tipoCliente = await cliente.tipoCliente.findUnique({ where: { id: params.id } });
      if (!tipoCliente) {
        set.status = 404;
        return { error: { codigo: "TIPO_CLIENTE_NO_ENCONTRADO", mensaje: "El tipo de cliente no existe." } };
      }
      return await impactoDesactivarTipoCliente(cliente, params.id);
    },
    { params: t.Object({ id: t.String() }), response: { 200: esquemaImpacto, 404: esquemaError } },
  )
  .patch(
    "/:id/activar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const tipoCliente = await cliente.tipoCliente.update({ where: { id: params.id }, data: { activo: true } });
        return { tipoCliente: respuestaTipoCliente(tipoCliente) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "TIPO_CLIENTE_NO_ENCONTRADO", mensaje: "El tipo de cliente no existe." } };
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          set.status = 409;
          return {
            error: {
              codigo: "NOMBRE_EN_USO",
              mensaje: "Ya existe otro tipo de cliente activo con este nombre. Cambia el nombre antes de reactivarlo.",
            },
          };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ tipoCliente: esquemaTipoCliente }), 404: esquemaError, 409: esquemaError },
    },
  )
  .patch(
    "/:id/desactivar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const tipoCliente = await cliente.tipoCliente.update({ where: { id: params.id }, data: { activo: false } });
        return { tipoCliente: respuestaTipoCliente(tipoCliente) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "TIPO_CLIENTE_NO_ENCONTRADO", mensaje: "El tipo de cliente no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ tipoCliente: esquemaTipoCliente }), 404: esquemaError },
    },
  );
