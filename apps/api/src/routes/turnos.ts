import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { bloquearUsuarioParaTurno } from "../lib/bloqueo-usuario.ts";
import { buscarTurnoSolapado, horasRecortadasPorUsuario, validarRangoTurno } from "../lib/turnos.ts";
import { finDeFechaBogota, inicioDeFechaBogota } from "../lib/periodos.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaTurno = t.Object({
  id: t.String(),
  usuarioId: t.String(),
  usuario: t.Object({ id: t.String(), nombre: t.String() }),
  inicio: t.String(),
  fin: t.String(),
  notas: t.Union([t.String(), t.Null()]),
});

interface FilaTurno {
  id: string;
  usuarioId: string;
  usuario: { id: string; nombre: string };
  inicio: Date;
  fin: Date;
  notas: string | null;
}

const respuestaTurno = (fila: FilaTurno) => ({
  id: fila.id,
  usuarioId: fila.usuarioId,
  usuario: fila.usuario,
  inicio: fila.inicio.toISOString(),
  fin: fila.fin.toISOString(),
  notas: fila.notas,
});

const INCLUYE_USUARIO = { usuario: { select: { id: true, nombre: true } } } as const;

const cuerpoTurno = t.Object({
  usuarioId: t.String(),
  inicio: t.String({ format: "date-time" }),
  fin: t.String({ format: "date-time" }),
  notas: t.Optional(t.Union([t.String(), t.Null()])),
});

const cuerpoTurnoParcial = t.Object({
  usuarioId: t.Optional(t.String()),
  inicio: t.Optional(t.String({ format: "date-time" })),
  fin: t.Optional(t.String({ format: "date-time" })),
  notas: t.Optional(t.Union([t.String(), t.Null()])),
});

function respuestaSolapamiento(turno: { id: string; inicio: Date; fin: Date }) {
  return {
    error: {
      codigo: "TURNO_SOLAPADO",
      mensaje:
        `Este horario se solapa con el turno del ${turno.inicio.toISOString()} ` +
        `al ${turno.fin.toISOString()} (id ${turno.id}).`,
    },
  };
}

function respuestaValidacion(validacion: { valido: false; codigo: string; mensaje: string }) {
  return { error: { codigo: validacion.codigo, mensaje: validacion.mensaje } };
}

// Prefijo /turnos. ADMIN crea, edita y borra turnos de cualquiera; EMPLEADO
// ve los suyos, en solo lectura (CLAUDE.md R5/F6.2). El bloqueo de la fila
// de Usuario (bloqueo-usuario.ts) antes de comprobar solapamiento y
// crear/editar es lo que impide que dos peticiones simultáneas para el
// mismo usuario lean ambas "libre" y terminen con dos turnos que se pisan —
// esas horas son el denominador del reparto de comisiones.
//
// F6.3: el mínimo era Rol.VENDEDOR — error del documento de F6.2. Un
// VENDEDOR es un revendedor externo con saldo prepago, no tiene turno
// laboral; esto nunca debió quedar visible desde ahí.
export const turnos = new Elysia({ prefix: "/turnos" })
  .use(requiereRol(Rol.EMPLEADO))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: {
          codigo: "SIN_EMPRESA_ACTIVA",
          mensaje: "Selecciona una empresa antes de consultar el calendario.",
        },
      };
    }
  })
  .get(
    "/",
    async ({ query, contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const desde = inicioDeFechaBogota(query.desde);
      const hasta = finDeFechaBogota(query.hasta);

      // Esto no se resuelve en el frontend (CLAUDE.md F6.2): un EMPLEADO o
      // VENDEDOR siempre queda forzado a sus propios turnos, sin que ningún
      // parámetro de la petición pueda ampliar eso.
      const esAdmin = contexto.rol === Rol.ADMIN || contexto.rol === Rol.SUPER_ADMIN;
      const usuarioId = esAdmin ? query.usuarioId : contexto.usuarioId!;

      const filas = await cliente.turno.findMany({
        where: {
          inicio: { gte: desde, lt: hasta },
          ...(usuarioId ? { usuarioId } : {}),
        },
        include: INCLUYE_USUARIO,
        orderBy: { inicio: "asc" },
      });
      return { turnos: filas.map(respuestaTurno) };
    },
    {
      query: t.Object({ desde: t.String(), hasta: t.String(), usuarioId: t.Optional(t.String()) }),
      response: { 200: t.Object({ turnos: t.Array(esquemaTurno) }) },
    },
  )
  .use(requiereRol(Rol.ADMIN))
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const inicio = new Date(body.inicio);
      const fin = new Date(body.fin);

      const validacion = validarRangoTurno(inicio, fin);
      if (!validacion.valido) {
        set.status = 400;
        return respuestaValidacion(validacion);
      }

      const cliente = prismaParaEmpresa(contexto.empresaId);
      const resultado = await cliente.$transaction(async (tx) => {
        const usuarioBloqueado = await bloquearUsuarioParaTurno(tx, contexto.empresaId!, body.usuarioId);
        if (!usuarioBloqueado) return { tipo: "usuario_no_encontrado" as const };

        const solapado = await buscarTurnoSolapado(tx, body.usuarioId, inicio, fin);
        if (solapado) return { tipo: "solapado" as const, turno: solapado };

        const turno = await tx.turno.create({
          data: datosSinEmpresa<Prisma.TurnoUncheckedCreateInput>({
            usuarioId: body.usuarioId,
            inicio,
            fin,
            notas: body.notas ?? null,
          }),
          include: INCLUYE_USUARIO,
        });
        return { tipo: "ok" as const, turno };
      });

      if (resultado.tipo === "usuario_no_encontrado") {
        set.status = 404;
        return { error: { codigo: "USUARIO_NO_ENCONTRADO", mensaje: "El usuario no existe en esta empresa." } };
      }
      if (resultado.tipo === "solapado") {
        set.status = 409;
        return respuestaSolapamiento(resultado.turno);
      }

      set.status = 201;
      return { turno: respuestaTurno(resultado.turno) };
    },
    {
      body: cuerpoTurno,
      response: {
        201: t.Object({ turno: esquemaTurno }),
        400: esquemaError,
        404: esquemaError,
        409: esquemaError,
      },
    },
  )
  .patch(
    "/:id",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const existente = await cliente.turno.findUnique({ where: { id: params.id } });
      if (!existente) {
        set.status = 404;
        return { error: { codigo: "TURNO_NO_ENCONTRADO", mensaje: "El turno no existe." } };
      }

      const usuarioId = body.usuarioId ?? existente.usuarioId;
      const inicio = body.inicio ? new Date(body.inicio) : existente.inicio;
      const fin = body.fin ? new Date(body.fin) : existente.fin;
      const notas = body.notas !== undefined ? body.notas : existente.notas;

      const validacion = validarRangoTurno(inicio, fin);
      if (!validacion.valido) {
        set.status = 400;
        return respuestaValidacion(validacion);
      }

      const resultado = await cliente.$transaction(async (tx) => {
        const usuarioBloqueado = await bloquearUsuarioParaTurno(tx, contexto.empresaId!, usuarioId);
        if (!usuarioBloqueado) return { tipo: "usuario_no_encontrado" as const };

        const solapado = await buscarTurnoSolapado(tx, usuarioId, inicio, fin, params.id);
        if (solapado) return { tipo: "solapado" as const, turno: solapado };

        const turno = await tx.turno.update({
          where: { id: params.id },
          data: { usuarioId, inicio, fin, notas },
          include: INCLUYE_USUARIO,
        });
        return { tipo: "ok" as const, turno };
      });

      if (resultado.tipo === "usuario_no_encontrado") {
        set.status = 404;
        return { error: { codigo: "USUARIO_NO_ENCONTRADO", mensaje: "El usuario no existe en esta empresa." } };
      }
      if (resultado.tipo === "solapado") {
        set.status = 409;
        return respuestaSolapamiento(resultado.turno);
      }

      return { turno: respuestaTurno(resultado.turno) };
    },
    {
      params: t.Object({ id: t.String() }),
      body: cuerpoTurnoParcial,
      response: {
        200: t.Object({ turno: esquemaTurno }),
        400: esquemaError,
        404: esquemaError,
        409: esquemaError,
      },
    },
  )
  // Borra de verdad (a diferencia de ventas y cuentas, que nunca se
  // borran): un turno mal digitado es un error de captura, no historia del
  // negocio. Revisar esta decisión el día que existan comisiones liquidadas
  // sobre un turno (CLAUDE.md F6.2).
  .delete(
    "/:id",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        await cliente.turno.delete({ where: { id: params.id } });
        return { ok: true as const };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "TURNO_NO_ENCONTRADO", mensaje: "El turno no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ ok: t.Literal(true) }), 404: esquemaError },
    },
  )
  // Horas totales por usuario en el rango, recortadas a sus límites (ver
  // lib/turnos.ts) — es lo que van a consumir las comisiones (entrega
  // futura), de ahí el nivel ADMIN.
  .get(
    "/horas",
    async ({ query, contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const desde = inicioDeFechaBogota(query.desde);
      const hasta = finDeFechaBogota(query.hasta);

      const turnosEnRango = await cliente.turno.findMany({
        where: { inicio: { lt: hasta }, fin: { gt: desde } },
        select: { usuarioId: true, inicio: true, fin: true },
      });

      const horasPorUsuario = horasRecortadasPorUsuario(turnosEnRango, desde, hasta);
      return {
        horas: [...horasPorUsuario.entries()].map(([usuarioId, horas]) => ({
          usuarioId,
          horas: Math.round(horas * 100) / 100,
        })),
      };
    },
    {
      query: t.Object({ desde: t.String(), hasta: t.String() }),
      response: {
        200: t.Object({ horas: t.Array(t.Object({ usuarioId: t.String(), horas: t.Number() })) }),
      },
    },
  );
