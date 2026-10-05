import { Elysia, t } from "elysia";
import { cifrar, descifrar } from "../lib/cifrado.ts";
import { letraPerfil, pantallasDeCuenta, pantallasDeCuentas, pinesDistintos } from "../lib/pantallas.ts";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

// Nunca incluye password ni pin (Parte 4): esos solo salen por
// GET /:id/credenciales, bajo la acción explícita "ver credenciales".
const esquemaCuenta = t.Object({
  id: t.String(),
  plataformaId: t.String(),
  nombrePlataforma: t.String(),
  correo: t.String(),
  capacidadPantallas: t.Number(),
  notas: t.Union([t.String(), t.Null()]),
  activa: t.Boolean(),
  pantallasLibres: t.Number(),
  pantallasTotales: t.Number(),
});

// Tampoco incluye pin: el detalle de una cuenta muestra número, perfil,
// estado y ocupación, pero no el secreto. El pin sale por /credenciales.
const esquemaPantalla = t.Object({
  id: t.String(),
  numero: t.Number(),
  perfil: t.Union([t.String(), t.Null()]),
  activa: t.Boolean(),
  libre: t.Boolean(),
  ocupadaHasta: t.Union([t.String(), t.Null()]),
  ventaId: t.Union([t.String(), t.Null()]),
});

const esquemaCredenciales = t.Object({
  password: t.String(),
  pantallas: t.Array(t.Object({ id: t.String(), numero: t.Number(), pin: t.Union([t.String(), t.Null()]) })),
});

interface FilaCuenta {
  id: string;
  plataformaId: string;
  correo: string;
  capacidadPantallas: number;
  notas: string | null;
  activa: boolean;
  plataforma: { nombre: string };
}

function respuestaCuenta(fila: FilaCuenta, pantallasLibres: number, pantallasTotales: number) {
  return {
    id: fila.id,
    plataformaId: fila.plataformaId,
    nombrePlataforma: fila.plataforma.nombre,
    correo: fila.correo,
    capacidadPantallas: fila.capacidadPantallas,
    notas: fila.notas,
    activa: fila.activa,
    pantallasLibres,
    pantallasTotales,
  };
}

const cuerpoPantallaPropuesta = t.Object({
  numero: t.Integer({ minimum: 1 }),
  perfil: t.Union([t.String(), t.Null()]),
  pin: t.Union([t.String({ pattern: "^[0-9]{4}$" }), t.Null()]),
});

const cuerpoCrearCuenta = t.Object({
  plataformaId: t.String(),
  correo: t.String({ minLength: 1 }),
  password: t.String({ minLength: 1 }),
  capacidadPantallas: t.Integer({ minimum: 1 }),
  notas: t.Optional(t.Union([t.String(), t.Null()])),
  // Permite que el frontend envíe los perfiles/PIN ya editados por el
  // ADMIN antes de guardar (Parte 2: "ambos editables, antes y después de
  // guardar"). Si se omite, el servidor propone A, B, C... y PINes
  // aleatorios.
  pantallas: t.Optional(t.Array(cuerpoPantallaPropuesta)),
});

const cuerpoEditarCuenta = t.Object({
  correo: t.Optional(t.String({ minLength: 1 })),
  password: t.Optional(t.String({ minLength: 1 })),
  notas: t.Optional(t.Union([t.String(), t.Null()])),
  capacidadPantallas: t.Optional(t.Integer({ minimum: 1 })),
});

const cuerpoEditarPantalla = t.Object({
  perfil: t.Optional(t.Union([t.String(), t.Null()])),
  pin: t.Optional(t.Union([t.String({ pattern: "^[0-9]{4}$" }), t.Null()])),
});

/** Agrupa el estado de pantallas por cuentaId, para calcular libres/totales de varias cuentas a la vez. */
function contarPorCuenta(estados: { cuentaId: string; activa: boolean; libre: boolean }[]) {
  const porCuenta = new Map<string, { libres: number; totales: number }>();
  for (const e of estados) {
    if (!e.activa) continue;
    const actual = porCuenta.get(e.cuentaId) ?? { libres: 0, totales: 0 };
    actual.totales += 1;
    if (e.libre) actual.libres += 1;
    porCuenta.set(e.cuentaId, actual);
  }
  return porCuenta;
}

// Parte 2 — CRUD de cuentas, solo ADMIN (D6 del PRD: el vendedor no tiene
// acceso a la base de correos/contraseñas). Como el resto del catálogo
// (R3/CLAUDE.md), una cuenta o pantalla nunca se borra: se desactiva.
export const cuentas = new Elysia({ prefix: "/cuentas" })
  .use(requiereRol(Rol.ADMIN))
  .onBeforeHandle({ as: "scoped" }, ({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: {
          codigo: "SIN_EMPRESA_ACTIVA",
          mensaje: "Selecciona una empresa antes de gestionar sus cuentas.",
        },
      };
    }
  })
  .get(
    "/",
    async ({ query, contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const filas = await cliente.cuenta.findMany({
        where: {
          ...(query.plataformaId ? { plataformaId: query.plataformaId } : {}),
          ...(query.estado === "activa" ? { activa: true } : query.estado === "inactiva" ? { activa: false } : {}),
        },
        orderBy: [{ plataformaId: "asc" }, { correo: "asc" }],
        include: { plataforma: { select: { nombre: true } } },
      });

      const porCuenta = contarPorCuenta(await pantallasDeCuentas(cliente, filas.map((f) => f.id)));

      return {
        cuentas: filas.map((fila) => {
          const conteo = porCuenta.get(fila.id) ?? { libres: 0, totales: 0 };
          return respuestaCuenta(fila, conteo.libres, conteo.totales);
        }),
      };
    },
    {
      query: t.Object({
        plataformaId: t.Optional(t.String()),
        estado: t.Optional(t.Union([t.Literal("activa"), t.Literal("inactiva")])),
      }),
      response: { 200: t.Object({ cuentas: t.Array(esquemaCuenta) }) },
    },
  )
  .get(
    "/:id",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const cuenta = await cliente.cuenta.findUnique({
        where: { id: params.id },
        include: { plataforma: { select: { nombre: true } } },
      });
      if (!cuenta) {
        set.status = 404;
        return { error: { codigo: "CUENTA_NO_ENCONTRADA", mensaje: "La cuenta no existe." } };
      }

      const estados = await pantallasDeCuenta(cliente, cuenta.id);
      const activas = estados.filter((p) => p.activa);

      return {
        cuenta: respuestaCuenta(
          cuenta,
          activas.filter((p) => p.libre).length,
          activas.length,
        ),
        pantallas: estados.map((p) => ({
          id: p.id,
          numero: p.numero,
          perfil: p.perfil,
          activa: p.activa,
          libre: p.libre,
          ocupadaHasta: p.ocupadaHasta ? p.ocupadaHasta.toISOString() : null,
          ventaId: p.ventaId,
        })),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ cuenta: esquemaCuenta, pantallas: t.Array(esquemaPantalla) }),
        404: esquemaError,
      },
    },
  )
  // Acción explícita "ver credenciales" (Parte 4): la única ruta donde
  // salen password y pin, y solo porque el ADMIN la pidió a propósito.
  .get(
    "/:id/credenciales",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const cuenta = await cliente.cuenta.findUnique({ where: { id: params.id }, select: { id: true, password: true } });
      if (!cuenta) {
        set.status = 404;
        return { error: { codigo: "CUENTA_NO_ENCONTRADA", mensaje: "La cuenta no existe." } };
      }

      const pantallas = await cliente.pantalla.findMany({
        where: { cuentaId: cuenta.id },
        orderBy: { numero: "asc" },
        select: { id: true, numero: true, pin: true },
      });

      return {
        password: descifrar(cuenta.password),
        pantallas: pantallas.map((p) => ({ id: p.id, numero: p.numero, pin: p.pin ? descifrar(p.pin) : null })),
      };
    },
    { params: t.Object({ id: t.String() }), response: { 200: esquemaCredenciales, 404: esquemaError } },
  )
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);

      const plataforma = await cliente.plataforma.findUnique({ where: { id: body.plataformaId } });
      if (!plataforma) {
        set.status = 404;
        return { error: { codigo: "PLATAFORMA_NO_ENCONTRADA", mensaje: "La plataforma no existe." } };
      }
      if (!plataforma.activa) {
        set.status = 400;
        return {
          error: { codigo: "PLATAFORMA_INACTIVA", mensaje: "Solo se pueden crear cuentas de plataformas activas." },
        };
      }

      if (body.pantallas) {
        const numeros = body.pantallas.map((p) => p.numero);
        const numerosEsperados = new Set(Array.from({ length: body.capacidadPantallas }, (_, i) => i + 1));
        const valido =
          numeros.length === body.capacidadPantallas &&
          new Set(numeros).size === numeros.length &&
          numeros.every((n) => numerosEsperados.has(n));
        if (!valido) {
          set.status = 400;
          return {
            error: {
              codigo: "PANTALLAS_INVALIDAS",
              mensaje: `Las pantallas propuestas deben numerarse del 1 al ${body.capacidadPantallas}, una sola vez cada una.`,
            },
          };
        }
      }

      const cuenta = await prismaParaEmpresa(contexto.empresaId).$transaction(async (txCliente) => {
        const creada = await txCliente.cuenta.create({
          data: datosSinEmpresa<Prisma.CuentaUncheckedCreateInput>({
            plataformaId: body.plataformaId,
            correo: body.correo,
            password: cifrar(body.password),
            capacidadPantallas: body.capacidadPantallas,
            notas: body.notas ?? null,
          }),
        });

        const propuestaPorNumero = new Map((body.pantallas ?? []).map((p) => [p.numero, p]));
        const pinesFijados = new Set(
          (body.pantallas ?? []).map((p) => p.pin).filter((pin): pin is string => pin !== null),
        );
        const cantidadAleatorios = plataforma.usaPerfilPin
          ? Array.from({ length: body.capacidadPantallas }, (_, i) => i + 1).filter(
              (numero) => !propuestaPorNumero.get(numero)?.pin,
            ).length
          : 0;
        const pinesGenerados = pinesDistintos(cantidadAleatorios, pinesFijados);
        let siguientePinGenerado = 0;

        for (let numero = 1; numero <= body.capacidadPantallas; numero++) {
          const propuesta = propuestaPorNumero.get(numero);
          const perfil = plataforma.usaPerfilPin ? propuesta?.perfil ?? letraPerfil(numero - 1) : null;
          const pin = plataforma.usaPerfilPin ? propuesta?.pin ?? pinesGenerados[siguientePinGenerado++] : null;
          await txCliente.pantalla.create({
            data: datosSinEmpresa<Prisma.PantallaUncheckedCreateInput>({
              cuentaId: creada.id,
              numero,
              perfil,
              pin: pin ? cifrar(pin) : null,
            }),
          });
        }

        return creada;
      });

      set.status = 201;
      return { cuenta: respuestaCuenta({ ...cuenta, plataforma: { nombre: plataforma.nombre } }, body.capacidadPantallas, body.capacidadPantallas) };
    },
    {
      body: cuerpoCrearCuenta,
      response: { 201: t.Object({ cuenta: esquemaCuenta }), 400: esquemaError, 404: esquemaError },
    },
  )
  .patch(
    "/:id",
    async ({ params, body, contexto, set }) => {
      const resultado = await prismaParaEmpresa(contexto.empresaId).$transaction(async (txCliente) => {
        const cuenta = await txCliente.cuenta.findUnique({ where: { id: params.id } });
        if (!cuenta) return { tipo: "no-encontrada" as const };

        const dataActualizacion: Prisma.CuentaUpdateInput = {};
        if (body.correo !== undefined) dataActualizacion.correo = body.correo;
        if (body.password !== undefined) dataActualizacion.password = cifrar(body.password);
        if (body.notas !== undefined) dataActualizacion.notas = body.notas;

        if (body.capacidadPantallas !== undefined && body.capacidadPantallas !== cuenta.capacidadPantallas) {
          const nuevaCapacidad = body.capacidadPantallas;

          if (nuevaCapacidad > cuenta.capacidadPantallas) {
            const plataforma = await txCliente.plataforma.findUnique({ where: { id: cuenta.plataformaId } });
            if (!plataforma) return { tipo: "no-encontrada" as const };

            const numerosNuevos: number[] = [];
            for (let numero = cuenta.capacidadPantallas + 1; numero <= nuevaCapacidad; numero++) {
              numerosNuevos.push(numero);
            }
            const pinesGenerados = plataforma.usaPerfilPin ? pinesDistintos(numerosNuevos.length) : [];

            for (const [indice, numero] of numerosNuevos.entries()) {
              // La numeración nunca se reinicia: si la pantalla ya existe
              // (quedó desactivada por una baja de capacidad anterior), se
              // reactiva en vez de crear una fila duplicada — @@unique([
              // cuentaId, numero]) lo impediría de todos modos.
              const existente = await txCliente.pantalla.findFirst({ where: { cuentaId: cuenta.id, numero } });
              if (existente) {
                await txCliente.pantalla.update({ where: { id: existente.id }, data: { activa: true } });
              } else {
                await txCliente.pantalla.create({
                  data: datosSinEmpresa<Prisma.PantallaUncheckedCreateInput>({
                    cuentaId: cuenta.id,
                    numero,
                    perfil: plataforma.usaPerfilPin ? letraPerfil(numero - 1) : null,
                    pin: plataforma.usaPerfilPin ? cifrar(pinesGenerados[indice]) : null,
                  }),
                });
              }
            }
          } else {
            const estados = await pantallasDeCuenta(txCliente, cuenta.id);
            const sobrantes = estados.filter((p) => p.numero > nuevaCapacidad);
            const ocupadas = sobrantes.filter((p) => !p.libre);
            if (ocupadas.length > 0) {
              return { tipo: "pantallas-ocupadas" as const, ocupadas };
            }
            await txCliente.pantalla.updateMany({
              where: { cuentaId: cuenta.id, numero: { gt: nuevaCapacidad } },
              data: { activa: false },
            });
          }

          dataActualizacion.capacidadPantallas = nuevaCapacidad;
        }

        const actualizada = await txCliente.cuenta.update({
          where: { id: cuenta.id },
          data: dataActualizacion,
          include: { plataforma: { select: { nombre: true } } },
        });

        const estadosFinal = await pantallasDeCuenta(txCliente, actualizada.id);
        const activasFinal = estadosFinal.filter((p) => p.activa);
        return {
          tipo: "ok" as const,
          cuenta: actualizada,
          pantallasLibres: activasFinal.filter((p) => p.libre).length,
          pantallasTotales: activasFinal.length,
        };
      });

      if (resultado.tipo === "no-encontrada") {
        set.status = 404;
        return { error: { codigo: "CUENTA_NO_ENCONTRADA", mensaje: "La cuenta no existe." } };
      }
      if (resultado.tipo === "pantallas-ocupadas") {
        set.status = 400;
        const detalle = resultado.ocupadas
          .map((p) => `#${p.numero} (ocupada hasta ${p.ocupadaHasta?.toISOString()})`)
          .join(", ");
        return {
          error: {
            codigo: "PANTALLAS_OCUPADAS",
            mensaje: `No se puede bajar la capacidad: las pantallas ${detalle} siguen ocupadas.`,
          },
        };
      }
      return { cuenta: respuestaCuenta(resultado.cuenta, resultado.pantallasLibres, resultado.pantallasTotales) };
    },
    {
      params: t.Object({ id: t.String() }),
      body: cuerpoEditarCuenta,
      response: { 200: t.Object({ cuenta: esquemaCuenta }), 400: esquemaError, 404: esquemaError },
    },
  )
  .patch(
    "/:id/activar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const cuenta = await cliente.cuenta.update({
          where: { id: params.id },
          data: { activa: true },
          include: { plataforma: { select: { nombre: true } } },
        });
        const activas = (await pantallasDeCuenta(cliente, cuenta.id)).filter((p) => p.activa);
        return {
          cuenta: respuestaCuenta(cuenta, activas.filter((p) => p.libre).length, activas.length),
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "CUENTA_NO_ENCONTRADA", mensaje: "La cuenta no existe." } };
        }
        throw error;
      }
    },
    { params: t.Object({ id: t.String() }), response: { 200: t.Object({ cuenta: esquemaCuenta }), 404: esquemaError } },
  )
  .patch(
    "/:id/desactivar",
    async ({ params, contexto, set }) => {
      try {
        const cliente = prismaParaEmpresa(contexto.empresaId);
        const cuenta = await cliente.cuenta.update({
          where: { id: params.id },
          data: { activa: false },
          include: { plataforma: { select: { nombre: true } } },
        });
        const activas = (await pantallasDeCuenta(cliente, cuenta.id)).filter((p) => p.activa);
        return {
          cuenta: respuestaCuenta(cuenta, activas.filter((p) => p.libre).length, activas.length),
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          set.status = 404;
          return { error: { codigo: "CUENTA_NO_ENCONTRADA", mensaje: "La cuenta no existe." } };
        }
        throw error;
      }
    },
    { params: t.Object({ id: t.String() }), response: { 200: t.Object({ cuenta: esquemaCuenta }), 404: esquemaError } },
  )
  // Edición puntual de perfil/PIN de una pantalla ya creada (Parte 2:
  // "ambos editables... después de guardar").
  .patch(
    "/:id/pantallas/:pantallaId",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const pantalla = await cliente.pantalla.findFirst({ where: { id: params.pantallaId, cuentaId: params.id } });
      if (!pantalla) {
        set.status = 404;
        return { error: { codigo: "PANTALLA_NO_ENCONTRADA", mensaje: "La pantalla no existe en esta cuenta." } };
      }

      const actualizada = await cliente.pantalla.update({
        where: { id: pantalla.id },
        data: {
          ...(body.perfil !== undefined ? { perfil: body.perfil } : {}),
          ...(body.pin !== undefined ? { pin: body.pin ? cifrar(body.pin) : null } : {}),
        },
      });

      return {
        pantalla: { id: actualizada.id, numero: actualizada.numero, perfil: actualizada.perfil },
      };
    },
    {
      params: t.Object({ id: t.String(), pantallaId: t.String() }),
      body: cuerpoEditarPantalla,
      response: {
        200: t.Object({ pantalla: t.Object({ id: t.String(), numero: t.Number(), perfil: t.Union([t.String(), t.Null()]) }) }),
        404: esquemaError,
      },
    },
  );
