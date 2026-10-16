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

// Unidades: las columnas de tipoCliente ya solo llevan precio (punto 6,
// camino del dinero). El costo se pide una sola vez por renglón de
// duración — ver esquemaCostoDuracion — y no varía por tipoCliente.
const esquemaCelda = t.Object({
  duracionId: t.String(),
  tipoClienteId: t.String(),
  precioVenta: t.String(),
  // true si el costo de la duración (compartido entre tipos de cliente) es
  // >= precioVenta: venta a pérdida. Advertencia, nunca bloqueo (una
  // promoción puede vender deliberadamente a pérdida).
  perdida: t.Boolean(),
});

const esquemaCostoDuracion = t.Object({ duracionId: t.String(), costo: t.String() });

const esquemaDetalleComponente = t.Object({
  plataformaId: t.String(),
  nombrePlataforma: t.String(),
  cantidadPantallas: t.Number(),
  // null si a este componente le falta costo registrado en su duración real.
  costoUnitario: t.Union([t.String(), t.Null()]),
  subtotal: t.Union([t.String(), t.Null()]),
});

// Paquetes: el campo de costo manual desaparece por completo (punto 6). En
// su lugar, el costo calculado — de solo lectura — con el desglose de qué
// componente aporta cuánto.
const esquemaCeldaPaquete = t.Composite([
  esquemaCelda,
  t.Object({
    // Suma de costos de las plataformas componentes, cada una a SU duración
    // real (ver resolverComposicionDePaquete). null si no es calculable
    // (falta el costo de algún componente).
    costoCalculado: t.Union([t.String(), t.Null()]),
    detalle: t.Array(esquemaDetalleComponente),
  }),
]);

// Punto 5: ya no cuenta "celdas de precio con costo en cero". Para unidades
// cuenta combinaciones plataforma+duración sin costo registrado; para
// paquetes, renglones cuyos componentes no tienen costo completo.
const esquemaAvisoCostoCero = t.Object({ cantidad: t.Number() });

function esDinero(valor: string): boolean {
  return PATRON_DINERO.test(valor);
}

function perdida(precioVenta: Prisma.Decimal, costo: Prisma.Decimal): boolean {
  return costo.greaterThanOrEqualTo(precioVenta);
}

// Celda a guardar: `limpiar: true` desactiva la fila existente (si hay) y
// ningún otro campo se usa. `limpiar: false` (o ausente) exige precioVenta y
// crea o reactiva la fila. Nunca se borra una fila de Precio (R3): hay
// ventas históricas que no la referencian directamente, pero el histórico de
// precios en sí es información de negocio que no se descarta.
//
// Ya no lleva `costo` (punto 6, camino del dinero): el costo salió de Precio
// y vive en CostoPlataforma, una vez por plataforma+duración, no por celda.
const cuerpoCelda = t.Object({
  duracionId: t.String(),
  tipoClienteId: t.String(),
  limpiar: t.Optional(t.Boolean()),
  precioVenta: t.Optional(dinero),
});

const cuerpoCostoDuracion = t.Object({ duracionId: t.String(), costo: dinero });

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
//
// `Precio.costo` ya no se pide ni se usa (punto 6, camino del dinero) — se
// escribe "0" porque la columna sigue existiendo (se elimina en una entrega
// posterior, ver CLAUDE.md punto 1) pero ningún código de negocio la lee.
async function guardarCelda(
  cliente: ClienteEmpresa,
  selector: { plataformaId: string } | { paqueteId: string },
  duracionId: string,
  tipoClienteId: string,
  precioVenta: string,
) {
  const where = { ...selector, duracionId, tipoClienteId };
  const existente = await cliente.precio.findFirst({ where });
  const datos = { precioVenta, costo: "0", activo: true };

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

// Guarda el costo de una plataforma+duración (CostoPlataforma). Mismo patrón
// find + create/update con manejo de P2002 que guardarCelda — upsert sigue
// bloqueado por prismaParaEmpresa (R1).
async function guardarCostoPlataforma(cliente: ClienteEmpresa, plataformaId: string, duracionId: string, costo: string) {
  const where = { plataformaId, duracionId };
  const existente = await cliente.costoPlataforma.findFirst({ where });
  if (existente) {
    return cliente.costoPlataforma.update({ where: { id: existente.id }, data: { costo } });
  }

  try {
    return await cliente.costoPlataforma.create({
      data: datosSinEmpresa<Prisma.CostoPlataformaUncheckedCreateInput>({ plataformaId, duracionId, costo }),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const carrera = await cliente.costoPlataforma.findFirst({ where });
      if (carrera) return cliente.costoPlataforma.update({ where: { id: carrera.id }, data: { costo } });
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

      const [duracionesActivas, tiposClienteActivos, filas, costos] = await Promise.all([
        cliente.duracion.findMany({ where: { activa: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
        cliente.tipoCliente.findMany({ where: { activo: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
        cliente.precio.findMany({ where: { plataformaId: query.plataformaId, activo: true } }),
        cliente.costoPlataforma.findMany({ where: { plataformaId: query.plataformaId } }),
      ]);

      // El costo ya no varía por tipoCliente (punto 6): una sola fila por
      // duración, compartida entre todas las celdas de precio de esa fila.
      const costoPorDuracion = new Map(costos.map((c) => [c.duracionId, c.costo]));

      const celdas = filas.map((fila) => {
        const costoDuracion = costoPorDuracion.get(fila.duracionId) ?? new Prisma.Decimal(0);
        return {
          duracionId: fila.duracionId,
          tipoClienteId: fila.tipoClienteId,
          precioVenta: fila.precioVenta.toString(),
          perdida: perdida(fila.precioVenta, costoDuracion),
        };
      });

      const costosRespuesta = duracionesActivas.map((duracion) => ({
        duracionId: duracion.id,
        costo: (costoPorDuracion.get(duracion.id) ?? new Prisma.Decimal(0)).toString(),
      }));

      // Combinaciones plataforma+duración EN USO (con al menos un precio
      // activo) que no tienen costo registrado — punto 5.
      const duracionesEnUso = new Set(filas.map((f) => f.duracionId));
      const avisoCostoCero = {
        cantidad: [...duracionesEnUso].filter((id) => (costoPorDuracion.get(id) ?? new Prisma.Decimal(0)).isZero())
          .length,
      };

      return {
        duraciones: duracionesActivas,
        tiposCliente: tiposClienteActivos,
        celdas,
        costos: costosRespuesta,
        avisoCostoCero,
      };
    },
    {
      query: t.Object({ plataformaId: t.String() }),
      response: {
        200: t.Object({
          duraciones: t.Array(esquemaFila),
          tiposCliente: t.Array(esquemaFila),
          celdas: t.Array(esquemaCelda),
          costos: t.Array(esquemaCostoDuracion),
          avisoCostoCero: esquemaAvisoCostoCero,
        }),
        404: esquemaError,
      },
    },
  )
  .put(
    "/unidades/costo",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);

      const plataforma = await cliente.plataforma.findUnique({ where: { id: body.plataformaId } });
      if (!plataforma) {
        set.status = 404;
        return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
      }

      const costoPlataforma = await guardarCostoPlataforma(cliente, body.plataformaId, body.duracionId, body.costo);
      return { costo: costoPlataforma.costo.toString() };
    },
    {
      body: t.Object({ plataformaId: t.String(), duracionId: t.String(), costo: dinero }),
      response: {
        200: t.Object({ costo: t.String() }),
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

        if (!celda.precioVenta || !esDinero(celda.precioVenta)) {
          resultados.push({
            duracionId: celda.duracionId,
            tipoClienteId: celda.tipoClienteId,
            ok: false,
            error: "precioVenta es obligatorio y debe ser un monto válido.",
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

        await guardarCelda(cliente, { plataformaId: body.plataformaId }, celda.duracionId, celda.tipoClienteId, celda.precioVenta);
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
          const { suma, faltantes, detalle } = await costoComponentesPaquete(cliente, query.paqueteId, fila.duracionId);
          const completo = faltantes.length === 0;

          return {
            duracionId: fila.duracionId,
            tipoClienteId: fila.tipoClienteId,
            precioVenta: fila.precioVenta.toString(),
            // Solo se compara contra el costo calculado cuando está completo
            // (punto 6): un parcial subestima el costo real y marcaría como
            // "no es pérdida" una venta que sí lo es.
            perdida: completo ? perdida(fila.precioVenta, suma) : false,
            costoCalculado: completo ? suma.toString() : null,
            detalle: detalle.map((d) => ({
              plataformaId: d.plataformaId,
              nombrePlataforma: d.nombrePlataforma,
              cantidadPantallas: d.cantidadPantallas,
              costoUnitario: d.costoUnitario?.toString() ?? null,
              subtotal: d.subtotal?.toString() ?? null,
            })),
          };
        }),
      );

      // Renglones de duración (no celdas: cada duración se repite una vez
      // por tipoCliente pero el costo del paquete no varía por tipoCliente)
      // cuyos componentes no tienen costo completo — punto 5.
      const duracionesIncompletas = new Set(
        celdas.filter((c) => c.costoCalculado === null).map((c) => c.duracionId),
      );
      const avisoCostoCero = { cantidad: duracionesIncompletas.size };

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

        if (!celda.precioVenta || !esDinero(celda.precioVenta)) {
          resultados.push({
            duracionId: celda.duracionId,
            tipoClienteId: celda.tipoClienteId,
            ok: false,
            error: "precioVenta es obligatorio y debe ser un monto válido.",
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

        await guardarCelda(cliente, { paqueteId: body.paqueteId }, celda.duracionId, celda.tipoClienteId, celda.precioVenta);
        resultados.push({ duracionId: celda.duracionId, tipoClienteId: celda.tipoClienteId, ok: true, error: null });
      }

      return { resultados };
    },
    {
      body: t.Object({ paqueteId: t.String(), celdas: t.Array(cuerpoCelda) }),
      response: { 200: t.Object({ resultados: t.Array(esquemaResultadoCelda) }), 404: esquemaError },
    },
  );
