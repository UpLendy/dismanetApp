import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { inicioDeFechaBogota, inicioSemanaBogota } from "../lib/periodos.ts";
import { esSemanaEditable, reporteVacio } from "../lib/reportes.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaCargoCopiado = t.Union([t.String(), t.Null()]);

const esquemaReporte = t.Object({
  id: t.String(),
  usuarioId: t.String(),
  usuario: t.Object({ id: t.String(), nombre: t.String() }),
  cargoId: esquemaCargoCopiado,
  semanaInicio: t.String(),
  pendientes: t.String(),
  fallas: t.String(),
  oportunidades: t.String(),
  actualizadoEn: t.String(),
});

interface FilaReporte {
  id: string;
  usuarioId: string;
  usuario: { id: string; nombre: string };
  cargoId: string | null;
  semanaInicio: Date;
  pendientes: string;
  fallas: string;
  oportunidades: string;
  actualizadoEn: Date;
}

function respuestaReporte(fila: FilaReporte) {
  return {
    id: fila.id,
    usuarioId: fila.usuarioId,
    usuario: fila.usuario,
    cargoId: fila.cargoId,
    semanaInicio: fila.semanaInicio.toISOString(),
    pendientes: fila.pendientes,
    fallas: fila.fallas,
    oportunidades: fila.oportunidades,
    actualizadoEn: fila.actualizadoEn.toISOString(),
  };
}

const INCLUYE_USUARIO = { usuario: { select: { id: true, nombre: true } } } as const;

const cuerpoReporte = t.Object({
  semana: t.String(),
  pendientes: t.String(),
  fallas: t.String(),
  oportunidades: t.String(),
});

/** `semana` es cualquier fecha YYYY-MM-DD dentro de la semana (CLAUDE.md: nunca aritmética de semanas nueva). */
function semanaInicioDeQuery(semana: string): Date {
  return inicioSemanaBogota(inicioDeFechaBogota(semana));
}

// Prefijo /reportes. EMPLEADO en adelante (F6.4: mismo criterio que F6.3 —
// un VENDEDOR es un revendedor externo y no reporta). Interpretación del
// punto 5 del cliente (ver PROMPT-F6.4, Parte 0): cada EMPLEADO escribe su
// propio reporte; el cargo agrupa al leerlos, no agrupa al escribirlos.
export const reportes = new Elysia({ prefix: "/reportes" })
  .use(requiereRol(Rol.EMPLEADO))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: { codigo: "SIN_EMPRESA_ACTIVA", mensaje: "Selecciona una empresa antes de continuar." },
      };
    }
  })
  .get(
    "/mio",
    async ({ query, contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const semanaInicio = semanaInicioDeQuery(query.semana);
      const reporte = await cliente.reporteSemanal.findFirst({
        where: { usuarioId: contexto.usuarioId!, semanaInicio },
        include: INCLUYE_USUARIO,
      });
      return {
        reporte: reporte ? respuestaReporte(reporte) : null,
        editable: esSemanaEditable(semanaInicio, new Date()),
      };
    },
    {
      query: t.Object({ semana: t.String() }),
      response: {
        200: t.Object({ reporte: t.Union([esquemaReporte, t.Null()]), editable: t.Boolean() }),
      },
    },
  )
  // Cada quien escribe el suyo: usuarioId sale siempre de la sesión, nunca
  // del body — ni para un ADMIN. Un reporte es el testimonio de quien lo
  // firma (PROMPT-F6.4, Parte 2); por eso el body ni declara ese campo.
  .put(
    "/mio",
    async ({ body, contexto, set }) => {
      const semanaInicio = semanaInicioDeQuery(body.semana);

      if (!esSemanaEditable(semanaInicio, new Date())) {
        set.status = 409;
        return {
          error: {
            codigo: "SEMANA_CERRADA",
            mensaje: "Esa semana ya cerró: solo se puede escribir o editar la semana actual y la anterior.",
          },
        };
      }
      if (reporteVacio(body.pendientes, body.fallas, body.oportunidades)) {
        set.status = 400;
        return {
          error: { codigo: "REPORTE_VACIO", mensaje: "El reporte no puede quedar completamente vacío." },
        };
      }

      const cliente = prismaParaEmpresa(contexto.empresaId);

      // cargoId se copia al momento de escribir (R3-like, no es relación
      // viva): se relee en cada PUT porque cada PUT es, literalmente, un
      // nuevo "momento de escribir" dentro de la ventana editable.
      const usuarioActual = await cliente.usuario.findFirst({
        where: { id: contexto.usuarioId! },
        select: { cargoId: true },
      });

      const datos = {
        cargoId: usuarioActual?.cargoId ?? null,
        pendientes: body.pendientes,
        fallas: body.fallas,
        oportunidades: body.oportunidades,
      };

      const existente = await cliente.reporteSemanal.findFirst({
        where: { usuarioId: contexto.usuarioId!, semanaInicio },
      });

      let reporte;
      if (existente) {
        reporte = await cliente.reporteSemanal.update({
          where: { id: existente.id },
          data: datos,
          include: INCLUYE_USUARIO,
        });
      } else {
        // `upsert` está bloqueado por la extensión multi-tenant (CLAUDE.md):
        // busca y crea/actualiza a mano. El catch cubre la carrera de dos
        // PUT simultáneos de la misma persona y semana — el @@unique la
        // detecta, y quien pierde la carrera actualiza la fila que ya ganó
        // la otra petición en vez de duplicar.
        try {
          reporte = await cliente.reporteSemanal.create({
            data: datosSinEmpresa<Prisma.ReporteSemanalUncheckedCreateInput>({
              usuarioId: contexto.usuarioId!,
              semanaInicio,
              ...datos,
            }),
            include: INCLUYE_USUARIO,
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const ganador = await cliente.reporteSemanal.findFirst({
              where: { usuarioId: contexto.usuarioId!, semanaInicio },
            });
            reporte = await cliente.reporteSemanal.update({
              where: { id: ganador!.id },
              data: datos,
              include: INCLUYE_USUARIO,
            });
          } else {
            throw error;
          }
        }
      }

      return { reporte: respuestaReporte(reporte) };
    },
    {
      body: cuerpoReporte,
      response: { 200: t.Object({ reporte: esquemaReporte }), 400: esquemaError, 409: esquemaError },
    },
  )
  .use(requiereRol(Rol.ADMIN))
  .get(
    "/",
    async ({ query, contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const semanaInicio = semanaInicioDeQuery(query.semana);
      const filas = await cliente.reporteSemanal.findMany({
        where: { semanaInicio, ...(query.cargoId ? { cargoId: query.cargoId } : {}) },
        include: INCLUYE_USUARIO,
        orderBy: { usuario: { nombre: "asc" } },
      });
      return { reportes: filas.map(respuestaReporte) };
    },
    {
      query: t.Object({ semana: t.String(), cargoId: t.Optional(t.String()) }),
      response: { 200: t.Object({ reportes: t.Array(esquemaReporte) }) },
    },
  )
  // Alimenta el "reportes pendientes" del punto 6 del cliente: quién de los
  // EMPLEADO+ activos todavía no entregó el de esta semana. Cargo aquí es el
  // actual (vive de la relación), porque la pregunta es sobre gente de HOY,
  // no sobre un reporte ya escrito.
  .get(
    "/faltantes",
    async ({ query, contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const semanaInicio = semanaInicioDeQuery(query.semana);

      const empleados = await cliente.usuario.findMany({
        where: { activo: true, rol: { not: Rol.VENDEDOR } },
        select: { id: true, nombre: true, cargo: { select: { id: true, nombre: true } } },
        orderBy: { nombre: "asc" },
      });

      const yaReportaron = await cliente.reporteSemanal.findMany({
        where: { semanaInicio },
        select: { usuarioId: true },
      });
      const idsReportaron = new Set(yaReportaron.map((r) => r.usuarioId));

      const faltantes = empleados.filter((u) => !idsReportaron.has(u.id));
      return { faltantes: faltantes.map((u) => ({ id: u.id, nombre: u.nombre, cargo: u.cargo })) };
    },
    {
      query: t.Object({ semana: t.String() }),
      response: {
        200: t.Object({
          faltantes: t.Array(
            t.Object({
              id: t.String(),
              nombre: t.String(),
              cargo: t.Union([t.Object({ id: t.String(), nombre: t.String() }), t.Null()]),
            }),
          ),
        }),
      },
    },
  );
