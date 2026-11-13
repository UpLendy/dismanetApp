import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol, ModoComision, AmbitoUmbral, PeriodoUmbral } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { inicioDeFechaBogota, finDeFechaBogota } from "../lib/periodos.ts";
import { simularComisiones, validarParametrosComision } from "../lib/comisiones.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

// Dinero como string decimal (CLAUDE.md: nunca number flotante). Decimal(14,2).
const PATRON_DINERO = /^\d+(\.\d{1,2})?$/;
const dinero = t.String({ pattern: PATRON_DINERO.source });

const modoComision = t.Union([t.Literal("PORCENTAJE_VENTA"), t.Literal("FIJO_POR_PANTALLA")]);
const ambitoUmbral = t.Union([t.Literal("TOTAL"), t.Literal("POR_PLATAFORMA")]);
const periodoUmbral = t.Union([t.Literal("DIA"), t.Literal("MES")]);

const esquemaConfiguracion = t.Object({
  id: t.String(),
  modo: modoComision,
  valor: t.String(),
  umbralCantidad: t.Number(),
  umbralAmbito: ambitoUmbral,
  umbralPeriodo: periodoUmbral,
  vigenteDesde: t.String(),
  creadaPorId: t.String(),
  creadaPor: t.Object({ id: t.String(), nombre: t.String() }),
  createdAt: t.String(),
});

interface FilaConfiguracion {
  id: string;
  modo: ModoComision;
  valor: Prisma.Decimal;
  umbralCantidad: number;
  umbralAmbito: AmbitoUmbral;
  umbralPeriodo: PeriodoUmbral;
  vigenteDesde: Date;
  creadaPorId: string;
  creadaPor: { id: string; nombre: string };
  createdAt: Date;
}

function respuestaConfiguracion(fila: FilaConfiguracion) {
  return {
    id: fila.id,
    modo: fila.modo,
    valor: fila.valor.toString(),
    umbralCantidad: fila.umbralCantidad,
    umbralAmbito: fila.umbralAmbito,
    umbralPeriodo: fila.umbralPeriodo,
    vigenteDesde: fila.vigenteDesde.toISOString(),
    creadaPorId: fila.creadaPorId,
    creadaPor: fila.creadaPor,
    createdAt: fila.createdAt.toISOString(),
  };
}

const INCLUYE_CREADA_POR = { creadaPor: { select: { id: true, nombre: true } } } as const;

const esquemaFilaPeriodo = t.Object({
  periodoInicio: t.String(),
  pantallasVendidas: t.Number(),
  pantallasAbsorbidas: t.Number(),
  pantallasComisionadas: t.Number(),
  porcentajeComisionado: t.Number(),
  pozoTotal: t.String(),
});

const esquemaSimulacion = t.Object({
  pantallasVendidas: t.Number(),
  pantallasAbsorbidas: t.Number(),
  pantallasComisionadas: t.Number(),
  porcentajeComisionado: t.Number(),
  pozoTotal: t.String(),
  porPeriodo: t.Array(esquemaFilaPeriodo),
});

// Política de comisiones (puntos 2-3 del cliente) y su simulador, F6.5.
// Solo ADMIN: no calcula ni liquida nada todavía (eso es F6.6), pero ya
// expone el % o monto fijo que se pagaría — información financiera, igual
// que costo/utilidad (R4).
export const comisiones = new Elysia({ prefix: "/comisiones" })
  .use(requiereRol(Rol.ADMIN))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: { codigo: "SIN_EMPRESA_ACTIVA", mensaje: "Selecciona una empresa antes de configurar comisiones." },
      };
    }
  })
  .get(
    "/configuracion",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      // La vigente es la de vigenteDesde más reciente que ya empezó — nunca
      // Venta.fechaVencimientoMax ni similar, es su propio campo de versión.
      const vigente = await cliente.configuracionComision.findFirst({
        where: { vigenteDesde: { lte: new Date() } },
        orderBy: { vigenteDesde: "desc" },
        include: INCLUYE_CREADA_POR,
      });
      return { configuracion: vigente ? respuestaConfiguracion(vigente) : null };
    },
    { response: { 200: t.Object({ configuracion: t.Union([esquemaConfiguracion, t.Null()]) }) } },
  )
  .put(
    "/configuracion",
    async ({ body, contexto, set }) => {
      const valor = new Prisma.Decimal(body.valor);
      const error = validarParametrosComision({
        modo: body.modo,
        valor,
        umbralCantidad: body.umbralCantidad,
        umbralAmbito: body.umbralAmbito,
        umbralPeriodo: body.umbralPeriodo,
      });
      if (error) {
        set.status = 400;
        return { error };
      }

      const cliente = prismaParaEmpresa(contexto.empresaId);
      // Registro por versión (CLAUDE.md): nunca UPDATE sobre la fila
      // anterior. La anterior queda intacta y consultable en /historial —
      // es lo que permite saber qué regla regía cuando se vendió, aunque el
      // porcentaje haya cambiado antes de liquidar (eso es F6.6).
      const creada = await cliente.configuracionComision.create({
        data: datosSinEmpresa<Prisma.ConfiguracionComisionUncheckedCreateInput>({
          modo: body.modo,
          valor: valor.toString(),
          umbralCantidad: body.umbralCantidad,
          umbralAmbito: body.umbralAmbito,
          umbralPeriodo: body.umbralPeriodo,
          vigenteDesde: new Date(),
          creadaPorId: contexto.usuarioId!,
        }),
        include: INCLUYE_CREADA_POR,
      });
      set.status = 201;
      return { configuracion: respuestaConfiguracion(creada) };
    },
    {
      body: t.Object({
        modo: modoComision,
        valor: dinero,
        umbralCantidad: t.Integer({ minimum: 0 }),
        umbralAmbito: ambitoUmbral,
        umbralPeriodo: periodoUmbral,
      }),
      response: { 201: t.Object({ configuracion: esquemaConfiguracion }), 400: esquemaError },
    },
  )
  .get(
    "/configuracion/historial",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const filas = await cliente.configuracionComision.findMany({
        orderBy: { vigenteDesde: "desc" },
        include: INCLUYE_CREADA_POR,
      });
      return { versiones: filas.map(respuestaConfiguracion) };
    },
    { response: { 200: t.Object({ versiones: t.Array(esquemaConfiguracion) }) } },
  )
  .get(
    "/simulacion",
    async ({ query, contexto, set }) => {
      const valor = new Prisma.Decimal(query.valor);
      const error = validarParametrosComision({
        modo: query.modo,
        valor,
        umbralCantidad: query.umbralCantidad,
        umbralAmbito: query.umbralAmbito,
        umbralPeriodo: query.umbralPeriodo,
      });
      if (error) {
        set.status = 400;
        return { error };
      }

      // Simula con los parámetros que llegan por query, NUNCA con la
      // configuración guardada — es lo que permite mover el número y ver el
      // efecto antes de guardar nada (PROMPT-F6.5, Parte 3).
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const resultado = await simularComisiones(cliente, {
        desde: inicioDeFechaBogota(query.desde),
        hasta: finDeFechaBogota(query.hasta),
        modo: query.modo,
        valor,
        umbralCantidad: query.umbralCantidad,
        umbralAmbito: query.umbralAmbito,
        umbralPeriodo: query.umbralPeriodo,
      });
      return resultado;
    },
    {
      query: t.Object({
        desde: t.String(),
        hasta: t.String(),
        modo: modoComision,
        valor: dinero,
        umbralCantidad: t.Numeric({ minimum: 0 }),
        umbralAmbito: ambitoUmbral,
        umbralPeriodo: periodoUmbral,
      }),
      response: { 200: esquemaSimulacion, 400: esquemaError },
    },
  );
