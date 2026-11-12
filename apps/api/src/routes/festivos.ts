import { Elysia, t } from "elysia";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { restriccionViolada } from "../lib/errores.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { festivosColombia } from "../lib/festivos.ts";
import { inicioDeFechaBogota } from "../lib/periodos.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaFestivo = t.Object({
  id: t.String(),
  fecha: t.String(),
  nombre: t.String(),
  generado: t.Boolean(),
});

interface FilaFestivo {
  id: string;
  fecha: Date;
  nombre: string;
  generado: boolean;
}

const respuestaFestivo = (fila: FilaFestivo) => ({
  id: fila.id,
  fecha: fila.fecha.toISOString(),
  nombre: fila.nombre,
  generado: fila.generado,
});

// Prefijo /festivos. GET es de cualquier rol autenticado (el calendario los
// pinta para todos); generar/crear/borrar a mano es ADMIN (CLAUDE.md F6.2).
export const festivos = new Elysia({ prefix: "/festivos" })
  .use(requiereRol(Rol.VENDEDOR))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: {
          codigo: "SIN_EMPRESA_ACTIVA",
          mensaje: "Selecciona una empresa antes de consultar los festivos.",
        },
      };
    }
  })
  .get(
    "/",
    async ({ query, contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const anio = Number(query.anio);
      const filas = await cliente.festivo.findMany({
        where: {
          fecha: { gte: inicioDeFechaBogota(`${anio}-01-01`), lt: inicioDeFechaBogota(`${anio + 1}-01-01`) },
        },
        orderBy: { fecha: "asc" },
      });
      return { festivos: filas.map(respuestaFestivo) };
    },
    {
      query: t.Object({ anio: t.String() }),
      response: { 200: t.Object({ festivos: t.Array(esquemaFestivo) }) },
    },
  )
  .use(requiereRol(Rol.ADMIN))
  // Idempotente: no duplica los festivos que ya existan para ese año (los
  // detecta por fecha, vía P2002 del @@unique([empresaId, fecha])) y nunca
  // pisa uno con generado:false — esos los creó o corrigió un ADMIN a mano
  // (CLAUDE.md F6.2, 2.3).
  .post(
    "/generar",
    async ({ body, contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const calculados = festivosColombia(body.anio);

      const existentes = await cliente.festivo.findMany({
        where: {
          fecha: {
            gte: inicioDeFechaBogota(`${body.anio}-01-01`),
            lt: inicioDeFechaBogota(`${body.anio + 1}-01-01`),
          },
        },
        select: { fecha: true, generado: true },
      });
      const fechasExistentes = new Set(existentes.map((f) => f.fecha.getTime()));

      let creados = 0;
      for (const festivo of calculados) {
        if (fechasExistentes.has(festivo.fecha.getTime())) continue;
        try {
          await cliente.festivo.create({
            data: datosSinEmpresa<Prisma.FestivoUncheckedCreateInput>({
              fecha: festivo.fecha,
              nombre: festivo.nombre,
              generado: true,
            }),
          });
          creados++;
        } catch (error) {
          // Caso habitual: dos festivos DISTINTOS cayendo el mismo día dentro
          // de esta misma corrida. En 2025, el traslado Emiliani deja San
          // Pedro y San Pablo y Sagrado Corazón de Jesús ambos en el lunes 30
          // de junio — festivosColombia(2025) calcula los dos, pero
          // @@unique([empresaId, fecha]) solo admite una fila por fecha. El
          // comportamiento deseado es justamente ese: para un calendario un
          // día no laboral es un día no laboral, no hacen falta los dos
          // nombres, así que la segunda inserción se descarta sin reintentar
          // (ver contarFechasUnicas() en festivos.test.ts, que documenta lo
          // mismo del lado de las pruebas).
          // Caso secundario: carrera entre dos llamadas simultáneas a
          // /generar, donde la otra ya insertó esa fecha entre el findMany y
          // este create. En ambos casos no es un festivo editado a mano (ese
          // se filtró arriba), así que se ignora igual.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            restriccionViolada(error);
            continue;
          }
          throw error;
        }
      }

      return { creados, total: calculados.length };
    },
    {
      body: t.Object({ anio: t.Number() }),
      response: { 200: t.Object({ creados: t.Number(), total: t.Number() }) },
    },
  )
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const festivo = await cliente.festivo.create({
          data: datosSinEmpresa<Prisma.FestivoUncheckedCreateInput>({
            fecha: inicioDeFechaBogota(body.fecha),
            nombre: body.nombre,
            generado: false,
          }),
        });
        set.status = 201;
        return { festivo: respuestaFestivo(festivo) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          set.status = 409;
          return { error: { codigo: "FESTIVO_EN_USO", mensaje: "Ya existe un festivo registrado en esa fecha." } };
        }
        throw error;
      }
    },
    {
      body: t.Object({ fecha: t.String(), nombre: t.String({ minLength: 1 }) }),
      response: { 201: t.Object({ festivo: esquemaFestivo }), 409: esquemaError },
    },
  )
  .delete(
    "/:id",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        await cliente.festivo.delete({ where: { id: params.id } });
        return { ok: true as const };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "FESTIVO_NO_ENCONTRADO", mensaje: "El festivo no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ ok: t.Literal(true) }), 404: esquemaError },
    },
  );
