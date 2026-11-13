import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { bloquearUsuarioParaTurno } from "../lib/bloqueo-usuario.ts";
import { buscarTurnoSolapado } from "../lib/turnos.ts";
import { buscarHoraAdicionalSolapada, clasificarHorasPorDia, validarRangoHoraAdicional } from "../lib/horas-adicionales.ts";
import { finDeFechaBogota, inicioDeFechaBogota } from "../lib/periodos.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaEstado = t.Union([t.Literal("PENDIENTE"), t.Literal("APROBADA"), t.Literal("RECHAZADA")]);

const esquemaHoraAdicional = t.Object({
  id: t.String(),
  usuarioId: t.String(),
  usuario: t.Object({ id: t.String(), nombre: t.String() }),
  inicio: t.String(),
  fin: t.String(),
  motivo: t.Union([t.String(), t.Null()]),
  estado: esquemaEstado,
  revisadaPorId: t.Union([t.String(), t.Null()]),
  revisadaPor: t.Union([t.Object({ id: t.String(), nombre: t.String() }), t.Null()]),
  revisadaEn: t.Union([t.String(), t.Null()]),
});

interface FilaHoraAdicional {
  id: string;
  usuarioId: string;
  usuario: { id: string; nombre: string };
  inicio: Date;
  fin: Date;
  motivo: string | null;
  estado: "PENDIENTE" | "APROBADA" | "RECHAZADA";
  revisadaPorId: string | null;
  revisadaPor: { id: string; nombre: string } | null;
  revisadaEn: Date | null;
}

const respuestaHoraAdicional = (fila: FilaHoraAdicional) => ({
  id: fila.id,
  usuarioId: fila.usuarioId,
  usuario: fila.usuario,
  inicio: fila.inicio.toISOString(),
  fin: fila.fin.toISOString(),
  motivo: fila.motivo,
  estado: fila.estado,
  revisadaPorId: fila.revisadaPorId,
  revisadaPor: fila.revisadaPor,
  revisadaEn: fila.revisadaEn ? fila.revisadaEn.toISOString() : null,
});

const INCLUYE_USUARIO = {
  usuario: { select: { id: true, nombre: true } },
  revisadaPor: { select: { id: true, nombre: true } },
} as const;

const cuerpoHoraAdicional = t.Object({
  usuarioId: t.Optional(t.String()),
  inicio: t.String({ format: "date-time" }),
  fin: t.String({ format: "date-time" }),
  motivo: t.Optional(t.Union([t.String(), t.Null()])),
});

const cuerpoHoraAdicionalParcial = t.Object({
  inicio: t.Optional(t.String({ format: "date-time" })),
  fin: t.Optional(t.String({ format: "date-time" })),
  motivo: t.Optional(t.Union([t.String(), t.Null()])),
});

function respuestaSolapaConTurno(turno: { id: string; inicio: Date; fin: Date }) {
  return {
    error: {
      codigo: "SOLAPA_CON_TURNO",
      mensaje:
        `Este bloque se solapa con el turno del ${turno.inicio.toISOString()} ` +
        `al ${turno.fin.toISOString()} (id ${turno.id}). Si estabas de turno, esas horas no son adicionales.`,
    },
  };
}

function respuestaSolapaConHoraAdicional(hora: { id: string; inicio: Date; fin: Date }) {
  return {
    error: {
      codigo: "SOLAPA_CON_HORA_ADICIONAL",
      mensaje:
        `Este bloque se solapa con otra hora adicional del ${hora.inicio.toISOString()} ` +
        `al ${hora.fin.toISOString()} (id ${hora.id}).`,
    },
  };
}

function respuestaValidacion(validacion: { valido: false; codigo: string; mensaje: string }) {
  return { error: { codigo: validacion.codigo, mensaje: validacion.mensaje } };
}

function esAdminContexto(rol: Rol | null | undefined): boolean {
  return rol === Rol.ADMIN || rol === Rol.SUPER_ADMIN;
}

// Prefijo /horas-adicionales. EMPLEADO en adelante (CLAUDE.md F6.3): un
// VENDEDOR es un revendedor externo con saldo prepago, no tiene turno
// laboral ni horas que registrar. ES UN REGISTRO, NO UNA NÓMINA: no calcula
// recargo legal ni clasifica jornada nocturna — solo cuántas horas y si el
// día es festivo o domingo (lib/horas-adicionales.ts). Las horas de aquí NO
// entran en el denominador del pozo de comisiones (ver comentario del
// modelo en prisma/schema.prisma) — no las sumes ahí.
export const horasAdicionales = new Elysia({ prefix: "/horas-adicionales" })
  .use(requiereRol(Rol.EMPLEADO))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: {
          codigo: "SIN_EMPRESA_ACTIVA",
          mensaje: "Selecciona una empresa antes de consultar las horas adicionales.",
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

      // Mismo patrón que GET /turnos (F6.2): un EMPLEADO queda forzado a
      // sus propias horas, sin que ningún parámetro de la petición pueda
      // ampliar eso.
      const esAdmin = esAdminContexto(contexto.rol);
      const usuarioId = esAdmin ? query.usuarioId : contexto.usuarioId!;

      const filas = await cliente.horaAdicional.findMany({
        where: {
          inicio: { lt: hasta },
          fin: { gt: desde },
          ...(usuarioId ? { usuarioId } : {}),
          ...(query.estado ? { estado: query.estado } : {}),
        },
        include: INCLUYE_USUARIO,
        orderBy: { inicio: "asc" },
      });
      return { horasAdicionales: filas.map(respuestaHoraAdicional) };
    },
    {
      query: t.Object({
        desde: t.String(),
        hasta: t.String(),
        usuarioId: t.Optional(t.String()),
        estado: t.Optional(esquemaEstado),
      }),
      response: { 200: t.Object({ horasAdicionales: t.Array(esquemaHoraAdicional) }) },
    },
  )
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const inicio = new Date(body.inicio);
      const fin = new Date(body.fin);

      const validacion = validarRangoHoraAdicional(inicio, fin);
      if (!validacion.valido) {
        set.status = 400;
        return respuestaValidacion(validacion);
      }

      // Un ADMIN puede registrar para cualquiera de su empresa; los demás
      // roles, solo para sí mismos — el usuarioId del body no amplía eso.
      const esAdmin = esAdminContexto(contexto.rol);
      const usuarioId = esAdmin ? body.usuarioId ?? contexto.usuarioId! : contexto.usuarioId!;

      const cliente = prismaParaEmpresa(contexto.empresaId);
      const resultado = await cliente.$transaction(async (tx) => {
        const usuarioBloqueado = await bloquearUsuarioParaTurno(tx, contexto.empresaId!, usuarioId);
        if (!usuarioBloqueado) return { tipo: "usuario_no_encontrado" as const };

        const turnoSolapado = await buscarTurnoSolapado(tx, usuarioId, inicio, fin);
        if (turnoSolapado) return { tipo: "solapa_turno" as const, turno: turnoSolapado };

        const horaSolapada = await buscarHoraAdicionalSolapada(tx, usuarioId, inicio, fin);
        if (horaSolapada) return { tipo: "solapa_hora" as const, hora: horaSolapada };

        const hora = await tx.horaAdicional.create({
          data: datosSinEmpresa<Prisma.HoraAdicionalUncheckedCreateInput>({
            usuarioId,
            inicio,
            fin,
            motivo: body.motivo ?? null,
          }),
          include: INCLUYE_USUARIO,
        });
        return { tipo: "ok" as const, hora };
      });

      if (resultado.tipo === "usuario_no_encontrado") {
        set.status = 404;
        return { error: { codigo: "USUARIO_NO_ENCONTRADO", mensaje: "El usuario no existe en esta empresa." } };
      }
      if (resultado.tipo === "solapa_turno") {
        set.status = 409;
        return respuestaSolapaConTurno(resultado.turno);
      }
      if (resultado.tipo === "solapa_hora") {
        set.status = 409;
        return respuestaSolapaConHoraAdicional(resultado.hora);
      }

      set.status = 201;
      return { horaAdicional: respuestaHoraAdicional(resultado.hora) };
    },
    {
      body: cuerpoHoraAdicional,
      response: {
        201: t.Object({ horaAdicional: esquemaHoraAdicional }),
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
      const existente = await cliente.horaAdicional.findUnique({ where: { id: params.id } });

      // No distinguir "no existe" de "existe pero es de otro usuario": un
      // EMPLEADO no debe poder confirmar, por el código de error, que una
      // hora ajena existe.
      const esAdmin = esAdminContexto(contexto.rol);
      if (!existente || (!esAdmin && existente.usuarioId !== contexto.usuarioId)) {
        set.status = 404;
        return { error: { codigo: "HORA_ADICIONAL_NO_ENCONTRADA", mensaje: "La hora adicional no existe." } };
      }
      if (existente.estado !== "PENDIENTE") {
        set.status = 409;
        return {
          error: {
            codigo: "HORA_ADICIONAL_NO_PENDIENTE",
            mensaje: "Solo se puede editar mientras está pendiente de revisión.",
          },
        };
      }

      const inicio = body.inicio ? new Date(body.inicio) : existente.inicio;
      const fin = body.fin ? new Date(body.fin) : existente.fin;
      const motivo = body.motivo !== undefined ? body.motivo : existente.motivo;

      const validacion = validarRangoHoraAdicional(inicio, fin);
      if (!validacion.valido) {
        set.status = 400;
        return respuestaValidacion(validacion);
      }

      const usuarioId = existente.usuarioId;
      const resultado = await cliente.$transaction(async (tx) => {
        const usuarioBloqueado = await bloquearUsuarioParaTurno(tx, contexto.empresaId!, usuarioId);
        if (!usuarioBloqueado) return { tipo: "usuario_no_encontrado" as const };

        const turnoSolapado = await buscarTurnoSolapado(tx, usuarioId, inicio, fin);
        if (turnoSolapado) return { tipo: "solapa_turno" as const, turno: turnoSolapado };

        const horaSolapada = await buscarHoraAdicionalSolapada(tx, usuarioId, inicio, fin, params.id);
        if (horaSolapada) return { tipo: "solapa_hora" as const, hora: horaSolapada };

        const hora = await tx.horaAdicional.update({
          where: { id: params.id },
          data: { inicio, fin, motivo },
          include: INCLUYE_USUARIO,
        });
        return { tipo: "ok" as const, hora };
      });

      if (resultado.tipo === "usuario_no_encontrado") {
        set.status = 404;
        return { error: { codigo: "USUARIO_NO_ENCONTRADO", mensaje: "El usuario no existe en esta empresa." } };
      }
      if (resultado.tipo === "solapa_turno") {
        set.status = 409;
        return respuestaSolapaConTurno(resultado.turno);
      }
      if (resultado.tipo === "solapa_hora") {
        set.status = 409;
        return respuestaSolapaConHoraAdicional(resultado.hora);
      }

      return { horaAdicional: respuestaHoraAdicional(resultado.hora) };
    },
    {
      params: t.Object({ id: t.String() }),
      body: cuerpoHoraAdicionalParcial,
      response: {
        200: t.Object({ horaAdicional: esquemaHoraAdicional }),
        400: esquemaError,
        404: esquemaError,
        409: esquemaError,
      },
    },
  )
  .delete(
    "/:id",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const existente = await cliente.horaAdicional.findUnique({ where: { id: params.id } });

      const esAdmin = esAdminContexto(contexto.rol);
      if (!existente || (!esAdmin && existente.usuarioId !== contexto.usuarioId)) {
        set.status = 404;
        return { error: { codigo: "HORA_ADICIONAL_NO_ENCONTRADA", mensaje: "La hora adicional no existe." } };
      }
      if (existente.estado !== "PENDIENTE") {
        set.status = 409;
        return {
          error: {
            codigo: "HORA_ADICIONAL_NO_PENDIENTE",
            mensaje: "Solo se puede borrar mientras está pendiente de revisión.",
          },
        };
      }

      await cliente.horaAdicional.delete({ where: { id: params.id } });
      return { ok: true as const };
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ ok: t.Literal(true) }), 404: esquemaError, 409: esquemaError },
    },
  )
  .use(requiereRol(Rol.ADMIN))
  .patch(
    "/:id/aprobar",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const existente = await cliente.horaAdicional.findUnique({ where: { id: params.id } });
      if (!existente) {
        set.status = 404;
        return { error: { codigo: "HORA_ADICIONAL_NO_ENCONTRADA", mensaje: "La hora adicional no existe." } };
      }
      if (existente.estado !== "PENDIENTE") {
        set.status = 409;
        return {
          error: { codigo: "HORA_ADICIONAL_NO_PENDIENTE", mensaje: "Esta hora adicional ya fue revisada." },
        };
      }

      const hora = await cliente.horaAdicional.update({
        where: { id: params.id },
        data: { estado: "APROBADA", revisadaPorId: contexto.usuarioId, revisadaEn: new Date() },
        include: INCLUYE_USUARIO,
      });
      return { horaAdicional: respuestaHoraAdicional(hora) };
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ horaAdicional: esquemaHoraAdicional }), 404: esquemaError, 409: esquemaError },
    },
  )
  .patch(
    "/:id/rechazar",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const existente = await cliente.horaAdicional.findUnique({ where: { id: params.id } });
      if (!existente) {
        set.status = 404;
        return { error: { codigo: "HORA_ADICIONAL_NO_ENCONTRADA", mensaje: "La hora adicional no existe." } };
      }
      if (existente.estado !== "PENDIENTE") {
        set.status = 409;
        return {
          error: { codigo: "HORA_ADICIONAL_NO_PENDIENTE", mensaje: "Esta hora adicional ya fue revisada." },
        };
      }

      const hora = await cliente.horaAdicional.update({
        where: { id: params.id },
        data: { estado: "RECHAZADA", revisadaPorId: contexto.usuarioId, revisadaEn: new Date() },
        include: INCLUYE_USUARIO,
      });
      return { horaAdicional: respuestaHoraAdicional(hora) };
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ horaAdicional: esquemaHoraAdicional }), 404: esquemaError, 409: esquemaError },
    },
  )
  // Resumen por persona, solo ADMIN (igual que GET /turnos/horas): contando
  // únicamente APROBADA, más el número de PENDIENTE para que el ADMIN sepa
  // qué le falta revisar (PROMPT-F6.3 parte 3).
  .get(
    "/resumen",
    async ({ query, contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const desde = inicioDeFechaBogota(query.desde);
      const hasta = finDeFechaBogota(query.hasta);

      const festivosEnRango = await cliente.festivo.findMany({
        where: { fecha: { gte: desde, lt: hasta } },
        select: { fecha: true },
      });
      const fechasFestivas = new Set(festivosEnRango.map((f) => f.fecha.getTime()));

      const aprobadas = await cliente.horaAdicional.findMany({
        where: { estado: "APROBADA", inicio: { lt: hasta }, fin: { gt: desde } },
        include: INCLUYE_USUARIO,
      });

      const pendientesPorUsuario = await cliente.horaAdicional.groupBy({
        by: ["usuarioId"],
        where: { estado: "PENDIENTE", inicio: { lt: hasta }, fin: { gt: desde } },
        _count: { _all: true },
      });
      const pendientesMapa = new Map(pendientesPorUsuario.map((fila) => [fila.usuarioId, fila._count._all]));

      const resumenPorUsuario = new Map<
        string,
        { usuarioId: string; usuario: { id: string; nombre: string }; ordinarias: number; dominicalesFestivas: number }
      >();
      for (const hora of aprobadas) {
        const inicioClip = hora.inicio < desde ? desde : hora.inicio;
        const finClip = hora.fin > hasta ? hasta : hora.fin;
        const { ordinarias, dominicalesFestivas } = clasificarHorasPorDia(inicioClip, finClip, fechasFestivas);

        const actual = resumenPorUsuario.get(hora.usuarioId) ?? {
          usuarioId: hora.usuarioId,
          usuario: hora.usuario,
          ordinarias: 0,
          dominicalesFestivas: 0,
        };
        actual.ordinarias += ordinarias;
        actual.dominicalesFestivas += dominicalesFestivas;
        resumenPorUsuario.set(hora.usuarioId, actual);
      }

      for (const [usuarioId, pendientes] of pendientesMapa) {
        if (!resumenPorUsuario.has(usuarioId)) {
          const usuario = (await cliente.usuario.findUnique({ where: { id: usuarioId } }))!;
          resumenPorUsuario.set(usuarioId, {
            usuarioId,
            usuario: { id: usuario.id, nombre: usuario.nombre },
            ordinarias: 0,
            dominicalesFestivas: 0,
          });
        }
      }

      return {
        resumen: [...resumenPorUsuario.values()].map((fila) => ({
          usuarioId: fila.usuarioId,
          usuario: fila.usuario,
          ordinarias: Math.round(fila.ordinarias * 100) / 100,
          dominicalesFestivas: Math.round(fila.dominicalesFestivas * 100) / 100,
          pendientes: pendientesMapa.get(fila.usuarioId) ?? 0,
        })),
      };
    },
    {
      query: t.Object({ desde: t.String(), hasta: t.String() }),
      response: {
        200: t.Object({
          resumen: t.Array(
            t.Object({
              usuarioId: t.String(),
              usuario: t.Object({ id: t.String(), nombre: t.String() }),
              ordinarias: t.Number(),
              dominicalesFestivas: t.Number(),
              pendientes: t.Number(),
            }),
          ),
        }),
      },
    },
  );
