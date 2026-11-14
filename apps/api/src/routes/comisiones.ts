import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol, ModoComision, AmbitoUmbral, PeriodoUmbral } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { inicioDeFechaBogota, finDeFechaBogota } from "../lib/periodos.ts";
import {
  simularComisiones,
  validarParametrosComision,
  calcularComisiones,
  configuracionVigente,
  comisionPropia,
  type ResultadoCalculoComisiones,
} from "../lib/comisiones.ts";

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

const esquemaFilaDiaPropia = t.Object({
  dia: t.String(),
  cerrado: t.Boolean(),
  horas: t.Number(),
  tajada: t.String(),
});

const esquemaMias = t.Object({
  configurada: t.Boolean(),
  totalCerrado: t.String(),
  provisional: t.Union([t.Object({ dia: t.String(), horas: t.Number(), tajada: t.String() }), t.Null()]),
  porDia: t.Array(esquemaFilaDiaPropia),
});

// respuestaMias se extrajo a lib/comisiones.ts como comisionPropia (F6.9,
// PROMPT Parte 0): GET /panel-empleado necesita exactamente la misma tajada.

const esquemaFilaResumenUsuario = t.Object({
  usuarioId: t.String(),
  nombre: t.String(),
  horas: t.Number(),
  tajadaCerrada: t.String(),
  tajadaProvisional: t.String(),
});

const esquemaResumen = t.Object({
  configurada: t.Boolean(),
  pozoTotal: t.String(),
  pozoSinRepartir: t.String(),
  pantallasComisionadas: t.Number(),
  porUsuario: t.Array(esquemaFilaResumenUsuario),
});

/**
 * Agrega el resultado de calcularComisiones por usuario, separando lo
 * cerrado de lo provisional de hoy (Parte 4 y 6) — a diferencia de
 * respuestaMias, aquí sí se expone el pozo total y pozoSinRepartir: esta
 * ruta es solo ADMIN.
 */
function respuestaResumen(resultado: ResultadoCalculoComisiones, nombresPorUsuario: Map<string, string>) {
  if (!resultado.configurada) {
    return { configurada: false, pozoTotal: "0", pozoSinRepartir: "0", pantallasComisionadas: 0, porUsuario: [] };
  }

  const acumulado = new Map<
    string,
    { horas: number; tajadaCerrada: Prisma.Decimal; tajadaProvisional: Prisma.Decimal }
  >();

  for (const dia of resultado.porDia) {
    for (const tajada of dia.tajadas) {
      const actual =
        acumulado.get(tajada.usuarioId) ??
        { horas: 0, tajadaCerrada: new Prisma.Decimal(0), tajadaProvisional: new Prisma.Decimal(0) };
      actual.horas += tajada.horas;
      if (dia.cerrado) {
        actual.tajadaCerrada = actual.tajadaCerrada.plus(tajada.tajada);
      } else {
        actual.tajadaProvisional = actual.tajadaProvisional.plus(tajada.tajada);
      }
      acumulado.set(tajada.usuarioId, actual);
    }
  }

  const porUsuario = [...acumulado.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([usuarioId, datos]) => ({
      usuarioId,
      nombre: nombresPorUsuario.get(usuarioId) ?? "",
      horas: datos.horas,
      tajadaCerrada: datos.tajadaCerrada.toString(),
      tajadaProvisional: datos.tajadaProvisional.toString(),
    }));

  return {
    configurada: true,
    pozoTotal: resultado.pozoTotal.toString(),
    pozoSinRepartir: resultado.pozoSinRepartir.toString(),
    pantallasComisionadas: resultado.pantallasComisionadas,
    porUsuario,
  };
}

const consultaRango = t.Object({ desde: t.String(), hasta: t.String() });

// Política de comisiones (F6.5) y su cálculo real (F6.6). El guard mínimo es
// EMPLEADO porque /mias es de cualquiera que pueda tener turno; las rutas de
// configuración, simulación y resumen escalan a ADMIN más abajo. Ver
// CLAUDE.md sobre `scoped`: el segundo .use(requiereRol(ADMIN)) vive dentro
// de la instancia nombrada que retorna requiereRol, así que su `scoped`
// llega hasta el final de ESTA cadena, no más allá — mismo patrón ya
// validado en routes/instrucciones.ts.
export const comisiones = new Elysia({ prefix: "/comisiones" })
  .use(requiereRol(Rol.EMPLEADO))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: { codigo: "SIN_EMPRESA_ACTIVA", mensaje: "Selecciona una empresa antes de consultar comisiones." },
      };
    }
  })
  .get(
    "/mias",
    async ({ contexto, query }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const configuracion = await configuracionVigente(cliente);
      if (!configuracion) {
        return { configurada: false, totalCerrado: "0", provisional: null, porDia: [] };
      }

      // Siempre contexto.usuarioId — nunca un usuarioId de query: esta ruta
      // es "las mías", no "las de quien yo pida" (PROMPT-F6.6, Parte 6).
      const resultado = await calcularComisiones(cliente, {
        desde: inicioDeFechaBogota(query.desde),
        hasta: finDeFechaBogota(query.hasta),
        ...configuracion,
      });
      return comisionPropia(resultado, contexto.usuarioId!);
    },
    { query: consultaRango, response: { 200: esquemaMias } },
  )
  .use(requiereRol(Rol.ADMIN))
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
      // porcentaje haya cambiado después (F6.6 calcula siempre con la
      // vigente al momento de leer, no con la que regía al vender — ver el
      // comentario de cabecera de lib/comisiones.ts).
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
  )
  .get(
    "/resumen",
    async ({ contexto, query }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const configuracion = await configuracionVigente(cliente);
      if (!configuracion) {
        return { configurada: false, pozoTotal: "0", pozoSinRepartir: "0", pantallasComisionadas: 0, porUsuario: [] };
      }

      const resultado = await calcularComisiones(cliente, {
        desde: inicioDeFechaBogota(query.desde),
        hasta: finDeFechaBogota(query.hasta),
        ...configuracion,
      });

      const usuarioIds = new Set<string>();
      for (const dia of resultado.porDia) {
        for (const tajada of dia.tajadas) usuarioIds.add(tajada.usuarioId);
      }
      const usuarios =
        usuarioIds.size > 0
          ? await cliente.usuario.findMany({
              where: { id: { in: [...usuarioIds] } },
              select: { id: true, nombre: true },
            })
          : [];
      const nombresPorUsuario = new Map(usuarios.map((usuario) => [usuario.id, usuario.nombre]));

      return respuestaResumen(resultado, nombresPorUsuario);
    },
    { query: consultaRango, response: { 200: esquemaResumen } },
  );
