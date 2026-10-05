import { Elysia, t } from "elysia";
import { Prisma, TipoPlantilla } from "../generated/prisma/client.ts";
import { DATOS_EJEMPLO } from "../lib/datos-ejemplo-mensaje.ts";
import { MARCADORES_POR_TIPO, validarMarcadores } from "../lib/marcadores-mensaje.ts";
import { renderizarMensajeDeVenta } from "../lib/mensaje-venta.ts";
import { PLANTILLA_PAQUETE_POR_DEFECTO, PLANTILLA_UNIDAD_POR_DEFECTO } from "../lib/plantillas-default.ts";
import type { prismaRaw } from "../lib/prisma.ts";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { Rol } from "../generated/prisma/client.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaTipo = t.Union([t.Literal("UNIDAD"), t.Literal("PAQUETE")]);

const esquemaPlantilla = t.Object({
  tipo: esquemaTipo,
  contenido: t.String(),
  actualizadaEn: t.String(),
});

const esquemaMarcadorInvalido = t.Object({
  marcador: t.String(),
  razon: t.Union([t.Literal("desconocido"), t.Literal("no_aplica")]),
});

const contenidoPorDefecto = (tipo: TipoPlantilla) =>
  tipo === "UNIDAD" ? PLANTILLA_UNIDAD_POR_DEFECTO : PLANTILLA_PAQUETE_POR_DEFECTO;

// PRD §5.9 — pantalla de edición de plantillas de mensaje. Solo ADMIN: la
// redacción del mensaje de venta es decisión de negocio de la empresa, no
// algo que un VENDEDOR deba poder tocar.
export const plantillas = new Elysia({ prefix: "/plantillas" })
  .use(requiereRol(Rol.ADMIN))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: {
          codigo: "SIN_EMPRESA_ACTIVA",
          mensaje: "Selecciona una empresa antes de gestionar sus plantillas de mensaje.",
        },
      };
    }
  })
  .get(
    "/",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const filas = await cliente.plantillaMensaje.findMany();
      const porTipo = new Map(filas.map((fila) => [fila.tipo, fila]));

      const plantillas = (["UNIDAD", "PAQUETE"] as const).map((tipo) => {
        const existente = porTipo.get(tipo);
        return {
          tipo,
          contenido: existente?.contenido ?? contenidoPorDefecto(tipo),
          actualizadaEn: (existente?.actualizadaEn ?? new Date(0)).toISOString(),
        };
      });

      return {
        plantillas,
        marcadoresPorTipo: {
          UNIDAD: [...MARCADORES_POR_TIPO.UNIDAD],
          PAQUETE: [...MARCADORES_POR_TIPO.PAQUETE],
        },
      };
    },
    {
      response: {
        200: t.Object({
          plantillas: t.Array(esquemaPlantilla),
          marcadoresPorTipo: t.Object({
            UNIDAD: t.Array(t.String()),
            PAQUETE: t.Array(t.String()),
          }),
        }),
      },
    },
  )
  .put(
    "/:tipo",
    async ({ params, body, contexto, set }) => {
      const tipo = params.tipo as TipoPlantilla;
      const invalidos = validarMarcadores(body.contenido, tipo);
      if (invalidos.length > 0) {
        set.status = 422;
        return {
          error: {
            codigo: "MARCADOR_INVALIDO",
            mensaje: `La plantilla usa marcadores que no se van a reemplazar: ${invalidos
              .map((m) => `{{${m.marcador}}}`)
              .join(", ")}.`,
          },
          marcadoresInvalidos: invalidos,
        };
      }

      const cliente = prismaParaEmpresa(contexto.empresaId);
      // R3: esto solo cambia la plantilla a futuro. Venta.mensajeGenerado de
      // ventas ya registradas es una copia independiente — nunca se toca.
      const plantilla = await guardarContenido(cliente, tipo, body.contenido);

      return {
        plantilla: {
          tipo: plantilla.tipo,
          contenido: plantilla.contenido,
          actualizadaEn: plantilla.actualizadaEn.toISOString(),
        },
      };
    },
    {
      params: t.Object({ tipo: esquemaTipo }),
      body: t.Object({ contenido: t.String({ minLength: 1 }) }),
      response: {
        200: t.Object({ plantilla: esquemaPlantilla }),
        422: t.Object({
          error: t.Object({ codigo: t.String(), mensaje: t.String() }),
          marcadoresInvalidos: t.Array(esquemaMarcadorInvalido),
        }),
      },
    },
  )
  // Vista previa en vivo: NO guarda nada. Renderiza con renderizarMensajeDeVenta
  // — la misma función que usa realizarVenta — sobre datos de ejemplo, así que
  // lo que el admin ve es exactamente lo que recibirá un cliente.
  .post(
    "/:tipo/vista-previa",
    ({ params, body }) => {
      const tipo = params.tipo as TipoPlantilla;
      return {
        mensaje: renderizarMensajeDeVenta(body.contenido, DATOS_EJEMPLO[tipo]),
        marcadoresInvalidos: validarMarcadores(body.contenido, tipo),
      };
    },
    {
      params: t.Object({ tipo: esquemaTipo }),
      body: t.Object({ contenido: t.String() }),
      response: {
        200: t.Object({ mensaje: t.String(), marcadoresInvalidos: t.Array(esquemaMarcadorInvalido) }),
      },
    },
  )
  .post(
    "/:tipo/restaurar",
    async ({ params, contexto }) => {
      const tipo = params.tipo as TipoPlantilla;
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const plantilla = await guardarContenido(cliente, tipo, contenidoPorDefecto(tipo));

      return {
        plantilla: {
          tipo: plantilla.tipo,
          contenido: plantilla.contenido,
          actualizadaEn: plantilla.actualizadaEn.toISOString(),
        },
      };
    },
    {
      params: t.Object({ tipo: esquemaTipo }),
      response: { 200: t.Object({ plantilla: esquemaPlantilla }) },
    },
  );

// prismaParaEmpresa es genérica (acepta también un `tx`); aquí siempre se usa
// sobre el cliente base, así que ese es el tipo del alias.
type ClienteEmpresa = typeof prismaRaw;

// Validar-antes-de-insertar es condición de carrera (dos PUT simultáneos al
// primer guardado de un tipo pasan ambos el findFirst y uno revienta contra
// @@unique([empresaId, tipo])). Se maneja el P2002 reintentando como update.
async function guardarContenido(cliente: ClienteEmpresa, tipo: TipoPlantilla, contenido: string) {
  const existente = await cliente.plantillaMensaje.findFirst({ where: { tipo } });
  if (existente) {
    return cliente.plantillaMensaje.update({ where: { id: existente.id }, data: { contenido } });
  }
  try {
    return await cliente.plantillaMensaje.create({
      data: datosSinEmpresa<Prisma.PlantillaMensajeUncheckedCreateInput>({ tipo, contenido }),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Única restricción única del modelo es (empresaId, tipo): no hace
      // falta inspeccionar restriccionViolada() para distinguir cuál — solo
      // puede ser esta. Otra petición ganó la carrera; se actualiza la suya.
      const creadaPorOtraPeticion = await cliente.plantillaMensaje.findFirstOrThrow({ where: { tipo } });
      return cliente.plantillaMensaje.update({
        where: { id: creadaPorOtraPeticion.id },
        data: { contenido },
      });
    }
    throw error;
  }
}
