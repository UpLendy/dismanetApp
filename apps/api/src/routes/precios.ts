import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import type { prismaRaw } from "../lib/prisma.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { costoComponentesPaquete } from "../lib/paquetes.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

// Dinero como string decimal (CLAUDE.md: nunca number flotante). Decimal(14,2).
const PATRON_DINERO = /^\d+(\.\d{1,2})?$/;
const dinero = t.String({ pattern: PATRON_DINERO.source });

const esquemaFila = t.Object({ id: t.String(), nombre: t.String() });

const esquemaCelda = t.Object({
  duracionId: t.String(),
  tipoClienteId: t.String(),
  precioVenta: t.String(),
  costo: t.String(),
  // true si costo >= precioVenta: venta a pérdida. Advertencia, nunca bloqueo
  // (una promoción puede vender deliberadamente a pérdida).
  perdida: t.Boolean(),
});

const esquemaCeldaPaquete = t.Composite([
  esquemaCelda,
  t.Object({
    // Suma de costos de las plataformas componentes, cada una a SU duración
    // real (ver resolverComposicionDePaquete). null si no es calculable
    // (falta el precio activo de algún componente).
    sumaComponentes: t.Union([t.String(), t.Null()]),
    componentesFaltantes: t.Array(t.String()),
    // true si sumaComponentes no es null y difiere del costo digitado en
    // más de un 5%. Advertencia, nunca bloqueo.
    costoNoCoincide: t.Boolean(),
  }),
]);

const esquemaAvisoCostoCero = t.Object({ cantidad: t.Number() });

function esDinero(valor: string): boolean {
  return PATRON_DINERO.test(valor);
}

function perdida(precioVenta: Prisma.Decimal, costo: Prisma.Decimal): boolean {
  return costo.greaterThanOrEqualTo(precioVenta);
}

// Celda a guardar: `limpiar: true` desactiva la fila existente (si hay) y
// ningún otro campo se usa. `limpiar: false` (o ausente) exige
// precioVenta/costo y crea o reactiva la fila. Nunca se borra una fila de
// Precio (R3): hay ventas históricas que no la referencian directamente,
// pero el histórico de precios en sí es información de negocio que no se
// descarta.
const cuerpoCelda = t.Object({
  duracionId: t.String(),
  tipoClienteId: t.String(),
  limpiar: t.Optional(t.Boolean()),
  precioVenta: t.Optional(dinero),
  costo: t.Optional(dinero),
});

const esquemaResultadoCelda = t.Object({
  duracionId: t.String(),
  tipoClienteId: t.String(),
  ok: t.Boolean(),
  error: t.Union([t.String(), t.Null()]),
});

type ClienteEmpresa = typeof prismaRaw;

// Llena o reactiva la celda (duracionId, tipoClienteId) para una plataforma o
// un paquete (exactamente uno de los dos se pasa). Sin upsert (prismaParaEmpresa
// lo bloquea, R1): find + create/update, con manejo de P2002 por si dos
// peticiones concurrentes golpean la misma celda vacía a la vez.
async function guardarCelda(
  cliente: ClienteEmpresa,
  selector: { plataformaId: string } | { paqueteId: string },
  duracionId: string,
  tipoClienteId: string,
  precioVenta: string,
  costo: string,
) {
  const where = { ...selector, duracionId, tipoClienteId };
  const existente = await cliente.precio.findFirst({ where });
  const datos = { precioVenta, costo, activo: true };

  if (existente) {
    return cliente.precio.update({ where: { id: existente.id }, data: datos });
  }

  try {
    return await cliente.precio.create({
      data: datosSinEmpresa<Prisma.PrecioUncheckedCreateInput>({ ...selector, duracionId, tipoClienteId, ...datos }),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const carrera = await cliente.precio.findFirst({ where });
      if (carrera) return cliente.precio.update({ where: { id: carrera.id }, data: datos });
    }
    throw error;
  }
}

async function limpiarCelda(
  cliente: ClienteEmpresa,
  selector: { plataformaId: string } | { paqueteId: string },
  duracionId: string,
  tipoClienteId: string,
) {
  const existente = await cliente.precio.findFirst({ where: { ...selector, duracionId, tipoClienteId } });
  if (existente) {
    await cliente.precio.update({ where: { id: existente.id }, data: { activo: false } });
  }
}

export const precios = new Elysia({ prefix: "/precios" })
  .use(requiereRol(Rol.ADMIN))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: {
          codigo: "SIN_EMPRESA_ACTIVA",
          mensaje: "Selecciona una empresa antes de gestionar sus precios.",
        },
      };
    }
  })
  // -------------------------------------------------------------------
  // Unidades: matriz de precios por plataforma individual.
  // -------------------------------------------------------------------
  .get(
    "/unidades",
    async ({ query, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);

      const plataforma = await cliente.plataforma.findUnique({ where: { id: query.plataformaId } });
      if (!plataforma) {
        set.status = 404;
        return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
      }

      const [duracionesActivas, tiposClienteActivos, filas] = await Promise.all([
        cliente.duracion.findMany({ where: { activa: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
        cliente.tipoCliente.findMany({ where: { activo: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
        cliente.precio.findMany({ where: { plataformaId: query.plataformaId, activo: true } }),
      ]);

      const celdas = filas.map((fila) => ({
        duracionId: fila.duracionId,
        tipoClienteId: fila.tipoClienteId,
        precioVenta: fila.precioVenta.toString(),
        costo: fila.costo.toString(),
        perdida: perdida(fila.precioVenta, fila.costo),
      }));

      const avisoCostoCero = { cantidad: filas.filter((f) => f.costo.isZero()).length };

      return { duraciones: duracionesActivas, tiposCliente: tiposClienteActivos, celdas, avisoCostoCero };
    },
    {
      query: t.Object({ plataformaId: t.String() }),
      response: {
        200: t.Object({
          duraciones: t.Array(esquemaFila),
          tiposCliente: t.Array(esquemaFila),
          celdas: t.Array(esquemaCelda),
          avisoCostoCero: esquemaAvisoCostoCero,
        }),
        404: esquemaError,
      },
    },
  )
  .put(
    "/unidades",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);

      const plataforma = await cliente.plataforma.findUnique({ where: { id: body.plataformaId } });
      if (!plataforma) {
        set.status = 404;
        return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
      }

      const resultados = [];
      for (const celda of body.celdas) {
        if (celda.limpiar) {
          await limpiarCelda(cliente, { plataformaId: body.plataformaId }, celda.duracionId, celda.tipoClienteId);
          resultados.push({ duracionId: celda.duracionId, tipoClienteId: celda.tipoClienteId, ok: true, error: null });
          continue;
        }

        if (!celda.precioVenta || !celda.costo || !esDinero(celda.precioVenta) || !esDinero(celda.costo)) {
          resultados.push({
            duracionId: celda.duracionId,
            tipoClienteId: celda.tipoClienteId,
            ok: false,
            error: "precioVenta y costo son obligatorios y deben ser montos válidos.",
          });
          continue;
        }
        if (Number(celda.precioVenta) <= 0) {
          resultados.push({
            duracionId: celda.duracionId,
            tipoClienteId: celda.tipoClienteId,
            ok: false,
            error: "precioVenta debe ser mayor que cero.",
          });
          continue;
        }
        if (Number(celda.costo) < 0) {
          resultados.push({
            duracionId: celda.duracionId,
            tipoClienteId: celda.tipoClienteId,
            ok: false,
            error: "costo no puede ser negativo.",
          });
          continue;
        }

        await guardarCelda(
          cliente,
          { plataformaId: body.plataformaId },
          celda.duracionId,
          celda.tipoClienteId,
          celda.precioVenta,
          celda.costo,
        );
        resultados.push({ duracionId: celda.duracionId, tipoClienteId: celda.tipoClienteId, ok: true, error: null });
      }

      return { resultados };
    },
    {
      body: t.Object({ plataformaId: t.String(), celdas: t.Array(cuerpoCelda) }),
      response: { 200: t.Object({ resultados: t.Array(esquemaResultadoCelda) }), 404: esquemaError },
    },
  )
  // -------------------------------------------------------------------
  // Paquetes: misma estructura, más la salvaguarda de costo (D12).
  // -------------------------------------------------------------------
  .get(
    "/paquetes",
    async ({ query, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);

      const paquete = await cliente.paquete.findUnique({ where: { id: query.paqueteId } });
      if (!paquete) {
        set.status = 404;
        return { error: { codigo: "PAQUETE_NO_ENCONTRADO", mensaje: "El paquete no existe." } };
      }

      const [duracionesActivas, tiposClienteActivos, filas] = await Promise.all([
        cliente.duracion.findMany({ where: { activa: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
        cliente.tipoCliente.findMany({ where: { activo: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
        cliente.precio.findMany({ where: { paqueteId: query.paqueteId, activo: true } }),
      ]);

      const celdas = await Promise.all(
        filas.map(async (fila) => {
          const { suma, faltantes } = await costoComponentesPaquete(
            cliente,
            query.paqueteId,
            fila.duracionId,
            fila.tipoClienteId,
          );

          let costoNoCoincide = false;
          if (suma !== null) {
            const diferencia = fila.costo.minus(suma).abs();
            costoNoCoincide = suma.isZero() ? !fila.costo.isZero() : diferencia.dividedBy(suma).greaterThan(0.05);
          }

          return {
            duracionId: fila.duracionId,
            tipoClienteId: fila.tipoClienteId,
            precioVenta: fila.precioVenta.toString(),
            costo: fila.costo.toString(),
            perdida: perdida(fila.precioVenta, fila.costo),
            sumaComponentes: suma !== null ? suma.toString() : null,
            componentesFaltantes: faltantes,
            costoNoCoincide,
          };
        }),
      );

      const avisoCostoCero = { cantidad: filas.filter((f) => f.costo.isZero()).length };

      return { duraciones: duracionesActivas, tiposCliente: tiposClienteActivos, celdas, avisoCostoCero };
    },
    {
      query: t.Object({ paqueteId: t.String() }),
      response: {
        200: t.Object({
          duraciones: t.Array(esquemaFila),
          tiposCliente: t.Array(esquemaFila),
          celdas: t.Array(esquemaCeldaPaquete),
          avisoCostoCero: esquemaAvisoCostoCero,
        }),
        404: esquemaError,
      },
    },
  )
  .put(
    "/paquetes",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);

      const paquete = await cliente.paquete.findUnique({ where: { id: body.paqueteId } });
      if (!paquete) {
        set.status = 404;
        return { error: { codigo: "PAQUETE_NO_ENCONTRADO", mensaje: "El paquete no existe." } };
      }

      const resultados = [];
      for (const celda of body.celdas) {
        if (celda.limpiar) {
          await limpiarCelda(cliente, { paqueteId: body.paqueteId }, celda.duracionId, celda.tipoClienteId);
          resultados.push({ duracionId: celda.duracionId, tipoClienteId: celda.tipoClienteId, ok: true, error: null });
          continue;
        }

        if (!celda.precioVenta || !celda.costo || !esDinero(celda.precioVenta) || !esDinero(celda.costo)) {
          resultados.push({
            duracionId: celda.duracionId,
            tipoClienteId: celda.tipoClienteId,
            ok: false,
            error: "precioVenta y costo son obligatorios y deben ser montos válidos.",
          });
          continue;
        }
        if (Number(celda.precioVenta) <= 0) {
          resultados.push({
            duracionId: celda.duracionId,
            tipoClienteId: celda.tipoClienteId,
            ok: false,
            error: "precioVenta debe ser mayor que cero.",
          });
          continue;
        }
        if (Number(celda.costo) < 0) {
          resultados.push({
            duracionId: celda.duracionId,
            tipoClienteId: celda.tipoClienteId,
            ok: false,
            error: "costo no puede ser negativo.",
          });
          continue;
        }

        await guardarCelda(
          cliente,
          { paqueteId: body.paqueteId },
          celda.duracionId,
          celda.tipoClienteId,
          celda.precioVenta,
          celda.costo,
        );
        resultados.push({ duracionId: celda.duracionId, tipoClienteId: celda.tipoClienteId, ok: true, error: null });
      }

      return { resultados };
    },
    {
      body: t.Object({ paqueteId: t.String(), celdas: t.Array(cuerpoCelda) }),
      response: { 200: t.Object({ resultados: t.Array(esquemaResultadoCelda) }), 404: esquemaError },
    },
  );
