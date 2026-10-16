import { Elysia, t } from "elysia";
import { letraPerfil, PIN_PATRON } from "@dismanet/shared";
import { cifrar, descifrar } from "../lib/cifrado.ts";
import { pantallasDeCuenta, pantallasDeCuentas, pinesPorPerfil } from "../lib/pantallas.ts";
import { datosSinEmpresa, prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

// Mismo codigo que esquemaError, pero con los codigos de compra de las
// ventas afectadas (R3/R5, F4.2 parte 2.3): el frontend los necesita para
// mostrar "la pantalla vendida en la compra X" en vez de un 409 mudo.
const esquemaErrorPantallaVendida = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
  codigosCompraAfectados: t.Array(t.String()),
});

// Nunca incluye password ni codigo/pin (Parte 4): esos solo salen por
// GET /:id/credenciales, bajo la acción explícita "ver credenciales".
// usuario y enlace no son secretos (texto plano), así que sí viajan aquí.
const esquemaCuenta = t.Object({
  id: t.String(),
  plataformaId: t.String(),
  nombrePlataforma: t.String(),
  correo: t.Union([t.String(), t.Null()]),
  usuario: t.Union([t.String(), t.Null()]),
  enlace: t.Union([t.String(), t.Null()]),
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
  usuario: t.Union([t.String(), t.Null()]),
  codigo: t.Union([t.String(), t.Null()]),
  enlace: t.Union([t.String(), t.Null()]),
  pantallas: t.Array(t.Object({ id: t.String(), numero: t.Number(), pin: t.Union([t.String(), t.Null()]) })),
});

interface FilaCuenta {
  id: string;
  plataformaId: string;
  correo: string | null;
  usuario: string | null;
  enlace: string | null;
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
    usuario: fila.usuario,
    enlace: fila.enlace,
    capacidadPantallas: fila.capacidadPantallas,
    notas: fila.notas,
    activa: fila.activa,
    pantallasLibres,
    pantallasTotales,
  };
}

// F4.2, parte 1.3 — "arreglar el dato no es arreglar la fuente": qué campos
// de acceso pide/prohíbe una Cuenta lo decide la Plataforma elegida
// (usaCorreo/usaUsuario/usaCodigo/usaEnlace), no un t.String() fijo en el
// esquema. La validación vive aquí, en el handler, porque depende de la
// plataforma cargada — TypeBox no puede expresar "obligatorio si X".
type ClaveCampoAcceso = "correo" | "usuario" | "codigo" | "enlace";

interface PlataformaConBanderasAcceso {
  nombre: string;
  usaCorreo: boolean;
  usaUsuario: boolean;
  usaCodigo: boolean;
  usaEnlace: boolean;
}

const CAMPOS_ACCESO: { clave: ClaveCampoAcceso; bandera: keyof PlataformaConBanderasAcceso; etiqueta: string }[] = [
  { clave: "correo", bandera: "usaCorreo", etiqueta: "correo" },
  { clave: "usuario", bandera: "usaUsuario", etiqueta: "usuario" },
  { clave: "codigo", bandera: "usaCodigo", etiqueta: "código" },
  { clave: "enlace", bandera: "usaEnlace", etiqueta: "enlace" },
];

/** "" y " " cuentan como ausente: evita que un campo prohibido se guarde como cadena vacía. */
function valorONulo(valor: string | null | undefined): string | null {
  if (valor === undefined || valor === null) return null;
  const recortado = valor.trim();
  return recortado === "" ? null : recortado;
}

/**
 * `modo: "crear"` exige los 4 campos según la plataforma, sin importar si
 * vinieron en el body (una cuenta nueva no puede nacer incompleta).
 * `modo: "editar"` solo valida los campos que de verdad vinieron en el
 * PATCH (`valores` debe construirse con las claves presentes únicamente) —
 * omitir un campo en una edición no lo vuelve a validar.
 */
function validarCamposDeAcceso(
  plataforma: PlataformaConBanderasAcceso,
  valores: Partial<Record<ClaveCampoAcceso, string | null>>,
  modo: "crear" | "editar",
): { codigo: string; mensaje: string } | null {
  for (const { clave, bandera, etiqueta } of CAMPOS_ACCESO) {
    const presente = clave in valores;
    const valor = valores[clave] ?? null;

    if (plataforma[bandera]) {
      if ((modo === "crear" || presente) && valor === null) {
        return { codigo: "CAMPO_REQUERIDO_POR_PLATAFORMA", mensaje: `${plataforma.nombre} necesita ${etiqueta}.` };
      }
    } else if (presente && valor !== null) {
      return { codigo: "CAMPO_REQUERIDO_POR_PLATAFORMA", mensaje: `${plataforma.nombre} no usa ${etiqueta}.` };
    }
  }
  return null;
}

// Parte 1 y 2 del encargo "plantilla de pantallas": capacidad, perfiles y
// pines ya no se piden aquí — se copian de PlataformaPantalla (la plantilla
// de la plataforma elegida). Los 4 campos de acceso son todos opcionales a
// nivel de esquema: la obligatoriedad real la decide validarCamposDeAcceso
// según la plataforma, no TypeBox.
const cuerpoCrearCuenta = t.Object({
  plataformaId: t.String(),
  correo: t.Optional(t.Union([t.String(), t.Null()])),
  usuario: t.Optional(t.Union([t.String(), t.Null()])),
  codigo: t.Optional(t.Union([t.String(), t.Null()])),
  enlace: t.Optional(t.Union([t.String(), t.Null()])),
  password: t.String({ minLength: 1 }),
  notas: t.Optional(t.Union([t.String(), t.Null()])),
});

const cuerpoEditarCuenta = t.Object({
  correo: t.Optional(t.Union([t.String(), t.Null()])),
  usuario: t.Optional(t.Union([t.String(), t.Null()])),
  codigo: t.Optional(t.Union([t.String(), t.Null()])),
  enlace: t.Optional(t.Union([t.String(), t.Null()])),
  password: t.Optional(t.String({ minLength: 1 })),
  notas: t.Optional(t.Union([t.String(), t.Null()])),
  capacidadPantallas: t.Optional(t.Integer({ minimum: 1 })),
});

const cuerpoEditarPantalla = t.Object({
  perfil: t.Optional(t.Union([t.String(), t.Null()])),
  pin: t.Optional(t.Union([t.String({ pattern: PIN_PATRON }), t.Null()])),
  // F4.2, parte 2.3: sin esto, cambiar perfil/pin de una pantalla con una
  // venta vigente se rechaza con PANTALLA_VENDIDA. Nunca una casilla oculta:
  // el frontend la marca true solo tras un diálogo de confirmación explícito.
  confirmarPantallaVendida: t.Optional(t.Boolean()),
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

// Parte 2 — CRUD de cuentas. Históricamente todo era ADMIN (D6 del PRD: el
// vendedor no tiene acceso a la base de correos/contraseñas); el reparto de
// roles EMPLEADO abre la creación de cuentas a EMPLEADO (planta: crea
// cuentas y las carga de pantallas al vender), pero el resto del CRUD —
// listar, ver detalle, ver credenciales, editar, activar/desactivar, editar
// pantalla — sigue siendo exclusivo de ADMIN. Por eso el router abre en
// EMPLEADO y declara POST / antes de escalar a ADMIN para todo lo demás:
// mismo patrón de escalada a mitad de cadena que ventas.ts. Como el resto
// del catálogo (R3/CLAUDE.md), una cuenta o pantalla nunca se borra: se
// desactiva.
export const cuentas = new Elysia({ prefix: "/cuentas" })
  .use(requiereRol(Rol.EMPLEADO))
  .onBeforeHandle(({ contexto, set }) => {
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

      const valoresAcceso = {
        correo: valorONulo(body.correo),
        usuario: valorONulo(body.usuario),
        codigo: valorONulo(body.codigo),
        enlace: valorONulo(body.enlace),
      };
      const errorCampos = validarCamposDeAcceso(plataforma, valoresAcceso, "crear");
      if (errorCampos) {
        set.status = 409;
        return { error: errorCampos };
      }

      // Parte 2: las pantallas se generan copiando la plantilla de la
      // plataforma (PlataformaPantalla), nunca a mano. El chequeo de que la
      // plantilla exista va DENTRO de la misma transacción que crea la
      // Cuenta — así, si la plantilla está vacía, la transacción entera se
      // revierte y nunca queda una cuenta sin pantallas (inventario
      // fantasma que el vendedor vería disponible y no podría entregar).
      const resultado = await prismaParaEmpresa(contexto.empresaId).$transaction(async (txCliente) => {
        const plantilla = await txCliente.plataformaPantalla.findMany({
          where: { plataformaId: body.plataformaId },
          orderBy: { numero: "asc" },
        });
        if (plantilla.length === 0) {
          return { tipo: "sin-plantilla" as const };
        }

        const creada = await txCliente.cuenta.create({
          data: datosSinEmpresa<Prisma.CuentaUncheckedCreateInput>({
            plataformaId: body.plataformaId,
            correo: valoresAcceso.correo,
            usuario: valoresAcceso.usuario,
            codigo: valoresAcceso.codigo ? cifrar(valoresAcceso.codigo) : null,
            enlace: valoresAcceso.enlace,
            password: cifrar(body.password),
            capacidadPantallas: plantilla.length,
            notas: body.notas ?? null,
          }),
        });

        for (const fila of plantilla) {
          await txCliente.pantalla.create({
            data: datosSinEmpresa<Prisma.PantallaUncheckedCreateInput>({
              cuentaId: creada.id,
              numero: fila.numero,
              perfil: fila.perfil,
              pin: fila.pin,
            }),
          });
        }

        return { tipo: "ok" as const, cuenta: creada };
      });

      if (resultado.tipo === "sin-plantilla") {
        set.status = 400;
        return {
          error: {
            codigo: "PLANTILLA_NO_CONFIGURADA",
            mensaje: `La plataforma "${plataforma.nombre}" no tiene una plantilla de pantallas configurada. Configúrala primero en Plataformas antes de crear cuentas.`,
          },
        };
      }

      set.status = 201;
      const cantidad = resultado.cuenta.capacidadPantallas;
      return {
        cuenta: respuestaCuenta({ ...resultado.cuenta, plataforma: { nombre: plataforma.nombre } }, cantidad, cantidad),
      };
    },
    {
      body: cuerpoCrearCuenta,
      response: {
        201: t.Object({ cuenta: esquemaCuenta }),
        400: esquemaError,
        404: esquemaError,
        409: esquemaError,
      },
    },
  )

  // Todo lo demás (listar, detalle, credenciales, editar, activar/
  // desactivar, editar pantalla) sigue siendo exclusivo de ADMIN — mismo
  // patrón de escalada de rol que ventas.ts.
  .use(requiereRol(Rol.ADMIN))

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
  // salen password, codigo y pin, y solo porque el ADMIN la pidió a propósito.
  .get(
    "/:id/credenciales",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const cuenta = await cliente.cuenta.findUnique({
        where: { id: params.id },
        select: { id: true, password: true, usuario: true, codigo: true, enlace: true },
      });
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
        usuario: cuenta.usuario,
        codigo: cuenta.codigo ? descifrar(cuenta.codigo) : null,
        enlace: cuenta.enlace,
        pantallas: pantallas.map((p) => ({ id: p.id, numero: p.numero, pin: p.pin ? descifrar(p.pin) : null })),
      };
    },
    { params: t.Object({ id: t.String() }), response: { 200: esquemaCredenciales, 404: esquemaError } },
  )
  .patch(
    "/:id",
    async ({ params, body, contexto, set }) => {
      const resultado = await prismaParaEmpresa(contexto.empresaId).$transaction(async (txCliente) => {
        const cuenta = await txCliente.cuenta.findUnique({ where: { id: params.id } });
        if (!cuenta) return { tipo: "no-encontrada" as const };

        const plataforma = await txCliente.plataforma.findUnique({ where: { id: cuenta.plataformaId } });
        if (!plataforma) return { tipo: "no-encontrada" as const };

        const valoresAcceso: Partial<Record<ClaveCampoAcceso, string | null>> = {};
        if (body.correo !== undefined) valoresAcceso.correo = valorONulo(body.correo);
        if (body.usuario !== undefined) valoresAcceso.usuario = valorONulo(body.usuario);
        if (body.codigo !== undefined) valoresAcceso.codigo = valorONulo(body.codigo);
        if (body.enlace !== undefined) valoresAcceso.enlace = valorONulo(body.enlace);

        const errorCampos = validarCamposDeAcceso(plataforma, valoresAcceso, "editar");
        if (errorCampos) return { tipo: "campo-invalido" as const, error: errorCampos };

        const dataActualizacion: Prisma.CuentaUpdateInput = {};
        if (body.correo !== undefined) dataActualizacion.correo = valoresAcceso.correo ?? null;
        if (body.usuario !== undefined) dataActualizacion.usuario = valoresAcceso.usuario ?? null;
        if (body.codigo !== undefined) {
          dataActualizacion.codigo = valoresAcceso.codigo ? cifrar(valoresAcceso.codigo) : null;
        }
        if (body.enlace !== undefined) dataActualizacion.enlace = valoresAcceso.enlace ?? null;
        if (body.password !== undefined) dataActualizacion.password = cifrar(body.password);
        if (body.notas !== undefined) dataActualizacion.notas = body.notas;

        if (body.capacidadPantallas !== undefined && body.capacidadPantallas !== cuenta.capacidadPantallas) {
          const nuevaCapacidad = body.capacidadPantallas;

          if (nuevaCapacidad > cuenta.capacidadPantallas) {
            const numerosNuevos: number[] = [];
            for (let numero = cuenta.capacidadPantallas + 1; numero <= nuevaCapacidad; numero++) {
              numerosNuevos.push(numero);
            }
            // F4.2, parte 2.2: mismo perfil ⇒ mismo pin. letraPerfil envuelve
            // cada 26 pantallas (A, B, ... Z, A, ...), así que un lote grande
            // puede repetir perfil dentro de sí mismo — pinesPorPerfil es lo
            // que garantiza que esa repetición comparta pin, en vez de que
            // cada pantalla reciba uno distinto (el bug que motivó esta
            // entrega: dos pantallas de perfil B con pines distintos).
            const perfilesNuevos = numerosNuevos.map((numero) =>
              plataforma.usaPerfilPin ? letraPerfil(numero - 1) : null,
            );
            const pinesGenerados = plataforma.usaPerfilPin ? pinesPorPerfil(perfilesNuevos) : [];

            for (const [indice, numero] of numerosNuevos.entries()) {
              // La numeración nunca se reinicia: si la pantalla ya existe
              // (quedó desactivada por una baja de capacidad anterior), se
              // reactiva en vez de crear una fila duplicada — @@unique([
              // cuentaId, numero]) lo impediría de todos modos.
              const existente = await txCliente.pantalla.findFirst({ where: { cuentaId: cuenta.id, numero } });
              const pinTexto = pinesGenerados[indice];
              if (existente) {
                await txCliente.pantalla.update({ where: { id: existente.id }, data: { activa: true } });
              } else {
                await txCliente.pantalla.create({
                  data: datosSinEmpresa<Prisma.PantallaUncheckedCreateInput>({
                    cuentaId: cuenta.id,
                    numero,
                    perfil: perfilesNuevos[indice],
                    pin: pinTexto ? cifrar(pinTexto) : null,
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
      if (resultado.tipo === "campo-invalido") {
        set.status = 409;
        return { error: resultado.error };
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
      response: { 200: t.Object({ cuenta: esquemaCuenta }), 400: esquemaError, 404: esquemaError, 409: esquemaError },
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
  // "ambos editables... después de guardar"). F4.2 agrega dos reglas de
  // negocio sobre esta misma ruta: 2.2 (propagar el pin a las hermanas del
  // mismo perfil) y 2.3 (bloquear el cambio en una pantalla vendida, salvo
  // confirmación explícita).
  .patch(
    "/:id/pantallas/:pantallaId",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const pantalla = await cliente.pantalla.findFirst({ where: { id: params.pantallaId, cuentaId: params.id } });
      if (!pantalla) {
        set.status = 404;
        return { error: { codigo: "PANTALLA_NO_ENCONTRADA", mensaje: "La pantalla no existe en esta cuenta." } };
      }

      const cambiaAlgo = body.perfil !== undefined || body.pin !== undefined;

      // R5: ocupada = existe un VentaDetalle vigente (nunca Venta.fechaVencimientoMax).
      if (cambiaAlgo) {
        const estados = await pantallasDeCuenta(cliente, params.id);
        const estadoActual = estados.find((e) => e.id === pantalla.id);
        const ocupada = estadoActual ? !estadoActual.libre : false;

        if (ocupada && !body.confirmarPantallaVendida) {
          set.status = 409;
          // F4.7, arreglo 6 — nombrar a TODOS los compradores afectados, no
          // solo al más reciente: el cliente sobrevende a propósito y una
          // pantalla puede tener más de una venta vigente a la vez.
          const codigos = estadoActual?.codigosCompraAfectados ?? [];
          return {
            error: {
              codigo: "PANTALLA_VENDIDA",
              mensaje:
                codigos.length > 0
                  ? `La pantalla #${pantalla.numero} está vendida (código${codigos.length > 1 ? "s" : ""} de compra ${codigos.join(", ")}). Confirma para cambiar su perfil/PIN de todos modos.`
                  : `La pantalla #${pantalla.numero} está vendida. Confirma para cambiar su perfil/PIN de todos modos.`,
            },
            codigosCompraAfectados: codigos,
          };
        }
      }

      const { actualizada, pantallasHermanasActualizadas } = await cliente.$transaction(async (tx) => {
        let actualizada = await tx.pantalla.update({
          where: { id: pantalla.id },
          data: {
            ...(body.perfil !== undefined ? { perfil: body.perfil } : {}),
            ...(body.pin !== undefined ? { pin: body.pin ? cifrar(body.pin) : null } : {}),
          },
        });

        // F4.2, parte 2.2: mismo perfil ⇒ mismo pin, siempre — nunca se
        // rechaza un pin por repetirse entre pantallas de distinta cuenta;
        // acá se propaga a las HERMANAS (misma cuenta, mismo perfil), que
        // son literalmente la misma puerta.
        let pantallasHermanasActualizadas: number[] = [];
        if (actualizada.perfil !== null) {
          const hermanas = await tx.pantalla.findMany({
            where: { cuentaId: params.id, perfil: actualizada.perfil, id: { not: actualizada.id } },
          });

          if (hermanas.length > 0) {
            if (body.pin !== undefined) {
              // El pin llegó explícito en el body: manda sobre las hermanas.
              await tx.pantalla.updateMany({
                where: { id: { in: hermanas.map((h) => h.id) } },
                data: { pin: actualizada.pin },
              });
              pantallasHermanasActualizadas = hermanas.map((h) => h.numero).sort((a, b) => a - b);
            } else if (body.perfil !== undefined) {
              // F4.7, arreglo 5 — la pantalla se MUDÓ de perfil sin traer un
              // pin propio: adopta el de las hermanas del perfil destino.
              // Sin esto quedan dos pines para la misma puerta, el estado
              // que F4.2 vino a eliminar.
              actualizada = await tx.pantalla.update({ where: { id: actualizada.id }, data: { pin: hermanas[0].pin } });
            }
          }
        }

        return { actualizada, pantallasHermanasActualizadas };
      });

      return {
        pantalla: { id: actualizada.id, numero: actualizada.numero, perfil: actualizada.perfil },
        pantallasHermanasActualizadas,
      };
    },
    {
      params: t.Object({ id: t.String(), pantallaId: t.String() }),
      body: cuerpoEditarPantalla,
      response: {
        200: t.Object({
          pantalla: t.Object({ id: t.String(), numero: t.Number(), perfil: t.Union([t.String(), t.Null()]) }),
          pantallasHermanasActualizadas: t.Array(t.Number()),
        }),
        404: esquemaError,
        409: esquemaErrorPantallaVendida,
      },
    },
  );
