import { Elysia, t } from "elysia";
import { prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { plataformasDisponibles } from "../lib/pantallas.ts";
import { paquetesDisponibles } from "../lib/paquetes.ts";
import { realizarVenta, type EntradaVenta } from "../lib/ventas.ts";
import { inicioDiaBogota, inicioMesBogota, inicioSemanaBogota } from "../lib/periodos.ts";

const esquemaError = t.Object({
  error: t.Object({ codigo: t.String(), mensaje: t.String() }),
});

const esquemaTipoCliente = t.Object({ id: t.String(), nombre: t.String() });
const esquemaDuracion = t.Object({ id: t.String(), nombre: t.String(), cantidad: t.Number(), unidad: t.String() });

const esquemaPlataformaDisponible = t.Object({
  id: t.String(),
  nombre: t.String(),
  condiciones: t.Union([t.String(), t.Null()]),
  pantallasLibres: t.Number(),
  precioVenta: t.String(),
});

const esquemaPaqueteDisponible = t.Object({
  id: t.String(),
  nombre: t.String(),
  precioVenta: t.String(),
});

// R4: nunca costo/utilidad/margen cuando quien consulta es VENDEDOR. El
// resto de los campos (precioVenta, mensajeGenerado, etc.) sí se devuelven.
const esquemaVenta = t.Composite([
  t.Object({
    id: t.String(),
    codigoCompra: t.String(),
    tipoVenta: t.String(),
    nombreItem: t.String(),
    nombreDuracion: t.String(),
    nombreTipoCliente: t.String(),
    precioVenta: t.String(),
    fechaVenta: t.String(),
    fechaVencimientoMax: t.String(),
    mensajeGenerado: t.String(),
  }),
  t.Object({
    costo: t.Optional(t.String()),
    utilidad: t.Optional(t.String()),
  }),
]);

// Cuando la empresa no tiene configurada su PlantillaMensaje para este tipo
// de venta, realizarVenta() ya completó la venta con la plantilla de
// respaldo (ver lib/ventas.ts) — este aviso es lo único que distingue esa
// respuesta de una normal, para que la pantalla lo muestre encima del
// mensaje con un enlace a (admin)/panel/mensajes.
const esquemaAviso = t.Object({ codigo: t.String(), mensaje: t.String() });

const cuerpoVenta = t.Object({
  tipoVenta: t.Union([t.Literal("UNIDAD"), t.Literal("PAQUETE")]),
  plataformaId: t.Optional(t.String()),
  paqueteId: t.Optional(t.String()),
  duracionId: t.String(),
  tipoClienteId: t.String(),
});

// Entrega 9 — listado de ventas (secciones 1 y 2).

const esquemaDetalleVenta = t.Object({
  id: t.String(),
  plataformaId: t.String(),
  nombrePlataforma: t.String(),
  correoCuenta: t.String(),
  fechaVencimiento: t.String(),
});

const camposComunesListado = {
  id: t.String(),
  codigoCompra: t.String(),
  tipoVenta: t.String(),
  nombreItem: t.String(),
  nombreDuracion: t.String(),
  nombreTipoCliente: t.String(),
  precioVenta: t.String(),
  fechaVenta: t.String(),
  fechaVencimientoMax: t.String(),
  mensajeGenerado: t.String(),
  anulada: t.Boolean(),
  detalles: t.Array(esquemaDetalleVenta),
};

// R4: sin costo/utilidad/margen en ningún campo — a diferencia de
// esquemaVenta (POST /), este tipo no los declara ni siquiera como
// opcionales, porque el select de Prisma de /mias jamás los trae.
const esquemaVentaListadoVendedor = t.Object(camposComunesListado);

const esquemaVentaListadoAdmin = t.Object({
  ...camposComunesListado,
  costo: t.String(),
  utilidad: t.String(),
  anuladaEn: t.Union([t.String(), t.Null()]),
  vendedor: t.Object({ id: t.String(), nombre: t.String() }),
  anuladaPor: t.Union([t.Object({ id: t.String(), nombre: t.String() }), t.Null()]),
});

const filtrosListado = t.Object({
  desde: t.Optional(t.String()),
  hasta: t.Optional(t.String()),
  vendedorId: t.Optional(t.String()),
  tipoVenta: t.Optional(t.Union([t.Literal("UNIDAD"), t.Literal("PAQUETE")])),
  plataformaId: t.Optional(t.String()),
  paqueteId: t.Optional(t.String()),
  codigoCompra: t.Optional(t.String()),
});

const esquemaTotalesPeriodo = t.Object({
  numeroVentas: t.Number(),
  ingresos: t.String(),
  costos: t.String(),
  utilidad: t.String(),
});

const esquemaDetalleVentaMap = (detalle: {
  id: string;
  plataformaId: string;
  nombrePlataforma: string;
  correoCuenta: string;
  fechaVencimiento: Date;
}) => ({
  id: detalle.id,
  plataformaId: detalle.plataformaId,
  nombrePlataforma: detalle.nombrePlataforma,
  correoCuenta: detalle.correoCuenta,
  fechaVencimiento: detalle.fechaVencimiento.toISOString(),
});

/** Totales (R1: filtrados por empresa vía prismaParaEmpresa) de un período que arranca en `desde`. */
async function totalesDesde(cliente: Prisma.TransactionClient, desde: Date) {
  const agregado = await cliente.venta.aggregate({
    where: { anulada: false, fechaVenta: { gte: desde } },
    _count: { _all: true },
    _sum: { precioVenta: true, costo: true, utilidad: true },
  });
  return {
    numeroVentas: agregado._count._all,
    ingresos: (agregado._sum.precioVenta ?? 0).toString(),
    costos: (agregado._sum.costo ?? 0).toString(),
    utilidad: (agregado._sum.utilidad ?? 0).toString(),
  };
}

// Venta rápida (entrega 8, PRD 5.8) — abierta a VENDEDOR (y por jerarquía a
// ADMIN/SUPER_ADMIN). Los selectores GET viven aquí mismo, en vez de exponer
// el catálogo completo (tipos-cliente.ts, duraciones.ts) a VENDEDOR: mismo
// patrón que disponibilidad.ts frente a cuentas.ts — el vendedor ve solo lo
// que necesita para vender, nunca la administración del catálogo.
export const ventas = new Elysia({ prefix: "/ventas" })
  .use(requiereRol(Rol.VENDEDOR))
  .onBeforeHandle({ as: "scoped" }, ({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: { codigo: "SIN_EMPRESA_ACTIVA", mensaje: "Selecciona una empresa antes de vender." },
      };
    }
  })
  .get(
    "/tipos-cliente",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const filas = await cliente.tipoCliente.findMany({
        where: { activo: true },
        orderBy: { nombre: "asc" },
        select: { id: true, nombre: true },
      });
      return { tiposCliente: filas };
    },
    { response: { 200: t.Object({ tiposCliente: t.Array(esquemaTipoCliente) }) } },
  )
  .get(
    "/duraciones",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const filas = await cliente.duracion.findMany({
        where: { activa: true },
        orderBy: { cantidad: "asc" },
        select: { id: true, nombre: true, cantidad: true, unidad: true },
      });
      return { duraciones: filas };
    },
    { response: { 200: t.Object({ duraciones: t.Array(esquemaDuracion) }) } },
  )
  .get(
    "/plataformas",
    async ({ contexto, query }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const disponibles = await plataformasDisponibles(cliente, query.duracionId, query.tipoClienteId);
      if (disponibles.length === 0) return { plataformas: [] };

      const precios = await cliente.precio.findMany({
        where: {
          activo: true,
          duracionId: query.duracionId,
          tipoClienteId: query.tipoClienteId,
          plataformaId: { in: disponibles.map((p) => p.id) },
        },
        select: { plataformaId: true, precioVenta: true },
      });
      const precioPorPlataforma = new Map(precios.map((p) => [p.plataformaId, p.precioVenta]));

      return {
        plataformas: disponibles.map((p) => ({
          ...p,
          precioVenta: (precioPorPlataforma.get(p.id) ?? "0").toString(),
        })),
      };
    },
    {
      query: t.Object({ duracionId: t.String(), tipoClienteId: t.String() }),
      response: { 200: t.Object({ plataformas: t.Array(esquemaPlataformaDisponible) }) },
    },
  )
  .get(
    "/paquetes",
    async ({ contexto, query }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const disponibles = await paquetesDisponibles(cliente, query.duracionId, query.tipoClienteId);
      if (disponibles.length === 0) return { paquetes: [] };

      const precios = await cliente.precio.findMany({
        where: {
          activo: true,
          duracionId: query.duracionId,
          tipoClienteId: query.tipoClienteId,
          paqueteId: { in: disponibles.map((p) => p.id) },
        },
        select: { paqueteId: true, precioVenta: true },
      });
      const precioPorPaquete = new Map(precios.map((p) => [p.paqueteId, p.precioVenta]));

      return {
        paquetes: disponibles.map((p) => ({
          ...p,
          precioVenta: (precioPorPaquete.get(p.id) ?? "0").toString(),
        })),
      };
    },
    {
      query: t.Object({ duracionId: t.String(), tipoClienteId: t.String() }),
      response: { 200: t.Object({ paquetes: t.Array(esquemaPaqueteDisponible) }) },
    },
  )
  .post(
    "/",
    async ({ body, contexto, set }) => {
      const entrada: EntradaVenta =
        body.tipoVenta === "UNIDAD"
          ? {
              tipoVenta: "UNIDAD",
              plataformaId: body.plataformaId ?? "",
              duracionId: body.duracionId,
              tipoClienteId: body.tipoClienteId,
            }
          : {
              tipoVenta: "PAQUETE",
              paqueteId: body.paqueteId ?? "",
              duracionId: body.duracionId,
              tipoClienteId: body.tipoClienteId,
            };

      const cliente = prismaParaEmpresa(contexto.empresaId);
      const resultado = await cliente.$transaction((tx) =>
        realizarVenta(tx, contexto.empresaId!, contexto.usuarioId!, entrada),
      );

      if (resultado.tipo === "no_disponible") {
        set.status = 409;
        return { error: { codigo: "ITEM_NO_DISPONIBLE", mensaje: resultado.mensaje } };
      }
      if (resultado.tipo === "inventario_insuficiente") {
        set.status = 409;
        return {
          error: {
            codigo: "INVENTARIO_INSUFICIENTE",
            mensaje: `No hay suficientes pantallas libres de ${resultado.nombrePlataforma}.`,
          },
        };
      }

      const venta = resultado.venta;
      const esAdmin = contexto.rol === Rol.ADMIN || contexto.rol === Rol.SUPER_ADMIN;
      set.status = 201;
      return {
        venta: {
          id: venta.id,
          codigoCompra: venta.codigoCompra,
          tipoVenta: venta.tipoVenta,
          nombreItem: venta.nombreItem,
          nombreDuracion: venta.nombreDuracion,
          nombreTipoCliente: venta.nombreTipoCliente,
          precioVenta: venta.precioVenta.toString(),
          fechaVenta: venta.fechaVenta.toISOString(),
          fechaVencimientoMax: venta.fechaVencimientoMax.toISOString(),
          mensajeGenerado: venta.mensajeGenerado,
          ...(esAdmin ? { costo: venta.costo.toString(), utilidad: venta.utilidad.toString() } : {}),
        },
        ...(resultado.plantillaFaltante
          ? {
              aviso: {
                codigo: "PLANTILLA_NO_CONFIGURADA",
                mensaje: esAdmin
                  ? "Esta empresa no tiene configurado el mensaje de venta; se usó un mensaje de respaldo. Configúralo en Mensajes."
                  : "Esta empresa no tiene configurado el mensaje de venta; se usó un mensaje de respaldo. Pide al administrador que lo configure.",
              },
            }
          : {}),
      };
    },
    {
      body: cuerpoVenta,
      response: { 201: t.Object({ venta: esquemaVenta, aviso: t.Optional(esquemaAviso) }), 409: esquemaError },
    },
  )

  // Entrega 9, sección 2 — el VENDEDOR ve solo sus propias ventas. R4: el
  // select de abajo NUNCA pide costo/utilidad, así que no hay nada que
  // excluir después — no pueden "escaparse" por un cambio futuro al mapeo.
  .get(
    "/mias",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const ventas = await cliente.venta.findMany({
        where: { vendedorId: contexto.usuarioId! },
        orderBy: { fechaVenta: "desc" },
        select: {
          id: true,
          codigoCompra: true,
          tipoVenta: true,
          nombreItem: true,
          nombreDuracion: true,
          nombreTipoCliente: true,
          precioVenta: true,
          fechaVenta: true,
          fechaVencimientoMax: true,
          mensajeGenerado: true,
          anulada: true,
          detalles: {
            select: { id: true, plataformaId: true, nombrePlataforma: true, correoCuenta: true, fechaVencimiento: true },
          },
        },
      });

      return {
        ventas: ventas.map((venta) => ({
          id: venta.id,
          codigoCompra: venta.codigoCompra,
          tipoVenta: venta.tipoVenta,
          nombreItem: venta.nombreItem,
          nombreDuracion: venta.nombreDuracion,
          nombreTipoCliente: venta.nombreTipoCliente,
          precioVenta: venta.precioVenta.toString(),
          fechaVenta: venta.fechaVenta.toISOString(),
          fechaVencimientoMax: venta.fechaVencimientoMax.toISOString(),
          mensajeGenerado: venta.mensajeGenerado,
          anulada: venta.anulada,
          detalles: venta.detalles.map(esquemaDetalleVentaMap),
        })),
      };
    },
    { response: { 200: t.Object({ ventas: t.Array(esquemaVentaListadoVendedor) }) } },
  )

  // Todo lo demás (listado completo con cifras, totales, anular) es
  // exclusivo de ADMIN — mismo patrón de escalada de rol que empresas.ts.
  .use(requiereRol(Rol.ADMIN))

  // Entrega 9, sección 1 — listado completo de la empresa, con filtros.
  .get(
    "/listado",
    async ({ contexto, query }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);

      const fechaVenta: Prisma.DateTimeFilter<"Venta"> = {};
      if (query.desde) fechaVenta.gte = new Date(query.desde);
      if (query.hasta) fechaVenta.lte = new Date(query.hasta);

      const where: Prisma.VentaWhereInput = {
        ...(Object.keys(fechaVenta).length > 0 ? { fechaVenta } : {}),
        ...(query.vendedorId ? { vendedorId: query.vendedorId } : {}),
        ...(query.tipoVenta ? { tipoVenta: query.tipoVenta } : {}),
        ...(query.plataformaId ? { plataformaId: query.plataformaId } : {}),
        ...(query.paqueteId ? { paqueteId: query.paqueteId } : {}),
        // Búsqueda por código de compra: es como el cliente final pide
        // soporte, así que debe tolerar mayúsculas/minúsculas y coincidir
        // con un fragmento, no solo con el código completo.
        ...(query.codigoCompra ? { codigoCompra: { contains: query.codigoCompra, mode: "insensitive" } } : {}),
      };

      const ventas = await cliente.venta.findMany({
        where,
        orderBy: { fechaVenta: "desc" },
        select: {
          id: true,
          codigoCompra: true,
          tipoVenta: true,
          nombreItem: true,
          nombreDuracion: true,
          nombreTipoCliente: true,
          precioVenta: true,
          costo: true,
          utilidad: true,
          fechaVenta: true,
          fechaVencimientoMax: true,
          mensajeGenerado: true,
          anulada: true,
          anuladaEn: true,
          vendedor: { select: { id: true, nombre: true } },
          anuladaPor: { select: { id: true, nombre: true } },
          detalles: {
            select: { id: true, plataformaId: true, nombrePlataforma: true, correoCuenta: true, fechaVencimiento: true },
          },
        },
      });

      return {
        ventas: ventas.map((venta) => ({
          id: venta.id,
          codigoCompra: venta.codigoCompra,
          tipoVenta: venta.tipoVenta,
          nombreItem: venta.nombreItem,
          nombreDuracion: venta.nombreDuracion,
          nombreTipoCliente: venta.nombreTipoCliente,
          precioVenta: venta.precioVenta.toString(),
          costo: venta.costo.toString(),
          utilidad: venta.utilidad.toString(),
          fechaVenta: venta.fechaVenta.toISOString(),
          fechaVencimientoMax: venta.fechaVencimientoMax.toISOString(),
          mensajeGenerado: venta.mensajeGenerado,
          anulada: venta.anulada,
          anuladaEn: venta.anuladaEn?.toISOString() ?? null,
          vendedor: venta.vendedor,
          anuladaPor: venta.anuladaPor,
          detalles: venta.detalles.map(esquemaDetalleVentaMap),
        })),
      };
    },
    {
      query: filtrosListado,
      response: { 200: t.Object({ ventas: t.Array(esquemaVentaListadoAdmin) }) },
    },
  )

  // Entrega 9, sección 1 — totales de hoy/semana/mes. aggregate() corre
  // sobre el cliente extendido (prismaParaEmpresa), así que el where que
  // la extensión inyecta garantiza que nunca cruza empresas (R1, probado
  // desde la Entrega 6 en prisma-empresa.test.ts).
  .get(
    "/totales",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const ahora = new Date();
      const [hoy, semana, mes] = await Promise.all([
        totalesDesde(cliente, inicioDiaBogota(ahora)),
        totalesDesde(cliente, inicioSemanaBogota(ahora)),
        totalesDesde(cliente, inicioMesBogota(ahora)),
      ]);
      return { hoy, semana, mes };
    },
    {
      response: {
        200: t.Object({ hoy: esquemaTotalesPeriodo, semana: esquemaTotalesPeriodo, mes: esquemaTotalesPeriodo }),
      },
    },
  )

  // Entrega 9, sección 3 — anular una venta. R3: nunca se borra, solo se
  // marca; R5 libera las pantallas de inmediato como consecuencia de que
  // la disponibilidad siempre filtra por `venta.anulada: false` (pantallas.ts),
  // no como un paso adicional que haya que ejecutar aquí.
  .patch(
    "/:id/anular",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const venta = await cliente.venta.findUnique({ where: { id: params.id } });
      if (!venta) {
        set.status = 404;
        return { error: { codigo: "VENTA_NO_ENCONTRADA", mensaje: "La venta no existe." } };
      }
      if (venta.anulada) {
        set.status = 409;
        return { error: { codigo: "VENTA_YA_ANULADA", mensaje: "Esta venta ya fue anulada." } };
      }

      const actualizada = await cliente.venta.update({
        where: { id: params.id },
        data: { anulada: true, anuladaPorId: contexto.usuarioId!, anuladaEn: new Date() },
      });

      return {
        venta: {
          id: actualizada.id,
          anulada: actualizada.anulada,
          anuladaEn: actualizada.anuladaEn!.toISOString(),
          anuladaPorId: actualizada.anuladaPorId!,
        },
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({
          venta: t.Object({
            id: t.String(),
            anulada: t.Boolean(),
            anuladaEn: t.String(),
            anuladaPorId: t.String(),
          }),
        }),
        404: esquemaError,
        409: esquemaError,
      },
    },
  );
