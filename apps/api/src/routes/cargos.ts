import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { restriccionViolada } from "../lib/errores.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaCargo = t.Object({
  id: t.String(),
  nombre: t.String(),
  activo: t.Boolean(),
});

interface FilaCargo {
  id: string;
  nombre: string;
  activo: boolean;
}

const respuestaCargo = (fila: FilaCargo) => ({
  id: fila.id,
  nombre: fila.nombre,
  activo: fila.activo,
});

const cuerpoCargo = t.Object({
  nombre: t.String({ minLength: 1 }),
});

// Catálogo — CRUD sin borrado (R3): el cargo es el oficio (Gerencia,
// Coordinación, Soporte técnico...), no el Rol — no concede ningún permiso
// por sí mismo (ver CLAUDE.md, F6.1). Se desactiva, nunca se borra: un cargo
// desactivado deja de ofrecerse para asignaciones NUEVAS, pero los usuarios
// que ya lo tienen lo conservan — su historial no cambia porque alguien
// reorganice el catálogo. No existe ningún endpoint DELETE aquí.
export const cargos = new Elysia({ prefix: "/cargos" })
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
    async ({ query, contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const filas = await cliente.cargo.findMany({
        where: {
          ...(query.estado === "activo" ? { activo: true } : query.estado === "inactivo" ? { activo: false } : {}),
        },
        orderBy: { nombre: "asc" },
      });
      return { cargos: filas.map(respuestaCargo) };
    },
    {
      query: t.Object({
        estado: t.Optional(t.Union([t.Literal("activo"), t.Literal("inactivo")])),
      }),
      response: { 200: t.Object({ cargos: t.Array(esquemaCargo) }) },
    },
  )
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const cargo = await cliente.cargo.create({
          data: datosSinEmpresa<Prisma.CargoUncheckedCreateInput>({ nombre: body.nombre }),
        });
        set.status = 201;
        return { cargo: respuestaCargo(cargo) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: {
                codigo: "NOMBRE_EN_USO",
                mensaje: `Ya existe un cargo activo llamado "${body.nombre}".`,
              },
            };
          }
        }
        throw error;
      }
    },
    { body: cuerpoCargo, response: { 201: t.Object({ cargo: esquemaCargo }), 409: esquemaError } },
  )
  .patch(
    "/:id",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const cargo = await cliente.cargo.update({
          where: { id: params.id },
          data: { nombre: body.nombre },
        });
        return { cargo: respuestaCargo(cargo) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: {
                codigo: "NOMBRE_EN_USO",
                mensaje: `Ya existe un cargo activo llamado "${body.nombre}".`,
              },
            };
          }
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "CARGO_NO_ENCONTRADO", mensaje: "El cargo no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: cuerpoCargo,
      response: { 200: t.Object({ cargo: esquemaCargo }), 404: esquemaError, 409: esquemaError },
    },
  )
  .patch(
    "/:id/activar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const cargo = await cliente.cargo.update({ where: { id: params.id }, data: { activo: true } });
        return { cargo: respuestaCargo(cargo) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "CARGO_NO_ENCONTRADO", mensaje: "El cargo no existe." } };
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          set.status = 409;
          return {
            error: {
              codigo: "NOMBRE_EN_USO",
              mensaje: "Ya existe otro cargo activo con este nombre. Cambia el nombre antes de reactivarlo.",
            },
          };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ cargo: esquemaCargo }), 404: esquemaError, 409: esquemaError },
    },
  )
  .patch(
    "/:id/desactivar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        // No desasigna a quien ya lo tiene (R3): solo deja de ofrecerse para
        // asignaciones nuevas en routes/usuarios.ts. Usuario.cargoId no se toca.
        const cargo = await cliente.cargo.update({ where: { id: params.id }, data: { activo: false } });
        return { cargo: respuestaCargo(cargo) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "CARGO_NO_ENCONTRADO", mensaje: "El cargo no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ cargo: esquemaCargo }), 404: esquemaError },
    },
  );
