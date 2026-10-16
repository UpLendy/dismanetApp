import { Elysia, t } from "elysia";
import { PIN_PATRON } from "@dismanet/shared";
import { cifrar, descifrar } from "../lib/cifrado.ts";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { restriccionViolada } from "../lib/errores.ts";
import { impactoDesactivarPlataforma } from "../lib/impacto-catalogo.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaPlataforma = t.Object({
  id: t.String(),
  nombre: t.String(),
  nombreMensaje: t.Union([t.String(), t.Null()]),
  condiciones: t.Union([t.String(), t.Null()]),
  capacidadPantallas: t.Number(),
  usaPerfilPin: t.Boolean(),
  usaCorreo: t.Boolean(),
  usaUsuario: t.Boolean(),
  usaCodigo: t.Boolean(),
  usaEnlace: t.Boolean(),
  activa: t.Boolean(),
});

const esquemaImpacto = t.Object({
  preciosActivos: t.Number(),
  paquetesAfectados: t.Array(t.Object({ id: t.String(), nombre: t.String() })),
});

interface FilaPlataforma {
  id: string;
  nombre: string;
  nombreMensaje: string | null;
  condiciones: string | null;
  capacidadPantallas: number;
  usaPerfilPin: boolean;
  usaCorreo: boolean;
  usaUsuario: boolean;
  usaCodigo: boolean;
  usaEnlace: boolean;
  activa: boolean;
}

const respuestaPlataforma = (fila: FilaPlataforma) => ({
  id: fila.id,
  nombre: fila.nombre,
  nombreMensaje: fila.nombreMensaje,
  condiciones: fila.condiciones,
  capacidadPantallas: fila.capacidadPantallas,
  usaPerfilPin: fila.usaPerfilPin,
  usaCorreo: fila.usaCorreo,
  usaUsuario: fila.usaUsuario,
  usaCodigo: fila.usaCodigo,
  usaEnlace: fila.usaEnlace,
  activa: fila.activa,
});

// capacidadPantallas no se acepta en el body de ninguno de los dos: es
// derivado, nunca digitado — lo fija PUT /:id/pantallas a partir del largo
// de la plantilla (pantallas.length). Aceptarlo aquí es exactamente el bug
// ya corregido una vez (CLAUDE.md, "arreglar el dato no es arreglar la
// fuente"): una plataforma nacía con capacidad declarada y cero plantilla.
//
// Los 4 campos de acceso (F4.2, parte 1) son opcionales en el body — a
// diferencia de usaPerfilPin, que ya era obligatorio antes de esta entrega y
// cuyos llamadores existentes siempre lo mandan. Si no vienen, create() usa
// el default de Prisma (usaCorreo=true, el resto false) y update() deja el
// valor existente intacto, para no romper llamadores que todavía no conocen
// estos campos.
const cuerpoPlataforma = t.Object({
  nombre: t.String({ minLength: 1 }),
  nombreMensaje: t.Optional(t.String()),
  condiciones: t.Optional(t.String()),
  usaPerfilPin: t.Boolean(),
  usaCorreo: t.Optional(t.Boolean()),
  usaUsuario: t.Optional(t.Boolean()),
  usaCodigo: t.Optional(t.Boolean()),
  usaEnlace: t.Optional(t.Boolean()),
});

// Plantilla de pantallas (Parte 5 del encargo "plantilla de pantallas"): el
// numero de cada fila es su posición en el arreglo (1-based), no un campo del
// body — así subir/bajar la cantidad es simplemente cambiar el largo del
// arreglo desde el frontend. perfil/pin se ignoran si la plataforma no usa
// usaPerfilPin, sin importar lo que llegue en el body (igual que la
// generación de Pantalla en cuentas.ts).
const esquemaPantallaPlantilla = t.Object({
  numero: t.Number(),
  perfil: t.Union([t.String(), t.Null()]),
  pin: t.Union([t.String(), t.Null()]),
});

const esquemaPlantilla = t.Object({
  capacidadPantallas: t.Number(),
  pantallas: t.Array(esquemaPantallaPlantilla),
  // Números de fila (1-based) cuyo pin terminó distinto del que venía en el
  // body, porque se igualó al de otra fila con el mismo perfil (F4.2, parte
  // 2.2: mismo perfil ⇒ mismo pin, nunca se rechaza, se propaga).
  filasConPinPropagado: t.Array(t.Number()),
});

const cuerpoPlantilla = t.Object({
  pantallas: t.Array(
    t.Object({
      perfil: t.Optional(t.Union([t.String(), t.Null()])),
      pin: t.Optional(t.Union([t.String({ pattern: PIN_PATRON }), t.Null()])),
    }),
  ),
});

// Catálogo — CRUD sin borrado (R3/Parte 6): las entidades de catálogo se
// desactivan, nunca se borran, porque hay ventas históricas que las
// referencian. No existe ningún endpoint DELETE aquí.
export const plataformas = new Elysia({ prefix: "/plataformas" })
  .use(requiereRol(Rol.ADMIN))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: {
          codigo: "SIN_EMPRESA_ACTIVA",
          mensaje: "Selecciona una empresa antes de gestionar su catálogo.",
        },
      };
    }
  })
  .get(
    "/",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const filas = await cliente.plataforma.findMany({ orderBy: { nombre: "asc" } });
      return { plataformas: filas.map(respuestaPlataforma) };
    },
    { response: { 200: t.Object({ plataformas: t.Array(esquemaPlataforma) }) } },
  )
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const plataforma = await cliente.plataforma.create({
          data: datosSinEmpresa<Prisma.PlataformaUncheckedCreateInput>({
            nombre: body.nombre,
            nombreMensaje: body.nombreMensaje ?? null,
            condiciones: body.condiciones ?? null,
            // Nace en 0: sin plantilla todavía, no hay pantalla que ofrecer.
            // PUT /:id/pantallas la deriva de pantallas.length en cuanto se
            // carga la plantilla.
            capacidadPantallas: 0,
            usaPerfilPin: body.usaPerfilPin,
            ...(body.usaCorreo !== undefined ? { usaCorreo: body.usaCorreo } : {}),
            ...(body.usaUsuario !== undefined ? { usaUsuario: body.usaUsuario } : {}),
            ...(body.usaCodigo !== undefined ? { usaCodigo: body.usaCodigo } : {}),
            ...(body.usaEnlace !== undefined ? { usaEnlace: body.usaEnlace } : {}),
          }),
        });
        set.status = 201;
        return { plataforma: respuestaPlataforma(plataforma) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: {
                codigo: "NOMBRE_EN_USO",
                mensaje: `Ya existe una plataforma activa llamada "${body.nombre}".`,
              },
            };
          }
        }
        throw error;
      }
    },
    {
      body: cuerpoPlataforma,
      response: { 201: t.Object({ plataforma: esquemaPlataforma }), 409: esquemaError },
    },
  )
  .patch(
    "/:id",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      try {
        const plataforma = await cliente.plataforma.update({
          where: { id: params.id },
          data: {
            nombre: body.nombre,
            nombreMensaje: body.nombreMensaje ?? null,
            condiciones: body.condiciones ?? null,
            // capacidadPantallas no se toca aquí: solo la deriva
            // PUT /:id/pantallas a partir de la plantilla.
            usaPerfilPin: body.usaPerfilPin,
            // Solo se sobrescriben si vienen en el body: un llamador que
            // todavía no conoce estos campos no debe apagarlos sin querer.
            ...(body.usaCorreo !== undefined ? { usaCorreo: body.usaCorreo } : {}),
            ...(body.usaUsuario !== undefined ? { usaUsuario: body.usaUsuario } : {}),
            ...(body.usaCodigo !== undefined ? { usaCodigo: body.usaCodigo } : {}),
            ...(body.usaEnlace !== undefined ? { usaEnlace: body.usaEnlace } : {}),
          },
        });
        return { plataforma: respuestaPlataforma(plataforma) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const objetivo = restriccionViolada(error);
          if (objetivo.includes("nombre")) {
            set.status = 409;
            return {
              error: {
                codigo: "NOMBRE_EN_USO",
                mensaje: `Ya existe una plataforma activa llamada "${body.nombre}".`,
              },
            };
          }
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: cuerpoPlataforma,
      response: { 200: t.Object({ plataforma: esquemaPlataforma }), 404: esquemaError, 409: esquemaError },
    },
  )
  .get(
    "/:id/impacto-desactivacion",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const plataforma = await cliente.plataforma.findUnique({ where: { id: params.id } });
      if (!plataforma) {
        set.status = 404;
        return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
      }
      return await impactoDesactivarPlataforma(cliente, params.id);
    },
    { params: t.Object({ id: t.String() }), response: { 200: esquemaImpacto, 404: esquemaError } },
  )
  .patch(
    "/:id/activar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const plataforma = await cliente.plataforma.update({ where: { id: params.id }, data: { activa: true } });
        return { plataforma: respuestaPlataforma(plataforma) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          set.status = 409;
          return {
            error: {
              codigo: "NOMBRE_EN_USO",
              mensaje: "Ya existe otra plataforma activa con este nombre. Cambia el nombre antes de reactivarla.",
            },
          };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ plataforma: esquemaPlataforma }), 404: esquemaError, 409: esquemaError },
    },
  )
  .patch(
    "/:id/desactivar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const plataforma = await cliente.plataforma.update({ where: { id: params.id }, data: { activa: false } });
        return { plataforma: respuestaPlataforma(plataforma) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ plataforma: esquemaPlataforma }), 404: esquemaError },
    },
  )
  // Plantilla de pantallas (Parte 1 y 5 del encargo "plantilla de
  // pantallas"): de aquí copia POST /cuentas cada Pantalla nueva. Editar la
  // plantilla NUNCA toca una Pantalla ya creada (R3) — ver cuentas.ts.
  .get(
    "/:id/pantallas",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const plataforma = await cliente.plataforma.findUnique({ where: { id: params.id } });
      if (!plataforma) {
        set.status = 404;
        return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
      }

      const filas = await cliente.plataformaPantalla.findMany({
        where: { plataformaId: params.id },
        orderBy: { numero: "asc" },
      });

      return {
        capacidadPantallas: filas.length,
        pantallas: filas.map((f) => ({ numero: f.numero, perfil: f.perfil, pin: f.pin ? descifrar(f.pin) : null })),
        // La plantilla almacenada ya es consistente (toda escritura pasa por
        // el PUT de abajo, que normaliza); aquí no se propaga nada nuevo.
        filasConPinPropagado: [],
      };
    },
    { params: t.Object({ id: t.String() }), response: { 200: esquemaPlantilla, 404: esquemaError } },
  )
  .put(
    "/:id/pantallas",
    async ({ params, body, contexto, set }) => {
      const resultado = await prismaParaEmpresa(contexto.empresaId).$transaction(async (txCliente) => {
        const plataforma = await txCliente.plataforma.findUnique({ where: { id: params.id } });
        if (!plataforma) return null;

        // F4.2, parte 2.2: mismo perfil ⇒ mismo pin, dentro de esta misma
        // plantilla. Se toma el primer pin no vacío que trae cada perfil en
        // el body y se propaga a todas las filas de ese perfil — nunca se
        // rechaza un pin distinto para el mismo perfil, se sobrescribe con
        // el canónico (igual que PATCH /cuentas/:id/pantallas/:pantallaId).
        const perfiles = body.pantallas.map((fila) => (plataforma.usaPerfilPin ? fila.perfil ?? null : null));
        const pinCanonicoPorPerfil = new Map<string, string>();
        for (const [indice, fila] of body.pantallas.entries()) {
          const perfil = perfiles[indice];
          if (perfil && fila.pin && !pinCanonicoPorPerfil.has(perfil)) {
            pinCanonicoPorPerfil.set(perfil, fila.pin);
          }
        }

        const filasConPinPropagado: number[] = [];

        for (const [indice, fila] of body.pantallas.entries()) {
          const numero = indice + 1;
          const perfil = perfiles[indice];
          const pinTexto = plataforma.usaPerfilPin
            ? perfil
              ? pinCanonicoPorPerfil.get(perfil) ?? null
              : fila.pin ?? null
            : null;
          if (perfil && pinTexto !== (fila.pin ?? null)) {
            filasConPinPropagado.push(numero);
          }
          const pin = pinTexto ? cifrar(pinTexto) : null;

          const existente = await txCliente.plataformaPantalla.findFirst({
            where: { plataformaId: params.id, numero },
          });
          if (existente) {
            await txCliente.plataformaPantalla.update({ where: { id: existente.id }, data: { perfil, pin } });
          } else {
            await txCliente.plataformaPantalla.create({
              data: datosSinEmpresa<Prisma.PlataformaPantallaUncheckedCreateInput>({
                plataformaId: params.id,
                numero,
                perfil,
                pin,
              }),
            });
          }
        }

        // Baja de cantidad: borra solo las filas de LA PLANTILLA que
        // sobraron (nunca una Pantalla real — eso no es inventario, ver
        // CLAUDE.md Parte 5).
        await txCliente.plataformaPantalla.deleteMany({
          where: { plataformaId: params.id, numero: { gt: body.pantallas.length } },
        });

        await txCliente.plataforma.update({
          where: { id: params.id },
          data: { capacidadPantallas: body.pantallas.length },
        });

        const filas = await txCliente.plataformaPantalla.findMany({
          where: { plataformaId: params.id },
          orderBy: { numero: "asc" },
        });
        return { filas, filasConPinPropagado };
      });

      if (!resultado) {
        set.status = 404;
        return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
      }

      return {
        capacidadPantallas: resultado.filas.length,
        pantallas: resultado.filas.map((f) => ({
          numero: f.numero,
          perfil: f.perfil,
          pin: f.pin ? descifrar(f.pin) : null,
        })),
        filasConPinPropagado: resultado.filasConPinPropagado,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: cuerpoPlantilla,
      response: { 200: esquemaPlantilla, 404: esquemaError },
    },
  );
