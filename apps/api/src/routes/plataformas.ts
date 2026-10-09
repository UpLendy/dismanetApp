import { Elysia, t } from "elysia";
import { cifrar, descifrar } from "../lib/cifrado.ts";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { restriccionViolada } from "../lib/errores.ts";
import { impactoDesactivarPlataforma } from "../lib/impacto-catalogo.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaPlataforma = t.Object({
  id: t.String(),
  nombre: t.String(),
  nombreMensaje: t.Union([t.String(), t.Null()]),
  condiciones: t.Union([t.String(), t.Null()]),
  capacidadPantallas: t.Number(),
  usaPerfilPin: t.Boolean(),
  activa: t.Boolean(),
});

const esquemaImpacto = t.Object({
  preciosActivos: t.Number(),
  paquetesAfectados: t.Array(t.Object({ id: t.String(), nombre: t.String() })),
});

interface FilaPlataforma {
  id: string;
  nombre: string;
  nombreMensaje: string | null;
  condiciones: string | null;
  capacidadPantallas: number;
  usaPerfilPin: boolean;
  activa: boolean;
}

const respuestaPlataforma = (fila: FilaPlataforma) => ({
  id: fila.id,
  nombre: fila.nombre,
  nombreMensaje: fila.nombreMensaje,
  condiciones: fila.condiciones,
  capacidadPantallas: fila.capacidadPantallas,
  usaPerfilPin: fila.usaPerfilPin,
  activa: fila.activa,
});

const cuerpoPlataforma = t.Object({
  nombre: t.String({ minLength: 1 }),
  nombreMensaje: t.Optional(t.String()),
  condiciones: t.Optional(t.String()),
  capacidadPantallas: t.Integer({ minimum: 1 }),
  usaPerfilPin: t.Boolean(),
});

// Plantilla de pantallas (Parte 5 del encargo "plantilla de pantallas"): el
// numero de cada fila es su posición en el arreglo (1-based), no un campo del
// body — así subir/bajar la cantidad es simplemente cambiar el largo del
// arreglo desde el frontend. perfil/pin se ignoran si la plataforma no usa
// usaPerfilPin, sin importar lo que llegue en el body (igual que la
// generación de Pantalla en cuentas.ts).
const esquemaPantallaPlantilla = t.Object({
  numero: t.Number(),
  perfil: t.Union([t.String(), t.Null()]),
  pin: t.Union([t.String(), t.Null()]),
});

const esquemaPlantilla = t.Object({
  capacidadPantallas: t.Number(),
  pantallas: t.Array(esquemaPantallaPlantilla),
});

const cuerpoPlantilla = t.Object({
  pantallas: t.Array(
    t.Object({
      perfil: t.Optional(t.Union([t.String(), t.Null()])),
      pin: t.Optional(t.Union([t.String({ pattern: "^[0-9]{4}$" }), t.Null()])),
    }),
  ),
});

// Catálogo — CRUD sin borrado (R3/Parte 6): las entidades de catálogo se
// desactivan, nunca se borran, porque hay ventas históricas que las
// referencian. No existe ningún endpoint DELETE aquí.
export const plataformas = new Elysia({ prefix: "/plataformas" })
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
      const filas = await cliente.plataforma.findMany({ orderBy: { nombre: "asc" } });
      return { plataformas: filas.map(respuestaPlataforma) };
    },
    { response: { 200: t.Object({ plataformas: t.Array(esquemaPlataforma) }) } },
  )
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const plataforma = await cliente.plataforma.create({
          data: datosSinEmpresa<Prisma.PlataformaUncheckedCreateInput>({
            nombre: body.nombre,
            nombreMensaje: body.nombreMensaje ?? null,
            condiciones: body.condiciones ?? null,
            capacidadPantallas: body.capacidadPantallas,
            usaPerfilPin: body.usaPerfilPin,
          }),
        });
        set.status = 201;
        return { plataforma: respuestaPlataforma(plataforma) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: {
                codigo: "NOMBRE_EN_USO",
                mensaje: `Ya existe una plataforma activa llamada "${body.nombre}".`,
              },
            };
          }
        }
        throw error;
      }
    },
    { body: cuerpoPlataforma, response: { 201: t.Object({ plataforma: esquemaPlataforma }), 409: esquemaError } },
  )
  .patch(
    "/:id",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const plataforma = await cliente.plataforma.update({
          where: { id: params.id },
          data: {
            nombre: body.nombre,
            nombreMensaje: body.nombreMensaje ?? null,
            condiciones: body.condiciones ?? null,
            capacidadPantallas: body.capacidadPantallas,
            usaPerfilPin: body.usaPerfilPin,
          },
        });
        return { plataforma: respuestaPlataforma(plataforma) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: {
                codigo: "NOMBRE_EN_USO",
                mensaje: `Ya existe una plataforma activa llamada "${body.nombre}".`,
              },
            };
          }
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: cuerpoPlataforma,
      response: { 200: t.Object({ plataforma: esquemaPlataforma }), 404: esquemaError, 409: esquemaError },
    },
  )
  .get(
    "/:id/impacto-desactivacion",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const plataforma = await cliente.plataforma.findUnique({ where: { id: params.id } });
      if (!plataforma) {
        set.status = 404;
        return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
      }
      return await impactoDesactivarPlataforma(cliente, params.id);
    },
    { params: t.Object({ id: t.String() }), response: { 200: esquemaImpacto, 404: esquemaError } },
  )
  .patch(
    "/:id/activar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const plataforma = await cliente.plataforma.update({ where: { id: params.id }, data: { activa: true } });
        return { plataforma: respuestaPlataforma(plataforma) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          set.status = 409;
          return {
            error: {
              codigo: "NOMBRE_EN_USO",
              mensaje: "Ya existe otra plataforma activa con este nombre. Cambia el nombre antes de reactivarla.",
            },
          };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ plataforma: esquemaPlataforma }), 404: esquemaError, 409: esquemaError },
    },
  )
  .patch(
    "/:id/desactivar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const plataforma = await cliente.plataforma.update({ where: { id: params.id }, data: { activa: false } });
        return { plataforma: respuestaPlataforma(plataforma) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ plataforma: esquemaPlataforma }), 404: esquemaError },
    },
  )
  // Plantilla de pantallas (Parte 1 y 5 del encargo "plantilla de
  // pantallas"): de aquí copia POST /cuentas cada Pantalla nueva. Editar la
  // plantilla NUNCA toca una Pantalla ya creada (R3) — ver cuentas.ts.
  .get(
    "/:id/pantallas",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const plataforma = await cliente.plataforma.findUnique({ where: { id: params.id } });
      if (!plataforma) {
        set.status = 404;
        return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
      }

      const filas = await cliente.plataformaPantalla.findMany({
        where: { plataformaId: params.id },
        orderBy: { numero: "asc" },
      });

      return {
        capacidadPantallas: filas.length,
        pantallas: filas.map((f) => ({ numero: f.numero, perfil: f.perfil, pin: f.pin ? descifrar(f.pin) : null })),
      };
    },
    { params: t.Object({ id: t.String() }), response: { 200: esquemaPlantilla, 404: esquemaError } },
  )
  .put(
    "/:id/pantallas",
    async ({ params, body, contexto, set }) => {
      const resultado = await prismaParaEmpresa(contexto.empresaId).$transaction(async (txCliente) => {
        const plataforma = await txCliente.plataforma.findUnique({ where: { id: params.id } });
        if (!plataforma) return null;

        for (const [indice, fila] of body.pantallas.entries()) {
          const numero = indice + 1;
          const perfil = plataforma.usaPerfilPin ? fila.perfil ?? null : null;
          const pin = plataforma.usaPerfilPin && fila.pin ? cifrar(fila.pin) : null;

          const existente = await txCliente.plataformaPantalla.findFirst({
            where: { plataformaId: params.id, numero },
          });
          if (existente) {
            await txCliente.plataformaPantalla.update({ where: { id: existente.id }, data: { perfil, pin } });
          } else {
            await txCliente.plataformaPantalla.create({
              data: datosSinEmpresa<Prisma.PlataformaPantallaUncheckedCreateInput>({
                plataformaId: params.id,
                numero,
                perfil,
                pin,
              }),
            });
          }
        }

        // Baja de cantidad: borra solo las filas de LA PLANTILLA que
        // sobraron (nunca una Pantalla real — eso no es inventario, ver
        // CLAUDE.md Parte 5).
        await txCliente.plataformaPantalla.deleteMany({
          where: { plataformaId: params.id, numero: { gt: body.pantallas.length } },
        });

        await txCliente.plataforma.update({
          where: { id: params.id },
          data: { capacidadPantallas: body.pantallas.length },
        });

        return await txCliente.plataformaPantalla.findMany({
          where: { plataformaId: params.id },
          orderBy: { numero: "asc" },
        });
      });

      if (!resultado) {
        set.status = 404;
        return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
      }

      return {
        capacidadPantallas: resultado.length,
        pantallas: resultado.map((f) => ({ numero: f.numero, perfil: f.perfil, pin: f.pin ? descifrar(f.pin) : null })),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: cuerpoPlantilla,
      response: { 200: esquemaPlantilla, 404: esquemaError },
    },
  );
