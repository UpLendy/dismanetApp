import { Elysia, t } from "elysia";
import { prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";
import {
  inicioMesBogota,
  finMesBogota,
  inicioDeFechaBogota,
  finDeFechaBogota,
  inicioSemanaBogota,
} from "../lib/periodos.ts";
import { repartirPorDiaBogota } from "../lib/turnos.ts";
import {
  calcularComisiones,
  configuracionVigente,
  comisionPropia,
  type ResultadoCalculoComisiones,
} from "../lib/comisiones.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

// ---------------------------------------------------------------------------
// F6.9 — Panel individual del empleado. Esta ruta COMPONE, no recalcula
// (PROMPT-F6.9, Parte 0): las cuatro cifras ya existen — calcularComisiones
// (F6.6), el registro de reportes (F6.4) y el de instrucciones/video
// (F6.7/F6.8) — esta ruta solo las junta en una sola respuesta.
//
// R4: ni costo, ni utilidad, ni margen, ni el pozo total del día, ni la
// tajada de otro usuario viajan aquí jamás (ver comisionPropia, que es
// exactamente la misma función que usa /comisiones/mias).
// ---------------------------------------------------------------------------

const esquemaFilaDiaPropia = t.Object({
  dia: t.String(),
  cerrado: t.Boolean(),
  horas: t.Number(),
  tajada: t.String(),
});

const esquemaComision = t.Object({
  configurada: t.Boolean(),
  totalCerrado: t.String(),
  provisional: t.Union([t.Object({ dia: t.String(), horas: t.Number(), tajada: t.String() }), t.Null()]),
  porDia: t.Array(esquemaFilaDiaPropia),
});

const esquemaVentas = t.Object({
  numeroVentas: t.Number(),
  pantallasVendidas: t.Number(),
  totalVendido: t.String(),
});

const esquemaMetas = t.Object({
  cumplidas: t.Number(),
  incumplidas: t.Number(),
  dias: t.Array(t.Object({ dia: t.String(), cumplida: t.Boolean() })),
});

const esquemaVideoPendiente = t.Object({
  archivoId: t.String(),
  duracionSegundos: t.Union([t.Number(), t.Null()]),
  segundosVistos: t.Number(),
  cobertura: t.Number(),
  completado: t.Boolean(),
});

const esquemaInstruccionPendiente = t.Object({
  id: t.String(),
  titulo: t.String(),
  semanaInicio: t.String(),
  videos: t.Array(esquemaVideoPendiente),
});

const esquemaPendientes = t.Object({
  reporteSemanalPendiente: t.Boolean(),
  instrucciones: t.Array(esquemaInstruccionPendiente),
});

const esquemaPanel = t.Object({
  usuario: t.Object({ id: t.String(), nombre: t.String() }),
  rango: t.Object({ desde: t.String(), hasta: t.String() }),
  ventas: esquemaVentas,
  comision: esquemaComision,
  metas: esquemaMetas,
  pendientes: esquemaPendientes,
});

const consultaRango = t.Object({ desde: t.Optional(t.String()), hasta: t.Optional(t.String()) });

type ClienteEmpresa = Prisma.TransactionClient;

interface UsuarioObjetivo {
  id: string;
  nombre: string;
  cargoId: string | null;
}

const RESULTADO_SIN_CONFIGURAR: ResultadoCalculoComisiones = {
  configurada: false,
  pozoTotal: new Prisma.Decimal(0),
  pozoSinRepartir: new Prisma.Decimal(0),
  pantallasComisionadas: 0,
  porDia: [],
};

/**
 * Junta las cuatro fuentes para UN usuario y un rango [desde, hasta). Fija
 * en número de consultas sin importar cuántos días, ventas o instrucciones
 * haya — nada de un query por día ni por instrucción (PROMPT-F6.9, Parte 3:
 * "que no se vuelva un N+1").
 */
async function construirPanel(cliente: ClienteEmpresa, usuario: UsuarioObjetivo, desde: Date, hasta: Date, ahora: Date) {
  // 1) Comisiones — misma función que /comisiones/mias (F6.6), mismo
  // recorte por usuario (comisionPropia): nunca el pozo total ni la tajada
  // de otro.
  const configuracion = await configuracionVigente(cliente);
  const resultadoComisiones = configuracion
    ? await calcularComisiones(cliente, { desde, hasta, ...configuracion }, ahora)
    : RESULTADO_SIN_CONFIGURAR;
  const comision = comisionPropia(resultadoComisiones, usuario.id);

  // 2) Metas (PROMPT-F6.9, Parte 1): un día con turno cuenta cumplida si el
  // equipo generó pozo ese día (calcularComisiones ya solo deja en porDia
  // los días con aporte comisionable); sin turno, el día no cuenta.
  const diasConPozo = new Set(
    resultadoComisiones.porDia.filter((dia) => dia.pozo.greaterThan(0)).map((dia) => dia.dia.getTime()),
  );

  const turnosPropios = await cliente.turno.findMany({
    where: { usuarioId: usuario.id, inicio: { lt: hasta }, fin: { gt: desde } },
    select: { inicio: true, fin: true },
  });

  const diasConTurno = new Set<number>();
  for (const turno of turnosPropios) {
    const inicioClip = turno.inicio < desde ? desde : turno.inicio;
    const finClip = turno.fin > hasta ? hasta : turno.fin;
    if (finClip <= inicioClip) continue;
    for (const { fecha } of repartirPorDiaBogota(inicioClip, finClip)) {
      diasConTurno.add(fecha.getTime());
    }
  }

  let cumplidas = 0;
  let incumplidas = 0;
  const diasMeta = [...diasConTurno]
    .sort((a, b) => a - b)
    .map((clave) => {
      const cumplida = diasConPozo.has(clave);
      if (cumplida) cumplidas += 1;
      else incumplidas += 1;
      return { dia: new Date(clave).toISOString(), cumplida };
    });

  // 3) Ventas realizadas — propio tally, nunca costo/utilidad en el select
  // (R4: mismo criterio que GET /ventas/mias).
  const ventasPropias = await cliente.venta.findMany({
    where: { vendedorId: usuario.id, esExterna: false, anulada: false, fechaVenta: { gte: desde, lt: hasta } },
    select: { id: true, precioVenta: true, detalles: { select: { id: true } } },
  });
  const totalVendido = ventasPropias.reduce((suma, venta) => suma.plus(venta.precioVenta), new Prisma.Decimal(0));
  const pantallasVendidas = ventasPropias.reduce((suma, venta) => suma + venta.detalles.length, 0);

  // 4) Pendientes — reporte semanal de la semana EN CURSO (F6.4, siempre la
  // actual, independiente del rango elegido) e instrucciones publicadas que
  // le aplican y no ha completado (F6.7/F6.8), con su avance de video.
  const semanaActual = inicioSemanaBogota(ahora);
  const reporteSemana = await cliente.reporteSemanal.findFirst({
    where: { usuarioId: usuario.id, semanaInicio: semanaActual },
    select: { id: true },
  });

  const candidatas = await cliente.instruccion.findMany({
    where: { publicada: true, OR: [{ cargoId: null }, { cargoId: usuario.cargoId }] },
    select: {
      id: true,
      titulo: true,
      semanaInicio: true,
      archivos: { where: { tipo: "VIDEO" }, select: { id: true, duracionSegundos: true } },
    },
  });

  const cumplimientos = await cliente.instruccionCumplimiento.findMany({
    where: { usuarioId: usuario.id, instruccionId: { in: candidatas.map((c) => c.id) } },
    select: { instruccionId: true },
  });
  const idsCumplidas = new Set(cumplimientos.map((c) => c.instruccionId));
  const pendientesInstrucciones = candidatas.filter((c) => !idsCumplidas.has(c.id));

  const archivoIds = pendientesInstrucciones.flatMap((c) => c.archivos.map((a) => a.id));
  const visualizaciones =
    archivoIds.length > 0
      ? await cliente.instruccionVisualizacion.findMany({
          where: { usuarioId: usuario.id, archivoId: { in: archivoIds } },
          select: { archivoId: true, segundosVistos: true, completadoEn: true },
        })
      : [];
  const progresoPorArchivo = new Map(visualizaciones.map((v) => [v.archivoId, v]));

  return {
    usuario: { id: usuario.id, nombre: usuario.nombre },
    rango: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    ventas: {
      numeroVentas: ventasPropias.length,
      pantallasVendidas,
      totalVendido: totalVendido.toString(),
    },
    comision,
    metas: { cumplidas, incumplidas, dias: diasMeta },
    pendientes: {
      reporteSemanalPendiente: !reporteSemana,
      instrucciones: pendientesInstrucciones.map((c) => ({
        id: c.id,
        titulo: c.titulo,
        semanaInicio: c.semanaInicio.toISOString(),
        videos: c.archivos.map((archivo) => {
          const visualizacion = progresoPorArchivo.get(archivo.id);
          const segundosVistos = visualizacion?.segundosVistos ?? 0;
          const cobertura =
            archivo.duracionSegundos && archivo.duracionSegundos > 0
              ? Math.min(1, segundosVistos / archivo.duracionSegundos)
              : 0;
          return {
            archivoId: archivo.id,
            duracionSegundos: archivo.duracionSegundos,
            segundosVistos,
            cobertura,
            completado: visualizacion?.completadoEn != null,
          };
        }),
      })),
    },
  };
}

/** Rango por defecto: el mes en curso (PROMPT-F6.9, Parte 2). */
function resolverRango(query: { desde?: string; hasta?: string }, ahora: Date): { desde: Date; hasta: Date } {
  if (query.desde && query.hasta) {
    return { desde: inicioDeFechaBogota(query.desde), hasta: finDeFechaBogota(query.hasta) };
  }
  return { desde: inicioMesBogota(ahora), hasta: finMesBogota(ahora) };
}

// Prefijo /panel-empleado. EMPLEADO en adelante para el propio (siempre
// contexto.usuarioId, nunca un usuarioId de query — mismo criterio que
// /comisiones/mias); ADMIN en adelante para el de cualquier empleado de su
// empresa. Un VENDEDOR no tiene panel de empleado: 403 en las dos
// (PROMPT-F6.9, Parte 3).
export const panelEmpleado = new Elysia({ prefix: "/panel-empleado" })
  .use(requiereRol(Rol.EMPLEADO))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: { codigo: "SIN_EMPRESA_ACTIVA", mensaje: "Selecciona una empresa antes de consultar el panel." },
      };
    }
  })
  .get(
    "/",
    async ({ contexto, query }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const ahora = new Date();
      const { desde, hasta } = resolverRango(query, ahora);

      const usuarioActual = await cliente.usuario.findFirst({
        where: { id: contexto.usuarioId! },
        select: { id: true, nombre: true, cargoId: true },
      });

      return construirPanel(cliente, usuarioActual!, desde, hasta, ahora);
    },
    { query: consultaRango, response: { 200: esquemaPanel } },
  )
  .use(requiereRol(Rol.ADMIN))
  .get(
    "/:usuarioId",
    async ({ contexto, params, query, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const ahora = new Date();
      const { desde, hasta } = resolverRango(query, ahora);

      // R1: prismaParaEmpresa ya filtra por la empresa del ADMIN; un usuario
      // de otra empresa no aparece y esto responde 404, igual que si no
      // existiera. Solo EMPLEADO: un ADMIN o VENDEDOR no tiene panel de
      // empleado que mostrar aquí.
      const objetivo = await cliente.usuario.findFirst({
        where: { id: params.usuarioId, rol: Rol.EMPLEADO },
        select: { id: true, nombre: true, cargoId: true },
      });
      if (!objetivo) {
        set.status = 404;
        return { error: { codigo: "EMPLEADO_NO_ENCONTRADO", mensaje: "El empleado no existe en esta empresa." } };
      }

      return construirPanel(cliente, objetivo, desde, hasta, ahora);
    },
    {
      params: t.Object({ usuarioId: t.String() }),
      query: consultaRango,
      response: { 200: esquemaPanel, 404: esquemaError },
    },
  );
