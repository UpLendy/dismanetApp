import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { inicioDeFechaBogota, inicioSemanaBogota } from "../lib/periodos.ts";
import { aplicaACargo, instruccionVisiblePara } from "../lib/instrucciones.ts";
import { aplicarProgreso, type Tramo } from "../lib/visualizacion.ts";
import {
  esContentTypePermitido,
  eliminarObjeto,
  generarClaveArchivo,
  tamanoDeObjeto,
  tamanoMaximoBytes,
  tipoArchivoDeContentType,
  urlLecturaPrefirmada,
  urlSubidaPrefirmada,
} from "../lib/s3.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaArchivo = t.Object({
  id: t.String(),
  tipo: t.Union([t.Literal("IMAGEN"), t.Literal("VIDEO")]),
  nombre: t.String(),
  contentType: t.String(),
  bytes: t.Number(),
  duracionSegundos: t.Union([t.Number(), t.Null()]),
  orden: t.Number(),
  createdAt: t.String(),
});

const esquemaInstruccion = t.Object({
  id: t.String(),
  titulo: t.String(),
  descripcion: t.Union([t.String(), t.Null()]),
  semanaInicio: t.String(),
  cargoId: t.Union([t.String(), t.Null()]),
  publicada: t.Boolean(),
  archivos: t.Array(esquemaArchivo),
  cumplida: t.Optional(t.Boolean()),
});

const esquemaVideoResumen = t.Object({
  id: t.String(),
  nombre: t.String(),
  duracionSegundos: t.Union([t.Number(), t.Null()]),
});

const esquemaVideoPersona = t.Object({
  archivoId: t.String(),
  cobertura: t.Number(),
  completado: t.Boolean(),
});

const esquemaCumplimientoFila = t.Object({
  id: t.String(),
  nombre: t.String(),
  cumplio: t.Boolean(),
  completadoEn: t.Union([t.String(), t.Null()]),
  videos: t.Array(esquemaVideoPersona),
});

const esquemaProgresoArchivo = t.Object({
  archivoId: t.String(),
  duracionSegundos: t.Union([t.Number(), t.Null()]),
  segundosVistos: t.Number(),
  cobertura: t.Number(),
  completado: t.Boolean(),
});

interface FilaArchivo {
  id: string;
  tipo: "IMAGEN" | "VIDEO";
  nombre: string;
  contentType: string;
  bytes: number;
  duracionSegundos: number | null;
  orden: number;
  createdAt: Date;
}

interface FilaInstruccion {
  id: string;
  titulo: string;
  descripcion: string | null;
  semanaInicio: Date;
  cargoId: string | null;
  publicada: boolean;
  archivos: FilaArchivo[];
}

function respuestaArchivo(fila: FilaArchivo) {
  return {
    id: fila.id,
    tipo: fila.tipo,
    nombre: fila.nombre,
    contentType: fila.contentType,
    bytes: fila.bytes,
    duracionSegundos: fila.duracionSegundos,
    orden: fila.orden,
    createdAt: fila.createdAt.toISOString(),
  };
}

function respuestaInstruccion(fila: FilaInstruccion, cumplida?: boolean) {
  return {
    id: fila.id,
    titulo: fila.titulo,
    descripcion: fila.descripcion,
    semanaInicio: fila.semanaInicio.toISOString(),
    cargoId: fila.cargoId,
    publicada: fila.publicada,
    archivos: fila.archivos.map(respuestaArchivo),
    ...(cumplida !== undefined ? { cumplida } : {}),
  };
}

const INCLUYE_ARCHIVOS = { archivos: { orderBy: { orden: "asc" as const } } };

/** `semana` es cualquier fecha YYYY-MM-DD dentro de la semana (CLAUDE.md: nunca aritmética de semanas nueva). */
function semanaInicioDeQuery(semana: string): Date {
  return inicioSemanaBogota(inicioDeFechaBogota(semana));
}

function esAdmin(rol: Rol | null): boolean {
  return rol === Rol.ADMIN || rol === Rol.SUPER_ADMIN;
}

// Prefijo /instrucciones. EMPLEADO en adelante para leer y marcar cumplida
// (mismo criterio que F6.3/F6.4: un VENDEDOR es un revendedor externo, no
// recibe instrucciones de operación); ADMIN en adelante para crear, editar,
// publicar y gestionar archivos. Los archivos (imágenes y video) nunca pasan
// por este servidor: van directo del navegador a S3 con URLs prefirmadas
// (ver lib/s3.ts, PROMPT-F6.7 Parte 1).
export const instrucciones = new Elysia({ prefix: "/instrucciones" })
  .use(requiereRol(Rol.EMPLEADO))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: { codigo: "SIN_EMPRESA_ACTIVA", mensaje: "Selecciona una empresa antes de continuar." },
      };
    }
  })
  // Para el ADMIN, lista TODAS las instrucciones de la semana (para
  // gestionarlas, publicadas o no). Para EMPLEADO/VENDEDOR... un VENDEDOR
  // nunca llega aquí (guarda de arriba); un EMPLEADO solo ve las publicadas
  // que le aplican por cargo — la misma condición de instruccionVisiblePara,
  // nunca solo el filtro de semana.
  .get(
    "/",
    async ({ query, contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const semanaInicio = semanaInicioDeQuery(query.semana);
      const administra = esAdmin(contexto.rol);

      if (administra) {
        const filas = await cliente.instruccion.findMany({
          where: { semanaInicio, ...(query.cargoId !== undefined ? { cargoId: query.cargoId } : {}) },
          include: INCLUYE_ARCHIVOS,
          orderBy: { createdAt: "asc" },
        });
        return { instrucciones: filas.map((f) => respuestaInstruccion(f)) };
      }

      const usuarioActual = await cliente.usuario.findFirst({
        where: { id: contexto.usuarioId! },
        select: { cargoId: true },
      });
      const miCargoId = usuarioActual?.cargoId ?? null;

      const filas = await cliente.instruccion.findMany({
        where: { semanaInicio, publicada: true, OR: [{ cargoId: null }, { cargoId: miCargoId }] },
        include: INCLUYE_ARCHIVOS,
        orderBy: { createdAt: "asc" },
      });

      const cumplimientos = await cliente.instruccionCumplimiento.findMany({
        where: { usuarioId: contexto.usuarioId!, instruccionId: { in: filas.map((f) => f.id) } },
        select: { instruccionId: true },
      });
      const idsCumplidas = new Set(cumplimientos.map((c) => c.instruccionId));

      return { instrucciones: filas.map((f) => respuestaInstruccion(f, idsCumplidas.has(f.id))) };
    },
    {
      query: t.Object({ semana: t.String(), cargoId: t.Optional(t.String()) }),
      response: { 200: t.Object({ instrucciones: t.Array(esquemaInstruccion) }) },
    },
  )
  // URL de lectura prefirmada, de vida corta. El ADMIN puede previsualizar
  // cualquier archivo de su empresa (incluso sin publicar, porque la está
  // armando); un EMPLEADO solo si la instrucción le es visible — y si no,
  // 404, nunca 403: pedir el id directo de algo no publicado no debe
  // confirmar que existe (PROMPT-F6.7, Parte 5).
  .get(
    "/:id/archivos/:archivoId/url",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const instruccion = await cliente.instruccion.findFirst({ where: { id: params.id } });
      if (!instruccion) {
        set.status = 404;
        return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
      }

      if (!esAdmin(contexto.rol)) {
        const usuarioActual = await cliente.usuario.findFirst({
          where: { id: contexto.usuarioId! },
          select: { cargoId: true },
        });
        if (!instruccionVisiblePara(instruccion, usuarioActual?.cargoId ?? null)) {
          set.status = 404;
          return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
        }
      }

      const archivo = await cliente.instruccionArchivo.findFirst({
        where: { id: params.archivoId, instruccionId: params.id },
      });
      if (!archivo) {
        set.status = 404;
        return { error: { codigo: "ARCHIVO_NO_ENCONTRADO", mensaje: "El archivo no existe." } };
      }

      const url = await urlLecturaPrefirmada(archivo.clave);
      return { url };
    },
    {
      params: t.Object({ id: t.String(), archivoId: t.String() }),
      response: { 200: t.Object({ url: t.String() }), 404: esquemaError },
    },
  )
  // El cumplimiento se marca a mano SOLO si la instrucción no tiene video
  // (PROMPT-F6.8, Parte 2): si tiene, el cumplimiento lo registra el
  // servidor solo al completar la visualización de todos sus videos (ver
  // POST /:id/archivos/:archivoId/progreso) y esta ruta responde 409 — ahí
  // no se puede autodeclarar. Para IMAGEN sigue siendo esta tabla y esta
  // ruta. Idempotente: completar dos veces no duplica fila (@@unique en el
  // esquema + manejo de P2002).
  .post(
    "/:id/completar",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const instruccion = await cliente.instruccion.findFirst({ where: { id: params.id } });
      if (!instruccion) {
        set.status = 404;
        return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
      }

      const usuarioActual = await cliente.usuario.findFirst({
        where: { id: contexto.usuarioId! },
        select: { cargoId: true },
      });
      if (!instruccionVisiblePara(instruccion, usuarioActual?.cargoId ?? null)) {
        set.status = 404;
        return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
      }

      const totalVideos = await cliente.instruccionArchivo.count({
        where: { instruccionId: params.id, tipo: "VIDEO" },
      });
      if (totalVideos > 0) {
        set.status = 409;
        return {
          error: {
            codigo: "INSTRUCCION_CON_VIDEO",
            mensaje: "Esta instrucción tiene video: el cumplimiento se registra solo al verlo completo.",
          },
        };
      }

      const existente = await cliente.instruccionCumplimiento.findFirst({
        where: { instruccionId: params.id, usuarioId: contexto.usuarioId! },
      });
      if (existente) {
        return { ok: true as const };
      }

      try {
        await cliente.instruccionCumplimiento.create({
          data: datosSinEmpresa<Prisma.InstruccionCumplimientoUncheckedCreateInput>({
            instruccionId: params.id,
            usuarioId: contexto.usuarioId!,
          }),
        });
      } catch (error) {
        // Carrera de dos POST /completar simultáneos de la misma persona: el
        // @@unique la detecta, y quien pierde simplemente confirma que ya
        // quedó completada (no es un error del llamador).
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
          throw error;
        }
      }

      return { ok: true as const };
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ ok: t.Literal(true) }), 404: esquemaError, 409: esquemaError },
    },
  )
  // EMPLEADO en adelante, solo para sí mismo (PROMPT-F6.8, Parte 3). El
  // control que de verdad importa (reloj del servidor, Parte 1.2) vive en
  // aplicarProgreso (lib/visualizacion.ts), no aquí: esta ruta solo valida
  // permisos/forma y persiste lo que ese módulo decide.
  .post(
    "/:id/archivos/:archivoId/progreso",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const instruccion = await cliente.instruccion.findFirst({ where: { id: params.id } });
      if (!instruccion) {
        set.status = 404;
        return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
      }

      const usuarioActual = await cliente.usuario.findFirst({
        where: { id: contexto.usuarioId! },
        select: { cargoId: true },
      });
      if (!instruccionVisiblePara(instruccion, usuarioActual?.cargoId ?? null)) {
        set.status = 404;
        return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
      }

      const archivo = await cliente.instruccionArchivo.findFirst({
        where: { id: params.archivoId, instruccionId: params.id },
      });
      if (!archivo) {
        set.status = 404;
        return { error: { codigo: "ARCHIVO_NO_ENCONTRADO", mensaje: "El archivo no existe." } };
      }
      if (archivo.tipo !== "VIDEO") {
        set.status = 400;
        return { error: { codigo: "ARCHIVO_NO_ES_VIDEO", mensaje: "Solo los videos registran progreso de visualización." } };
      }
      if (body.hasta <= body.desde) {
        set.status = 400;
        return { error: { codigo: "RANGO_INVALIDO", mensaje: '"hasta" debe ser mayor que "desde".' } };
      }

      const fila = await cliente.instruccionVisualizacion.findFirst({
        where: { archivoId: params.archivoId, usuarioId: contexto.usuarioId! },
      });

      const ahora = new Date();
      const resultado = aplicarProgreso({
        estadoPrevio: fila
          ? {
              tramos: fila.tramos as Tramo[],
              segundosVistos: fila.segundosVistos,
              primerReporte: fila.primerReporte,
              ultimoReporte: fila.ultimoReporte,
              completadoEn: fila.completadoEn,
            }
          : null,
        desde: body.desde,
        hasta: body.hasta,
        ahora,
        duracionSegundos: archivo.duracionSegundos,
      });

      if (!resultado.ok) {
        set.status = 400;
        return {
          error: {
            codigo: "DEMASIADOS_TRAMOS",
            mensaje: "El progreso reportado no es consistente con una reproducción normal.",
          },
        };
      }

      const yaEstabaCompleto = fila?.completadoEn != null;
      const datosGuardar = {
        tramos: resultado.estado.tramos,
        segundosVistos: resultado.estado.segundosVistos,
        ultimoReporte: resultado.estado.ultimoReporte,
        completadoEn: resultado.estado.completadoEn,
      };

      if (fila) {
        await cliente.instruccionVisualizacion.update({ where: { id: fila.id }, data: datosGuardar });
      } else {
        try {
          await cliente.instruccionVisualizacion.create({
            data: datosSinEmpresa<Prisma.InstruccionVisualizacionUncheckedCreateInput>({
              archivoId: params.archivoId,
              usuarioId: contexto.usuarioId!,
              primerReporte: resultado.estado.primerReporte,
              ...datosGuardar,
            }),
          });
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
            throw error;
          }
          // Carrera del primer reporte (doble pestaña): quien pierde el
          // @@unique actualiza en vez de fallar.
          const existente = await cliente.instruccionVisualizacion.findFirst({
            where: { archivoId: params.archivoId, usuarioId: contexto.usuarioId! },
          });
          if (existente) {
            await cliente.instruccionVisualizacion.update({ where: { id: existente.id }, data: datosGuardar });
          }
        }
      }

      // Propagación a la instrucción (PROMPT-F6.8, Parte 2): solo se
      // revisa cuando este reporte ACABA de completar el video, para no
      // repetir estas tres consultas en cada reporte posterior.
      if (!yaEstabaCompleto && resultado.estado.completadoEn) {
        const totalVideos = await cliente.instruccionArchivo.count({
          where: { instruccionId: params.id, tipo: "VIDEO" },
        });
        const completados = await cliente.instruccionVisualizacion.count({
          where: { usuarioId: contexto.usuarioId!, completadoEn: { not: null }, archivo: { instruccionId: params.id } },
        });
        if (completados >= totalVideos) {
          const cumplimientoExistente = await cliente.instruccionCumplimiento.findFirst({
            where: { instruccionId: params.id, usuarioId: contexto.usuarioId! },
          });
          if (!cumplimientoExistente) {
            try {
              await cliente.instruccionCumplimiento.create({
                data: datosSinEmpresa<Prisma.InstruccionCumplimientoUncheckedCreateInput>({
                  instruccionId: params.id,
                  usuarioId: contexto.usuarioId!,
                }),
              });
            } catch (error) {
              if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
                throw error;
              }
            }
          }
        }
      }

      return {
        cobertura: resultado.cobertura,
        completado: resultado.estado.completadoEn != null,
        segundosVistos: resultado.estado.segundosVistos,
      };
    },
    {
      params: t.Object({ id: t.String(), archivoId: t.String() }),
      body: t.Object({ desde: t.Number({ minimum: 0 }), hasta: t.Number({ minimum: 0 }) }),
      response: {
        200: t.Object({ cobertura: t.Number(), completado: t.Boolean(), segundosVistos: t.Number() }),
        400: esquemaError,
        404: esquemaError,
      },
    },
  )
  // El propio, por archivo (PROMPT-F6.8, Parte 3).
  .get(
    "/:id/progreso",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const instruccion = await cliente.instruccion.findFirst({ where: { id: params.id } });
      if (!instruccion) {
        set.status = 404;
        return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
      }

      if (!esAdmin(contexto.rol)) {
        const usuarioActual = await cliente.usuario.findFirst({
          where: { id: contexto.usuarioId! },
          select: { cargoId: true },
        });
        if (!instruccionVisiblePara(instruccion, usuarioActual?.cargoId ?? null)) {
          set.status = 404;
          return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
        }
      }

      const videos = await cliente.instruccionArchivo.findMany({
        where: { instruccionId: params.id, tipo: "VIDEO" },
        select: { id: true, duracionSegundos: true },
      });
      const visualizaciones = await cliente.instruccionVisualizacion.findMany({
        where: { usuarioId: contexto.usuarioId!, archivoId: { in: videos.map((v) => v.id) } },
        select: { archivoId: true, segundosVistos: true, completadoEn: true },
      });
      const porArchivo = new Map(visualizaciones.map((v) => [v.archivoId, v]));

      return {
        progreso: videos.map((video) => {
          const visualizacion = porArchivo.get(video.id);
          const segundosVistos = visualizacion?.segundosVistos ?? 0;
          const cobertura =
            video.duracionSegundos && video.duracionSegundos > 0 ? Math.min(1, segundosVistos / video.duracionSegundos) : 0;
          return {
            archivoId: video.id,
            duracionSegundos: video.duracionSegundos,
            segundosVistos,
            cobertura,
            completado: visualizacion?.completadoEn != null,
          };
        }),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ progreso: t.Array(esquemaProgresoArchivo) }), 404: esquemaError },
    },
  )
  .use(requiereRol(Rol.ADMIN))
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const semanaInicio = semanaInicioDeQuery(body.semana);
      try {
        const instruccion = await cliente.instruccion.create({
          data: datosSinEmpresa<Prisma.InstruccionUncheckedCreateInput>({
            titulo: body.titulo,
            descripcion: body.descripcion ?? null,
            semanaInicio,
            cargoId: body.cargoId ?? null,
            creadaPorId: contexto.usuarioId!,
          }),
          include: INCLUYE_ARCHIVOS,
        });
        set.status = 201;
        return { instruccion: respuestaInstruccion(instruccion) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
          set.status = 400;
          return { error: { codigo: "CARGO_INVALIDO", mensaje: "El cargo indicado no existe en esta empresa." } };
        }
        throw error;
      }
    },
    {
      body: t.Object({
        titulo: t.String({ minLength: 1 }),
        descripcion: t.Optional(t.Union([t.String(), t.Null()])),
        semana: t.String(),
        cargoId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
      response: { 201: t.Object({ instruccion: esquemaInstruccion }), 400: esquemaError },
    },
  )
  .patch(
    "/:id",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const instruccion = await cliente.instruccion.update({
          where: { id: params.id },
          data: {
            ...(body.titulo !== undefined ? { titulo: body.titulo } : {}),
            ...(body.descripcion !== undefined ? { descripcion: body.descripcion } : {}),
            ...(body.semana !== undefined ? { semanaInicio: semanaInicioDeQuery(body.semana) } : {}),
            ...(body.cargoId !== undefined ? { cargoId: body.cargoId } : {}),
          },
          include: INCLUYE_ARCHIVOS,
        });
        return { instruccion: respuestaInstruccion(instruccion) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
          set.status = 400;
          return { error: { codigo: "CARGO_INVALIDO", mensaje: "El cargo indicado no existe en esta empresa." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        titulo: t.Optional(t.String({ minLength: 1 })),
        descripcion: t.Optional(t.Union([t.String(), t.Null()])),
        semana: t.Optional(t.String()),
        cargoId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
      response: { 200: t.Object({ instruccion: esquemaInstruccion }), 400: esquemaError, 404: esquemaError },
    },
  )
  .patch(
    "/:id/publicar",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const instruccion = await cliente.instruccion.update({
          where: { id: params.id },
          data: { publicada: true },
          include: INCLUYE_ARCHIVOS,
        });
        return { instruccion: respuestaInstruccion(instruccion) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ instruccion: esquemaInstruccion }), 404: esquemaError },
    },
  )
  .patch(
    "/:id/despublicar",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const instruccion = await cliente.instruccion.update({
          where: { id: params.id },
          data: { publicada: false },
          include: INCLUYE_ARCHIVOS,
        });
        return { instruccion: respuestaInstruccion(instruccion) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ instruccion: esquemaInstruccion }), 404: esquemaError },
    },
  )
  // Solo si no está publicada: una publicada la vio gente, se despublica, no
  // se borra (PROMPT-F6.7, Parte 3). Borra primero en la base — nunca deja
  // una fila de InstruccionArchivo apuntando a un objeto ya borrado de S3 —
  // y solo después limpia los objetos en S3; si esa limpieza falla, queda
  // basura en el bucket (privado, sin costo de exposición) en vez de una
  // fila rota en la base.
  .delete(
    "/:id",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const instruccion = await cliente.instruccion.findFirst({
        where: { id: params.id },
        include: INCLUYE_ARCHIVOS,
      });
      if (!instruccion) {
        set.status = 404;
        return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
      }
      if (instruccion.publicada) {
        set.status = 409;
        return {
          error: {
            codigo: "INSTRUCCION_PUBLICADA",
            mensaje: "Una instrucción publicada no se borra: despublícala primero.",
          },
        };
      }

      await cliente.$transaction(async (tx) => {
        await tx.instruccionCumplimiento.deleteMany({ where: { instruccionId: params.id } });
        // Antes de los archivos: una visualización (F6.8) referencia su
        // archivoId y Postgres rechaza el borrado de un archivo con filas
        // que todavía lo referencian.
        await tx.instruccionVisualizacion.deleteMany({
          where: { archivo: { instruccionId: params.id } },
        });
        await tx.instruccionArchivo.deleteMany({ where: { instruccionId: params.id } });
        await tx.instruccion.delete({ where: { id: params.id } });
      });

      await Promise.allSettled(instruccion.archivos.map((archivo) => eliminarObjeto(archivo.clave)));

      return { ok: true as const };
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ ok: t.Literal(true) }), 404: esquemaError, 409: esquemaError },
    },
  )
  // Primer paso de la subida: valida tipo y tamaño, GENERA LA CLAVE (nunca
  // el cliente) y firma un PUT de vida corta. El navegador sube directo a
  // S3 con esa URL; el API no recibe el archivo (PROMPT-F6.7, Parte 1).
  .post(
    "/:id/archivos/url-subida",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const instruccion = await cliente.instruccion.findFirst({ where: { id: params.id } });
      if (!instruccion) {
        set.status = 404;
        return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
      }

      if (!esContentTypePermitido(body.contentType)) {
        set.status = 400;
        return {
          error: { codigo: "TIPO_NO_PERMITIDO", mensaje: `El tipo "${body.contentType}" no está permitido.` },
        };
      }

      if (body.bytes > tamanoMaximoBytes()) {
        set.status = 400;
        return {
          error: {
            codigo: "ARCHIVO_DEMASIADO_GRANDE",
            mensaje: `El archivo supera el tamaño máximo permitido (${tamanoMaximoBytes()} bytes).`,
          },
        };
      }

      const clave = generarClaveArchivo(contexto.empresaId!, params.id, body.contentType);
      const url = await urlSubidaPrefirmada(clave, body.contentType, body.bytes);
      return { url, clave };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ nombre: t.String({ minLength: 1 }), contentType: t.String(), bytes: t.Integer({ minimum: 1 }) }),
      response: { 200: t.Object({ url: t.String(), clave: t.String() }), 400: esquemaError, 404: esquemaError },
    },
  )
  // Segundo paso: registra el archivo YA subido. Verifica contra S3 que el
  // objeto existe antes de crear la fila — si la subida falló a mitad, no
  // debe quedar una fila que apunta a nada (PROMPT-F6.7, Parte 1). `bytes`
  // se guarda del tamaño real que reporta S3, nunca de lo que diga el
  // cliente.
  .post(
    "/:id/archivos",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const instruccion = await cliente.instruccion.findFirst({ where: { id: params.id } });
      if (!instruccion) {
        set.status = 404;
        return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
      }

      if (!esContentTypePermitido(body.contentType)) {
        set.status = 400;
        return {
          error: { codigo: "TIPO_NO_PERMITIDO", mensaje: `El tipo "${body.contentType}" no está permitido.` },
        };
      }

      const prefijoEsperado = `empresas/${contexto.empresaId}/instrucciones/${params.id}/`;
      if (!body.clave.startsWith(prefijoEsperado)) {
        set.status = 400;
        return { error: { codigo: "CLAVE_INVALIDA", mensaje: "La clave no corresponde a esta instrucción." } };
      }

      const bytesReales = await tamanoDeObjeto(body.clave);
      if (bytesReales === null) {
        set.status = 400;
        return {
          error: {
            codigo: "ARCHIVO_NO_ENCONTRADO_EN_S3",
            mensaje: "No se encontró el objeto subido. Vuelve a intentar la subida.",
          },
        };
      }

      const siguienteOrden = (await cliente.instruccionArchivo.count({ where: { instruccionId: params.id } })) + 1;

      const archivo = await cliente.instruccionArchivo.create({
        data: datosSinEmpresa<Prisma.InstruccionArchivoUncheckedCreateInput>({
          instruccionId: params.id,
          tipo: tipoArchivoDeContentType(body.contentType),
          clave: body.clave,
          nombre: body.nombre,
          contentType: body.contentType,
          bytes: bytesReales,
          duracionSegundos: body.duracionSegundos ?? null,
          orden: siguienteOrden,
          subidoPorId: contexto.usuarioId!,
        }),
      });

      set.status = 201;
      return { archivo: respuestaArchivo(archivo) };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        clave: t.String({ minLength: 1 }),
        nombre: t.String({ minLength: 1 }),
        contentType: t.String(),
        duracionSegundos: t.Optional(t.Integer({ minimum: 0 })),
      }),
      response: { 201: t.Object({ archivo: esquemaArchivo }), 400: esquemaError, 404: esquemaError },
    },
  )
  // Borra primero la fila, después el objeto en S3 — mismo orden que DELETE
  // /:id, por la misma razón: nunca deja una fila apuntando a nada.
  .delete(
    "/:id/archivos/:archivoId",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const archivo = await cliente.instruccionArchivo.findFirst({
        where: { id: params.archivoId, instruccionId: params.id },
      });
      if (!archivo) {
        set.status = 404;
        return { error: { codigo: "ARCHIVO_NO_ENCONTRADO", mensaje: "El archivo no existe." } };
      }

      // Igual que en DELETE /:id: una visualización (F6.8) referencia este
      // archivo y debe irse primero.
      await cliente.instruccionVisualizacion.deleteMany({ where: { archivoId: archivo.id } });
      await cliente.instruccionArchivo.delete({ where: { id: archivo.id } });
      await eliminarObjeto(archivo.clave);

      return { ok: true as const };
    },
    {
      params: t.Object({ id: t.String(), archivoId: t.String() }),
      response: { 200: t.Object({ ok: t.Literal(true) }), 404: esquemaError },
    },
  )
  // Quién cumplió y quién no, entre los empleados activos a los que aplica
  // esta instrucción (mismo cargoId, o cualquiera si cargoId es nulo).
  .get(
    "/:id/cumplimiento",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const instruccion = await cliente.instruccion.findFirst({ where: { id: params.id } });
      if (!instruccion) {
        set.status = 404;
        return { error: { codigo: "INSTRUCCION_NO_ENCONTRADA", mensaje: "La instrucción no existe." } };
      }

      const empleados = await cliente.usuario.findMany({
        where: { activo: true, rol: Rol.EMPLEADO },
        select: { id: true, nombre: true, cargoId: true },
        orderBy: { nombre: "asc" },
      });
      const aplican = empleados.filter((e) => aplicaACargo(instruccion.cargoId, e.cargoId));

      const cumplimientos = await cliente.instruccionCumplimiento.findMany({
        where: { instruccionId: params.id },
        select: { usuarioId: true, completadoEn: true },
      });
      const completadoEnPorUsuario = new Map(cumplimientos.map((c) => [c.usuarioId, c.completadoEn]));

      // Por video (PROMPT-F6.8, Parte 3): lo que le deja ver al ADMIN quién
      // va a medias, no solo quién terminó.
      const videos = await cliente.instruccionArchivo.findMany({
        where: { instruccionId: params.id, tipo: "VIDEO" },
        select: { id: true, nombre: true, duracionSegundos: true },
        orderBy: { orden: "asc" },
      });
      const visualizaciones = await cliente.instruccionVisualizacion.findMany({
        where: { archivoId: { in: videos.map((v) => v.id) } },
        select: { archivoId: true, usuarioId: true, segundosVistos: true, completadoEn: true },
      });
      const visualizacionPorClave = new Map(visualizaciones.map((v) => [`${v.archivoId}:${v.usuarioId}`, v]));

      return {
        cumplimiento: aplican.map((e) => ({
          id: e.id,
          nombre: e.nombre,
          cumplio: completadoEnPorUsuario.has(e.id),
          completadoEn: completadoEnPorUsuario.get(e.id)?.toISOString() ?? null,
          videos: videos.map((video) => {
            const visualizacion = visualizacionPorClave.get(`${video.id}:${e.id}`);
            const segundosVistos = visualizacion?.segundosVistos ?? 0;
            const cobertura =
              video.duracionSegundos && video.duracionSegundos > 0 ? Math.min(1, segundosVistos / video.duracionSegundos) : 0;
            return { archivoId: video.id, cobertura, completado: visualizacion?.completadoEn != null };
          }),
        })),
        videos: videos.map((v) => ({ id: v.id, nombre: v.nombre, duracionSegundos: v.duracionSegundos })),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ cumplimiento: t.Array(esquemaCumplimientoFila), videos: t.Array(esquemaVideoResumen) }),
        404: esquemaError,
      },
    },
  );
