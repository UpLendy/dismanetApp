import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol, ModoComision, AmbitoUmbral, PeriodoUmbral } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { inicioDeFechaBogota, finDeFechaBogota } from "../lib/periodos.ts";
import {
  simularComisiones,
  validarParametrosComision,
  validarExcepcionComision,
  resolverReglaPlataforma,
  calcularComisiones,
  configuracionVigente,
  comisionPropia,
  type ResultadoCalculoComisiones,
  type ExcepcionPlataforma,
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

// F6.10: excepción tal como se guarda — modo/valor/umbralCantidad en null
// significa "hereda el valor por defecto", nunca "vale cero".
const esquemaExcepcion = t.Object({
  plataformaId: t.String(),
  comisiona: t.Boolean(),
  modo: t.Union([modoComision, t.Null()]),
  valor: t.Union([t.String(), t.Null()]),
  umbralCantidad: t.Union([t.Number(), t.Null()]),
});

// Lo que llega por body al guardar o simular una excepción (PUT
// /configuracion, POST /simulacion). Los tres campos son opcionales
// además de nullables porque "no venir" y "venir en null" significan lo
// mismo: no hay valor propio.
const esquemaExcepcionEntrada = t.Object({
  plataformaId: t.String(),
  comisiona: t.Boolean(),
  modo: t.Optional(t.Union([modoComision, t.Null()])),
  valor: t.Optional(t.Union([dinero, t.Null()])),
  umbralCantidad: t.Optional(t.Union([t.Integer({ minimum: 0 }), t.Null()])),
});

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
  excepciones: t.Array(esquemaExcepcion),
});

// La regla YA RESUELTA de una plataforma activa (F6.10, Parte 3): lo que
// GET /configuracion muestra en la fila de cada servicio, con los campos
// heredados ya rellenados — la pantalla nunca debe rellenarlos ella misma.
// Cuando no hay ConfiguracionComision vigente no hay valor por defecto
// contra el cual resolver nada, así que los campos resueltos vienen en
// null — nunca una fila vacía ni un array vacío (bug de staging, F6.10):
// el estado "recién abierta, sin guardar nada" es el único garantizado al
// abrir esta pantalla por primera vez.
const esquemaPlataformaResuelta = t.Object({
  plataformaId: t.String(),
  nombre: t.String(),
  propia: t.Boolean(),
  comisiona: t.Union([t.Boolean(), t.Null()]),
  modo: t.Union([modoComision, t.Null()]),
  valor: t.Union([t.String(), t.Null()]),
  umbralCantidad: t.Union([t.Number(), t.Null()]),
});

const esquemaPlataformaHeredando = t.Object({ plataformaId: t.String(), nombre: t.String() });

interface FilaExcepcion {
  plataformaId: string;
  comisiona: boolean;
  modo: ModoComision | null;
  valor: Prisma.Decimal | null;
  umbralCantidad: number | null;
}

function respuestaExcepcion(fila: FilaExcepcion) {
  return {
    plataformaId: fila.plataformaId,
    comisiona: fila.comisiona,
    modo: fila.modo,
    valor: fila.valor?.toString() ?? null,
    umbralCantidad: fila.umbralCantidad,
  };
}

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
  excepciones: FilaExcepcion[];
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
    excepciones: fila.excepciones.map(respuestaExcepcion),
  };
}

const INCLUYE_CREADA_POR = { creadaPor: { select: { id: true, nombre: true } } } as const;
const INCLUYE_VERSION_COMPLETA = { ...INCLUYE_CREADA_POR, excepciones: true } as const;

const esquemaFilaPeriodo = t.Object({
  periodoInicio: t.String(),
  pantallasVendidas: t.Number(),
  pantallasAbsorbidas: t.Number(),
  pantallasComisionadas: t.Number(),
  porcentajeComisionado: t.Number(),
  pozoTotal: t.String(),
});

// Desglose por plataforma del simulador (F6.10, Parte 3): lo que permite
// comparar servicios, que es para lo que se pidió esta entrega.
const esquemaFilaPlataformaSimulacion = t.Object({
  plataformaId: t.String(),
  pantallasVendidas: t.Number(),
  pantallasAbsorbidas: t.Number(),
  pantallasExcluidas: t.Number(),
  pantallasComisionadas: t.Number(),
  pozo: t.String(),
});

const esquemaSimulacion = t.Object({
  pantallasVendidas: t.Number(),
  pantallasAbsorbidas: t.Number(),
  pantallasComisionadas: t.Number(),
  porcentajeComisionado: t.Number(),
  pozoTotal: t.String(),
  porPeriodo: t.Array(esquemaFilaPeriodo),
  porPlataforma: t.Array(esquemaFilaPlataformaSimulacion),
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

/**
 * Normaliza y valida UNA lista de excepciones que llega por body (PUT
 * /configuracion y POST /simulacion comparten esta forma — Parte 1 y 3).
 * No valida existencia/actividad de la plataforma: eso depende de la base y
 * cada ruta decide si lo necesita (PUT sí, la simulación no — una
 * plataformaId que no coincide con ningún renglón vendido simplemente no
 * hace nada).
 *
 * `comisiona: false` anula modo/valor/umbralCantidad al normalizar — lo que
 * el body mande ahí no importa porque nunca se lee (PROMPT-F6.10, Parte 1).
 * Devuelve el error de la primera fila inválida, o la primera plataformaId
 * repetida.
 */
function normalizarExcepciones(
  entradas: {
    plataformaId: string;
    comisiona: boolean;
    modo?: ModoComision | null;
    valor?: string | null;
    umbralCantidad?: number | null;
  }[],
  defecto: { modo: ModoComision },
  umbralAmbito: AmbitoUmbral,
): { excepciones: ExcepcionPlataforma[] } | { error: { codigo: string; mensaje: string } } {
  const idsVistos = new Set<string>();
  const excepciones: ExcepcionPlataforma[] = [];

  for (const entrada of entradas) {
    if (idsVistos.has(entrada.plataformaId)) {
      return {
        error: {
          codigo: "PLATAFORMA_DUPLICADA",
          mensaje: `La plataforma ${entrada.plataformaId} aparece más de una vez en las excepciones.`,
        },
      };
    }
    idsVistos.add(entrada.plataformaId);

    const normalizada: ExcepcionPlataforma = {
      plataformaId: entrada.plataformaId,
      comisiona: entrada.comisiona,
      modo: entrada.comisiona ? entrada.modo ?? null : null,
      valor: entrada.comisiona && entrada.valor != null ? new Prisma.Decimal(entrada.valor) : null,
      umbralCantidad: entrada.comisiona ? entrada.umbralCantidad ?? null : null,
    };

    const error = validarExcepcionComision(defecto, umbralAmbito, normalizada);
    if (error) return { error };

    excepciones.push(normalizada);
  }

  return { excepciones };
}

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
        include: INCLUYE_VERSION_COMPLETA,
      });

      // Regla resuelta por plataforma ACTIVA (F6.10, Parte 3): la pantalla
      // de configuración nunca rellena un valor heredado ella misma, lo
      // recibe ya resuelto de resolverReglaPlataforma — la misma función
      // que usa aportesPantallasComisionables para cobrar de verdad.
      const activas = await cliente.plataforma.findMany({
        where: { activa: true },
        orderBy: { nombre: "asc" },
        select: { id: true, nombre: true },
      });
      const excepcionesPorPlataforma = new Map((vigente?.excepciones ?? []).map((e) => [e.plataformaId, e]));
      // SIEMPRE una fila por plataforma activa, con o sin configuración
      // vigente — "sin configuración guardada" es el estado garantizado con
      // el que se abre esta pantalla la primera vez, no un caso aparte.
      const plataformas = activas.map((plataforma) => {
        const excepcion = excepcionesPorPlataforma.get(plataforma.id);
        const regla = vigente ? resolverReglaPlataforma(vigente, excepcion) : null;
        return {
          plataformaId: plataforma.id,
          nombre: plataforma.nombre,
          propia: excepcion !== undefined,
          comisiona: regla?.comisiona ?? null,
          modo: regla?.modo ?? null,
          valor: regla?.valor.toString() ?? null,
          umbralCantidad: regla?.umbralCantidad ?? null,
        };
      });

      return { configuracion: vigente ? respuestaConfiguracion(vigente) : null, plataformas };
    },
    {
      response: {
        200: t.Object({
          configuracion: t.Union([esquemaConfiguracion, t.Null()]),
          plataformas: t.Array(esquemaPlataformaResuelta),
        }),
      },
    },
  )
  .put(
    "/configuracion",
    async ({ body, contexto, set }) => {
      const valor = new Prisma.Decimal(body.valor);
      const errorBase = validarParametrosComision({
        modo: body.modo,
        valor,
        umbralCantidad: body.umbralCantidad,
        umbralAmbito: body.umbralAmbito,
        umbralPeriodo: body.umbralPeriodo,
      });
      if (errorBase) {
        set.status = 400;
        return { error: errorBase };
      }

      const normalizado = normalizarExcepciones(body.excepciones ?? [], { modo: body.modo }, body.umbralAmbito);
      if ("error" in normalizado) {
        set.status = 400;
        return { error: normalizado.error };
      }
      const { excepciones } = normalizado;

      const cliente = prismaParaEmpresa(contexto.empresaId);

      // Una sola consulta de plataformas activas: sirve para validar que
      // cada excepción apunta a una plataforma que existe y está activa
      // (PROMPT-F6.10, Parte 1), y después para calcular cuántas quedan
      // heredando sin tocar la base otra vez.
      const activas = await cliente.plataforma.findMany({ where: { activa: true }, select: { id: true, nombre: true } });
      const activasPorId = new Map(activas.map((p) => [p.id, p]));
      for (const excepcion of excepciones) {
        if (!activasPorId.has(excepcion.plataformaId)) {
          set.status = 400;
          return {
            error: {
              codigo: "PLATAFORMA_INVALIDA",
              mensaje: `La plataforma ${excepcion.plataformaId} no existe o está inactiva.`,
            },
          };
        }
      }

      // Registro por versión (CLAUDE.md): nunca UPDATE sobre la fila
      // anterior ni sobre sus excepciones. La anterior queda intacta y
      // consultable en /historial — es lo que permite saber qué regla
      // regía cuando se vendió, aunque la tarifa haya cambiado después
      // (F6.6 calcula siempre con la vigente al momento de leer, no con la
      // que regía al vender — ver el comentario de cabecera de
      // lib/comisiones.ts). Las excepciones nuevas cuelgan de la versión
      // nueva, nunca se reasignan a una vieja.
      const creada = await cliente.$transaction(async (tx) => {
        const version = await tx.configuracionComision.create({
          data: datosSinEmpresa<Prisma.ConfiguracionComisionUncheckedCreateInput>({
            modo: body.modo,
            valor: valor.toString(),
            umbralCantidad: body.umbralCantidad,
            umbralAmbito: body.umbralAmbito,
            umbralPeriodo: body.umbralPeriodo,
            vigenteDesde: new Date(),
            creadaPorId: contexto.usuarioId!,
          }),
        });

        if (excepciones.length > 0) {
          await tx.configuracionComisionPlataforma.createManyAndReturn({
            data: excepciones.map((excepcion) =>
              datosSinEmpresa<Prisma.ConfiguracionComisionPlataformaUncheckedCreateInput>({
                configuracionId: version.id,
                plataformaId: excepcion.plataformaId,
                comisiona: excepcion.comisiona,
                modo: excepcion.modo,
                valor: excepcion.valor?.toString() ?? null,
                umbralCantidad: excepcion.umbralCantidad,
              }),
            ),
          });
        }

        return tx.configuracionComision.findUniqueOrThrow({
          where: { id: version.id },
          include: INCLUYE_VERSION_COMPLETA,
        });
      });

      // Aviso de cuántas y cuáles plataformas activas quedan sin regla
      // propia (PROMPT-F6.10, Parte 5): heredan el valor por defecto,
      // incluidas las que se creen después — no es un error, es
      // información para que el ADMIN confirme que es lo que quería.
      const idsConReglaPropia = new Set(excepciones.map((e) => e.plataformaId));
      const plataformasHeredando = activas
        .filter((p) => !idsConReglaPropia.has(p.id))
        .map((p) => ({ plataformaId: p.id, nombre: p.nombre }));

      set.status = 201;
      return { configuracion: respuestaConfiguracion(creada), plataformasHeredando };
    },
    {
      body: t.Object({
        modo: modoComision,
        valor: dinero,
        umbralCantidad: t.Integer({ minimum: 0 }),
        umbralAmbito: ambitoUmbral,
        umbralPeriodo: periodoUmbral,
        excepciones: t.Optional(t.Array(esquemaExcepcionEntrada)),
      }),
      response: {
        201: t.Object({ configuracion: esquemaConfiguracion, plataformasHeredando: t.Array(esquemaPlataformaHeredando) }),
        400: esquemaError,
      },
    },
  )
  .get(
    "/configuracion/historial",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const filas = await cliente.configuracionComision.findMany({
        orderBy: { vigenteDesde: "desc" },
        include: INCLUYE_VERSION_COMPLETA,
      });
      return { versiones: filas.map(respuestaConfiguracion) };
    },
    { response: { 200: t.Object({ versiones: t.Array(esquemaConfiguracion) }) } },
  )
  // F6.10, Parte 3: GET se reemplaza por POST porque la tabla de
  // excepciones no entra en un query string. Sigue siendo ESTRICTAMENTE DE
  // SOLO LECTURA — nunca toca ConfiguracionComision ni
  // ConfiguracionComisionPlataforma. No "arreglar" esto después para que
  // guarde: para guardar existe PUT /configuracion.
  .post(
    "/simulacion",
    async ({ body, contexto, set }) => {
      const valor = new Prisma.Decimal(body.valor);
      const errorBase = validarParametrosComision({
        modo: body.modo,
        valor,
        umbralCantidad: body.umbralCantidad,
        umbralAmbito: body.umbralAmbito,
        umbralPeriodo: body.umbralPeriodo,
      });
      if (errorBase) {
        set.status = 400;
        return { error: errorBase };
      }

      const normalizado = normalizarExcepciones(body.excepciones ?? [], { modo: body.modo }, body.umbralAmbito);
      if ("error" in normalizado) {
        set.status = 400;
        return { error: normalizado.error };
      }

      // Simula con los parámetros que llegan por body, NUNCA con la
      // configuración guardada — lo que permite mover el número y ver el
      // efecto antes de guardar nada (PROMPT-F6.5, Parte 3).
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const resultado = await simularComisiones(cliente, {
        desde: inicioDeFechaBogota(body.desde),
        hasta: finDeFechaBogota(body.hasta),
        modo: body.modo,
        valor,
        umbralCantidad: body.umbralCantidad,
        umbralAmbito: body.umbralAmbito,
        umbralPeriodo: body.umbralPeriodo,
        excepciones: normalizado.excepciones,
      });
      return resultado;
    },
    {
      body: t.Object({
        desde: t.String(),
        hasta: t.String(),
        modo: modoComision,
        valor: dinero,
        umbralCantidad: t.Integer({ minimum: 0 }),
        umbralAmbito: ambitoUmbral,
        umbralPeriodo: periodoUmbral,
        excepciones: t.Optional(t.Array(esquemaExcepcionEntrada)),
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
