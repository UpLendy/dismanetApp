import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol, type UnidadDuracion } from "../generated/prisma/client.ts";
import { restriccionViolada } from "../lib/errores.ts";
import { impactoDesactivarPaquete } from "../lib/impacto-catalogo.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaPaquete = t.Object({
  id: t.String(),
  nombre: t.String(),
  descripcion: t.Union([t.String(), t.Null()]),
  activo: t.Boolean(),
  esPromocion: t.Boolean(),
});

const esquemaComponente = t.Object({
  plataformaId: t.String(),
  nombrePlataforma: t.String(),
  cantidadPantallas: t.Number(),
});

const esquemaExcepcion = t.Object({
  duracionVendidaId: t.String(),
  duracionVendidaNombre: t.String(),
  plataformaId: t.String(),
  nombrePlataforma: t.String(),
  duracionRealId: t.String(),
  duracionRealNombre: t.String(),
});

const esquemaDuracion = t.Object({
  id: t.String(),
  nombre: t.String(),
});

const esquemaImpacto = t.Object({
  preciosActivos: t.Number(),
  paquetesAfectados: t.Array(t.Object({ id: t.String(), nombre: t.String() })),
});

interface FilaPaquete {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  esPromocion: boolean;
}

const respuestaPaquete = (fila: FilaPaquete) => ({
  id: fila.id,
  nombre: fila.nombre,
  descripcion: fila.descripcion,
  activo: fila.activo,
  esPromocion: fila.esPromocion,
});

const cuerpoPaquete = t.Object({
  nombre: t.String({ minLength: 1 }),
  descripcion: t.Optional(t.Union([t.String(), t.Null()])),
  esPromocion: t.Optional(t.Boolean()),
});

// Heurística para la advertencia de la Parte 4 ("estás entregando más
// tiempo del que vendes"): no necesita ser exacta, solo comparar
// magnitudes. MESES se aproxima a 30 días porque addMonths (date-fns) es
// quien calcula la fecha real de vencimiento en la venta — aquí solo se
// decide si se muestra el aviso.
function diasAproximados(duracion: { cantidad: number; unidad: UnidadDuracion }): number {
  return duracion.unidad === "MESES" ? duracion.cantidad * 30 : duracion.cantidad;
}

// Catálogo — CRUD sin borrado (R3) para el paquete en sí: se desactiva,
// nunca se borra, porque hay ventas históricas que lo referencian. La
// composición (PaquetePlataforma) y sus excepciones de duración
// (PaqueteDuracionPlataforma) sí se borran: son configuración vigente, no
// histórico — la venta copia lo que necesita al momento de vender (R3).
export const paquetes = new Elysia({ prefix: "/paquetes" })
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
      const filas = await cliente.paquete.findMany({
        orderBy: { nombre: "asc" },
        include: {
          paquetePlataformas: {
            orderBy: { plataformaId: "asc" },
            include: { plataforma: { select: { nombre: true } } },
          },
          paqueteDuracionPlataformas: {
            include: {
              duracionVendida: { select: { nombre: true } },
              duracionReal: { select: { nombre: true } },
              plataforma: { select: { nombre: true } },
            },
          },
        },
      });

      return {
        paquetes: filas.map((fila) => ({
          ...respuestaPaquete(fila),
          composicion: fila.paquetePlataformas.map((c) => ({
            plataformaId: c.plataformaId,
            nombrePlataforma: c.plataforma.nombre,
            cantidadPantallas: c.cantidadPantallas,
          })),
          excepciones: fila.paqueteDuracionPlataformas.map((e) => ({
            duracionVendidaId: e.duracionVendidaId,
            duracionVendidaNombre: e.duracionVendida.nombre,
            plataformaId: e.plataformaId,
            nombrePlataforma: e.plataforma.nombre,
            duracionRealId: e.duracionRealId,
            duracionRealNombre: e.duracionReal.nombre,
          })),
        })),
      };
    },
    {
      response: {
        200: t.Object({
          paquetes: t.Array(
            t.Composite([
              esquemaPaquete,
              t.Object({ composicion: t.Array(esquemaComponente), excepciones: t.Array(esquemaExcepcion) }),
            ]),
          ),
        }),
      },
    },
  )
  .get(
    "/:id",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const paquete = await cliente.paquete.findUnique({
        where: { id: params.id },
        include: {
          paquetePlataformas: {
            orderBy: { plataformaId: "asc" },
            include: { plataforma: { select: { nombre: true } } },
          },
          paqueteDuracionPlataformas: {
            include: {
              duracionVendida: { select: { nombre: true } },
              duracionReal: { select: { nombre: true } },
              plataforma: { select: { nombre: true } },
            },
          },
        },
      });
      if (!paquete) {
        set.status = 404;
        return { error: { codigo: "PAQUETE_NO_ENCONTRADO", mensaje: "El paquete no existe." } };
      }

      const duracionesActivas = await cliente.duracion.findMany({
        where: { activa: true },
        orderBy: { nombre: "asc" },
        select: { id: true, nombre: true },
      });

      return {
        paquete: respuestaPaquete(paquete),
        composicion: paquete.paquetePlataformas.map((c) => ({
          plataformaId: c.plataformaId,
          nombrePlataforma: c.plataforma.nombre,
          cantidadPantallas: c.cantidadPantallas,
        })),
        excepciones: paquete.paqueteDuracionPlataformas.map((e) => ({
          duracionVendidaId: e.duracionVendidaId,
          duracionVendidaNombre: e.duracionVendida.nombre,
          plataformaId: e.plataformaId,
          nombrePlataforma: e.plataforma.nombre,
          duracionRealId: e.duracionRealId,
          duracionRealNombre: e.duracionReal.nombre,
        })),
        duracionesActivas,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({
          paquete: esquemaPaquete,
          composicion: t.Array(esquemaComponente),
          excepciones: t.Array(esquemaExcepcion),
          duracionesActivas: t.Array(esquemaDuracion),
        }),
        404: esquemaError,
      },
    },
  )
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const paquete = await cliente.paquete.create({
          data: datosSinEmpresa<Prisma.PaqueteUncheckedCreateInput>({
            nombre: body.nombre,
            descripcion: body.descripcion ?? null,
            esPromocion: body.esPromocion ?? false,
          }),
        });
        set.status = 201;
        return { paquete: respuestaPaquete(paquete) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: {
                codigo: "NOMBRE_EN_USO",
                mensaje: `Ya existe un paquete activo llamado "${body.nombre}".`,
              },
            };
          }
        }
        throw error;
      }
    },
    { body: cuerpoPaquete, response: { 201: t.Object({ paquete: esquemaPaquete }), 409: esquemaError } },
  )
  .patch(
    "/:id",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const paquete = await cliente.paquete.update({
          where: { id: params.id },
          data: { nombre: body.nombre, descripcion: body.descripcion ?? null, esPromocion: body.esPromocion ?? false },
        });
        return { paquete: respuestaPaquete(paquete) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: {
                codigo: "NOMBRE_EN_USO",
                mensaje: `Ya existe un paquete activo llamado "${body.nombre}".`,
              },
            };
          }
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "PAQUETE_NO_ENCONTRADO", mensaje: "El paquete no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: cuerpoPaquete,
      response: { 200: t.Object({ paquete: esquemaPaquete }), 404: esquemaError, 409: esquemaError },
    },
  )
  .get(
    "/:id/impacto-desactivacion",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const paquete = await cliente.paquete.findUnique({ where: { id: params.id } });
      if (!paquete) {
        set.status = 404;
        return { error: { codigo: "PAQUETE_NO_ENCONTRADO", mensaje: "El paquete no existe." } };
      }
      return await impactoDesactivarPaquete(cliente, params.id);
    },
    { params: t.Object({ id: t.String() }), response: { 200: esquemaImpacto, 404: esquemaError } },
  )
  .patch(
    "/:id/activar",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const paquete = await cliente.paquete.findUnique({ where: { id: params.id } });
      if (!paquete) {
        set.status = 404;
        return { error: { codigo: "PAQUETE_NO_ENCONTRADO", mensaje: "El paquete no existe." } };
      }

      const totalComponentes = await cliente.paquetePlataforma.count({ where: { paqueteId: params.id } });
      if (totalComponentes === 0) {
        set.status = 400;
        return {
          error: {
            codigo: "PAQUETE_SIN_PLATAFORMAS",
            mensaje: "Este paquete no tiene plataformas en su composición. Agrega al menos una antes de activarlo.",
          },
        };
      }

      try {
        const actualizado = await cliente.paquete.update({ where: { id: params.id }, data: { activo: true } });
        return { paquete: respuestaPaquete(actualizado) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          set.status = 409;
          return {
            error: {
              codigo: "NOMBRE_EN_USO",
              mensaje: "Ya existe otro paquete activo con este nombre. Cambia el nombre antes de reactivarlo.",
            },
          };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ paquete: esquemaPaquete }), 400: esquemaError, 404: esquemaError, 409: esquemaError },
    },
  )
  .patch(
    "/:id/desactivar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const paquete = await cliente.paquete.update({ where: { id: params.id }, data: { activo: false } });
        return { paquete: respuestaPaquete(paquete) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "PAQUETE_NO_ENCONTRADO", mensaje: "El paquete no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ paquete: esquemaPaquete }), 404: esquemaError },
    },
  )
  // ---------------------------------------------------------------------
  // Composición (Parte 3)
  // ---------------------------------------------------------------------
  .post(
    "/:id/plataformas",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);

      const paquete = await cliente.paquete.findUnique({ where: { id: params.id } });
      if (!paquete) {
        set.status = 404;
        return { error: { codigo: "PAQUETE_NO_ENCONTRADO", mensaje: "El paquete no existe." } };
      }

      const plataforma = await cliente.plataforma.findUnique({ where: { id: body.plataformaId } });
      if (!plataforma) {
        set.status = 404;
        return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
      }
      if (!plataforma.activa) {
        set.status = 400;
        return {
          error: {
            codigo: "PLATAFORMA_INACTIVA",
            mensaje: "Solo se pueden agregar plataformas activas a un paquete.",
          },
        };
      }

      try {
        const componente = await cliente.paquetePlataforma.create({
          data: datosSinEmpresa<Prisma.PaquetePlataformaUncheckedCreateInput>({
            paqueteId: params.id,
            plataformaId: body.plataformaId,
            cantidadPantallas: body.cantidadPantallas ?? 1,
          }),
        });
        set.status = 201;
        return {
          componente: {
            plataformaId: componente.plataformaId,
            nombrePlataforma: plataforma.nombre,
            cantidadPantallas: componente.cantidadPantallas,
          },
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("paqueteId") || objetivo.includes("plataformaId")) {
            set.status = 409;
            return {
              error: {
                codigo: "PLATAFORMA_DUPLICADA",
                mensaje:
                  'Esta plataforma ya hace parte del paquete. Para pedir más pantallas sube "cantidadPantallas" en vez de agregarla otra vez.',
              },
            };
          }
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ plataformaId: t.String(), cantidadPantallas: t.Optional(t.Number({ minimum: 1 })) }),
      response: {
        201: t.Object({ componente: esquemaComponente }),
        400: esquemaError,
        404: esquemaError,
        409: esquemaError,
      },
    },
  )
  .patch(
    "/:id/plataformas/:plataformaId",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const componente = await cliente.paquetePlataforma.update({
          where: { paqueteId_plataformaId: { paqueteId: params.id, plataformaId: params.plataformaId } },
          data: { cantidadPantallas: body.cantidadPantallas },
          include: { plataforma: { select: { nombre: true } } },
        });
        return {
          componente: {
            plataformaId: componente.plataformaId,
            nombrePlataforma: componente.plataforma.nombre,
            cantidadPantallas: componente.cantidadPantallas,
          },
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return {
            error: { codigo: "COMPONENTE_NO_ENCONTRADO", mensaje: "Esa plataforma no hace parte de este paquete." },
          };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String(), plataformaId: t.String() }),
      body: t.Object({ cantidadPantallas: t.Number({ minimum: 1 }) }),
      response: { 200: t.Object({ componente: esquemaComponente }), 404: esquemaError },
    },
  )
  .delete(
    "/:id/plataformas/:plataformaId",
    async ({ params, contexto, set }) => {
      const resultado = await prismaParaEmpresa(contexto.empresaId).$transaction(async (txCliente) => {
        const paquete = await txCliente.paquete.findUnique({ where: { id: params.id } });
        if (!paquete) return { tipo: "paquete-no-encontrado" as const };

        const componente = await txCliente.paquetePlataforma.findUnique({
          where: { paqueteId_plataformaId: { paqueteId: params.id, plataformaId: params.plataformaId } },
        });
        if (!componente) return { tipo: "componente-no-encontrado" as const };

        const totalComponentes = await txCliente.paquetePlataforma.count({ where: { paqueteId: params.id } });
        if (paquete.activo && totalComponentes <= 1) return { tipo: "ultimo-componente" as const };

        // Quitar la plataforma elimina también sus excepciones de duración,
        // en la misma transacción (Parte 3).
        await txCliente.paqueteDuracionPlataforma.deleteMany({
          where: { paqueteId: params.id, plataformaId: params.plataformaId },
        });
        await txCliente.paquetePlataforma.delete({
          where: { paqueteId_plataformaId: { paqueteId: params.id, plataformaId: params.plataformaId } },
        });
        return { tipo: "ok" as const };
      });

      if (resultado.tipo === "paquete-no-encontrado") {
        set.status = 404;
        return { error: { codigo: "PAQUETE_NO_ENCONTRADO", mensaje: "El paquete no existe." } };
      }
      if (resultado.tipo === "componente-no-encontrado") {
        set.status = 404;
        return {
          error: { codigo: "COMPONENTE_NO_ENCONTRADO", mensaje: "Esa plataforma no hace parte de este paquete." },
        };
      }
      if (resultado.tipo === "ultimo-componente") {
        set.status = 400;
        return {
          error: {
            codigo: "PAQUETE_SIN_PLATAFORMAS",
            mensaje:
              "Un paquete activo no puede quedarse sin plataformas. Desactívalo antes de quitar la última.",
          },
        };
      }
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String(), plataformaId: t.String() }),
      response: { 200: t.Object({ ok: t.Boolean() }), 400: esquemaError, 404: esquemaError },
    },
  )
  // ---------------------------------------------------------------------
  // Excepciones de duración (Parte 4)
  // ---------------------------------------------------------------------
  .put(
    "/:id/excepciones",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);

      const componente = await cliente.paquetePlataforma.findUnique({
        where: { paqueteId_plataformaId: { paqueteId: params.id, plataformaId: body.plataformaId } },
      });
      if (!componente) {
        set.status = 400;
        return {
          error: {
            codigo: "PLATAFORMA_NO_EN_PAQUETE",
            mensaje: "Esa plataforma no hace parte de la composición de este paquete.",
          },
        };
      }

      // Igual a la vendida: se borra la fila de excepción si existía.
      if (body.duracionRealId === body.duracionVendidaId) {
        await cliente.paqueteDuracionPlataforma.deleteMany({
          where: { paqueteId: params.id, duracionVendidaId: body.duracionVendidaId, plataformaId: body.plataformaId },
        });
        return { excepcion: null, advertencia: null };
      }

      const [duracionVendida, duracionReal] = await Promise.all([
        cliente.duracion.findUnique({ where: { id: body.duracionVendidaId } }),
        cliente.duracion.findUnique({ where: { id: body.duracionRealId } }),
      ]);
      if (!duracionVendida || !duracionVendida.activa) {
        set.status = 400;
        return {
          error: { codigo: "DURACION_INACTIVA", mensaje: "La duración vendida debe ser una duración activa." },
        };
      }
      if (!duracionReal || !duracionReal.activa) {
        set.status = 400;
        return { error: { codigo: "DURACION_INACTIVA", mensaje: "La duración real debe ser una duración activa." } };
      }

      // Sin upsert: prismaParaEmpresa (R1) no envuelve `upsert` — solo los
      // métodos listados en CLAUDE.md (find*, create, update, delete,
      // count, aggregate). Usarlo saltaría la inyección de empresaId tanto
      // en `where` como en `create`. Se arma con find + create/update, y se
      // maneja el P2002 de la carrera (dos PUT simultáneos sobre la misma
      // celda) en vez de confiar solo en el find previo.
      const claveUnica = {
        paqueteId_duracionVendidaId_plataformaId: {
          paqueteId: params.id,
          duracionVendidaId: body.duracionVendidaId,
          plataformaId: body.plataformaId,
        },
      };
      const incluirNombres = {
        duracionVendida: { select: { nombre: true } },
        duracionReal: { select: { nombre: true } },
        plataforma: { select: { nombre: true } },
      };

      const existente = await cliente.paqueteDuracionPlataforma.findUnique({ where: claveUnica });
      let excepcion;
      try {
        excepcion = existente
          ? await cliente.paqueteDuracionPlataforma.update({
              where: claveUnica,
              data: { duracionRealId: body.duracionRealId },
              include: incluirNombres,
            })
          : await cliente.paqueteDuracionPlataforma.create({
              data: datosSinEmpresa<Prisma.PaqueteDuracionPlataformaUncheckedCreateInput>({
                paqueteId: params.id,
                duracionVendidaId: body.duracionVendidaId,
                plataformaId: body.plataformaId,
                duracionRealId: body.duracionRealId,
              }),
              include: incluirNombres,
            });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          excepcion = await cliente.paqueteDuracionPlataforma.update({
            where: claveUnica,
            data: { duracionRealId: body.duracionRealId },
            include: incluirNombres,
          });
        } else {
          throw error;
        }
      }

      const advertencia =
        diasAproximados(duracionReal) > diasAproximados(duracionVendida)
          ? "Estás entregando más tiempo del que vendes."
          : null;

      return {
        excepcion: {
          duracionVendidaId: excepcion.duracionVendidaId,
          duracionVendidaNombre: excepcion.duracionVendida.nombre,
          plataformaId: excepcion.plataformaId,
          nombrePlataforma: excepcion.plataforma.nombre,
          duracionRealId: excepcion.duracionRealId,
          duracionRealNombre: excepcion.duracionReal.nombre,
        },
        advertencia,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        duracionVendidaId: t.String(),
        plataformaId: t.String(),
        duracionRealId: t.String(),
      }),
      response: {
        200: t.Object({
          excepcion: t.Union([esquemaExcepcion, t.Null()]),
          advertencia: t.Union([t.String(), t.Null()]),
        }),
        400: esquemaError,
      },
    },
  );
