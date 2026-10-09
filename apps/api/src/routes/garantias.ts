import { Elysia, t } from "elysia";
import { prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { descifrar } from "../lib/cifrado.ts";
import { realizarGarantia, GarantiaYaReemplazadaError } from "../lib/garantias.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

// "Pantallas vendidas" — una fila por VentaDetalle entregado (sección 6).
// VENDEDOR ve las de todos los vendedores, con credenciales (necesita poder
// revisar si la cuenta sirve, sin importar quién vendió) — pero nunca
// costo/utilidad/margen/costoAsumido (R4) ni celularCliente, que por eso no
// aparece en ningún campo de este archivo.
const esquemaGarantiaDetalle = t.Composite([
  t.Object({
    id: t.String(),
    motivo: t.Union([t.String(), t.Null()]),
    creadoEn: t.String(),
    creadoPor: t.Object({ id: t.String(), nombre: t.String() }),
    correoCuentaReemplazo: t.String(),
  }),
  t.Object({ costoAsumido: t.Optional(t.String()) }),
]);

const esquemaEstadoPantalla = t.Union([
  t.Literal("VIGENTE"),
  t.Literal("VENCIDA"),
  t.Literal("REEMPLAZADA"),
  t.Literal("VENTA_ANULADA"),
]);

const esquemaPantallaVendida = t.Object({
  id: t.String(),
  plataformaId: t.String(),
  nombrePlataforma: t.String(),
  correoCuenta: t.String(),
  claveCuenta: t.String(),
  perfil: t.Union([t.String(), t.Null()]),
  pin: t.Union([t.String(), t.Null()]),
  codigoCompra: t.String(),
  vendedor: t.Object({ id: t.String(), nombre: t.String() }),
  fechaEntrega: t.String(),
  fechaVencimiento: t.String(),
  estado: esquemaEstadoPantalla,
  puedeReemplazar: t.Boolean(),
  garantia: t.Union([esquemaGarantiaDetalle, t.Null()]),
});

const filtrosPantallasVendidas = t.Object({
  plataformaId: t.Optional(t.String()),
  vendedorId: t.Optional(t.String()),
  codigoCompra: t.Optional(t.String()),
  correoCuenta: t.Optional(t.String()),
  soloVigentes: t.Optional(t.Boolean()),
});

type FiltrosPantallasVendidas = {
  plataformaId?: string;
  vendedorId?: string;
  codigoCompra?: string;
  correoCuenta?: string;
  soloVigentes?: boolean;
};

function whereDesdeFiltros(query: FiltrosPantallasVendidas): Prisma.VentaDetalleWhereInput {
  const ventaWhere: Prisma.VentaWhereInput = {};
  if (query.vendedorId) ventaWhere.vendedorId = query.vendedorId;
  if (query.codigoCompra) ventaWhere.codigoCompra = { contains: query.codigoCompra, mode: "insensitive" };
  // "Solo vigentes" es un atajo del filtro, no un estado nuevo: misma
  // definición que calcularEstado() === "VIGENTE" (venta no anulada, no
  // reemplazada, no vencida), escrita aquí en SQL para no traer filas de
  // más.
  if (query.soloVigentes) ventaWhere.anulada = false;

  return {
    ...(query.plataformaId ? { plataformaId: query.plataformaId } : {}),
    ...(query.correoCuenta ? { correoCuenta: { contains: query.correoCuenta, mode: "insensitive" } } : {}),
    ...(query.soloVigentes ? { fechaVencimiento: { gt: new Date() }, garantiaOriginal: null } : {}),
    ...(Object.keys(ventaWhere).length > 0 ? { venta: ventaWhere } : {}),
  };
}

type Estado = "VIGENTE" | "VENCIDA" | "REEMPLAZADA" | "VENTA_ANULADA";

function calcularEstado(ventaAnulada: boolean, fueReemplazada: boolean, fechaVencimiento: Date): Estado {
  if (ventaAnulada) return "VENTA_ANULADA";
  if (fueReemplazada) return "REEMPLAZADA";
  if (fechaVencimiento <= new Date()) return "VENCIDA";
  return "VIGENTE";
}

const seleccionComun = {
  id: true,
  plataformaId: true,
  nombrePlataforma: true,
  correoCuenta: true,
  passwordCuenta: true,
  perfil: true,
  pin: true,
  fechaVencimiento: true,
  venta: {
    select: {
      codigoCompra: true,
      anulada: true,
      fechaVenta: true,
      vendedor: { select: { id: true, nombre: true } },
    },
  },
  garantiaReemplazo: { select: { createdAt: true } },
} satisfies Prisma.VentaDetalleSelect;

type FilaComun = Prisma.VentaDetalleGetPayload<{ select: typeof seleccionComun }>;

interface GarantiaOriginalComun {
  id: string;
  motivo: string | null;
  createdAt: Date;
  creadoPor: { id: string; nombre: string };
  ventaDetalleReemplazo: { correoCuenta: string };
}

/** Misma forma de respuesta para ambos roles; `costoAsumido` solo llega
 * cuando `garantiaOriginal` la trajo del select (exclusivo de ADMIN). */
function mapearFila(
  fila: FilaComun & { garantiaOriginal: (GarantiaOriginalComun & { costoAsumido?: Prisma.Decimal }) | null },
) {
  const fueReemplazada = fila.garantiaOriginal !== null;
  const estado = calcularEstado(fila.venta.anulada, fueReemplazada, fila.fechaVencimiento);
  return {
    id: fila.id,
    plataformaId: fila.plataformaId,
    nombrePlataforma: fila.nombrePlataforma,
    correoCuenta: fila.correoCuenta,
    claveCuenta: descifrar(fila.passwordCuenta),
    perfil: fila.perfil,
    pin: fila.pin ? descifrar(fila.pin) : null,
    codigoCompra: fila.venta.codigoCompra,
    vendedor: fila.venta.vendedor,
    fechaEntrega: (fila.garantiaReemplazo?.createdAt ?? fila.venta.fechaVenta).toISOString(),
    fechaVencimiento: fila.fechaVencimiento.toISOString(),
    estado,
    puedeReemplazar: estado === "VIGENTE",
    garantia: fila.garantiaOriginal
      ? {
          id: fila.garantiaOriginal.id,
          motivo: fila.garantiaOriginal.motivo,
          creadoEn: fila.garantiaOriginal.createdAt.toISOString(),
          creadoPor: fila.garantiaOriginal.creadoPor,
          correoCuentaReemplazo: fila.garantiaOriginal.ventaDetalleReemplazo.correoCuenta,
          ...(fila.garantiaOriginal.costoAsumido !== undefined
            ? { costoAsumido: fila.garantiaOriginal.costoAsumido.toString() }
            : {}),
        }
      : null,
  };
}

export const garantias = new Elysia({ prefix: "/garantias" })
  .use(requiereRol(Rol.VENDEDOR))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: { codigo: "SIN_EMPRESA_ACTIVA", mensaje: "Selecciona una empresa antes de continuar." },
      };
    }
  })
  .get(
    "/pantallas-vendidas",
    async ({ contexto, query }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const where = whereDesdeFiltros(query);
      const esAdmin = contexto.rol === Rol.ADMIN || contexto.rol === Rol.SUPER_ADMIN;

      // R4: el costoAsumido de la garantía solo se pide a la base cuando
      // quien consulta es ADMIN — nunca se filtra después de traerlo.
      const filas = esAdmin
        ? await cliente.ventaDetalle.findMany({
            where,
            orderBy: { fechaVencimiento: "desc" },
            select: {
              ...seleccionComun,
              garantiaOriginal: {
                select: {
                  id: true,
                  motivo: true,
                  createdAt: true,
                  costoAsumido: true,
                  creadoPor: { select: { id: true, nombre: true } },
                  ventaDetalleReemplazo: { select: { correoCuenta: true } },
                },
              },
            },
          })
        : await cliente.ventaDetalle.findMany({
            where,
            orderBy: { fechaVencimiento: "desc" },
            select: {
              ...seleccionComun,
              garantiaOriginal: {
                select: {
                  id: true,
                  motivo: true,
                  createdAt: true,
                  creadoPor: { select: { id: true, nombre: true } },
                  ventaDetalleReemplazo: { select: { correoCuenta: true } },
                },
              },
            },
          });

      return { pantallas: filas.map(mapearFila) };
    },
    {
      query: filtrosPantallasVendidas,
      response: { 200: t.Object({ pantallas: t.Array(esquemaPantallaVendida) }) },
    },
  )
  .post(
    "/:id/reemplazar",
    async ({ params, body, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const motivo = body.motivo?.trim() || null;

      let resultado;
      try {
        resultado = await cliente.$transaction((tx) =>
          realizarGarantia(tx, contexto.empresaId!, contexto.usuarioId!, params.id, motivo),
        );
      } catch (error) {
        if (error instanceof GarantiaYaReemplazadaError) {
          set.status = 409;
          return {
            error: { codigo: "YA_REEMPLAZADA", mensaje: "Esta pantalla ya fue reemplazada por otra garantía." },
          };
        }
        throw error;
      }

      if (resultado.tipo === "no_encontrado") {
        set.status = 404;
        return { error: { codigo: "PANTALLA_NO_ENCONTRADA", mensaje: "La pantalla vendida no existe." } };
      }
      if (resultado.tipo === "venta_anulada") {
        set.status = 409;
        return {
          error: { codigo: "VENTA_ANULADA", mensaje: "Esta venta fue anulada; no se puede reemplazar." },
        };
      }
      if (resultado.tipo === "ya_reemplazada") {
        set.status = 409;
        return {
          error: { codigo: "YA_REEMPLAZADA", mensaje: "Esta pantalla ya fue reemplazada por otra garantía." },
        };
      }
      if (resultado.tipo === "sin_inventario") {
        set.status = 409;
        return {
          error: {
            codigo: "SIN_PANTALLAS_DISPONIBLES",
            mensaje: `No hay pantallas disponibles de ${resultado.nombrePlataforma} para hacer el reemplazo.`,
          },
        };
      }

      set.status = 201;
      return { mensajeGenerado: resultado.garantia.mensajeGenerado };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ motivo: t.Optional(t.String()) }),
      response: {
        201: t.Object({ mensajeGenerado: t.String() }),
        404: esquemaError,
        409: esquemaError,
      },
    },
  );
