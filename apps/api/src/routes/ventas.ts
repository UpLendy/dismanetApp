import { Elysia, t } from "elysia";
import { prismaParaEmpresa, datosSinEmpresa } from "../lib/prisma-empresa.ts";
import { Prisma, Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";
import { plataformasDisponibles } from "../lib/pantallas.ts";
import { paquetesDisponibles } from "../lib/paquetes.ts";
import { realizarVenta, type EntradaVenta } from "../lib/ventas.ts";
import { bloquearUsuarioParaVenta } from "../lib/bloqueo-usuario.ts";
import { restriccionViolada } from "../lib/errores.ts";
import {
  inicioDiaBogota,
  inicioMesBogota,
  inicioSemanaBogota,
  finDiaBogota,
  finSemanaBogota,
  finMesBogota,
  inicioMesAnteriorBogota,
  inicioDeFechaBogota,
  finDeFechaBogota,
} from "../lib/periodos.ts";
import { calcularEstadisticas } from "../lib/estadisticas-ventas.ts";

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
  esPromocion: t.Boolean(),
});

// R4: nunca costo/utilidad/margen cuando quien consulta es VENDEDOR, ni
// tampoco precioSugerido (revela el descuento) — el resto de los campos
// (precioVenta, mensajeGenerado, etc.) sí se devuelven.
const esquemaVenta = t.Composite([
  t.Object({
    id: t.String(),
    codigoCompra: t.String(),
    tipoVenta: t.String(),
    nombreItem: t.String(),
    nombreDuracion: t.String(),
    nombreTipoCliente: t.String(),
    precioVenta: t.String(),
    celularCliente: t.Union([t.String(), t.Null()]),
    fechaVenta: t.String(),
    fechaVencimientoMax: t.String(),
    mensajeGenerado: t.String(),
    esPromocion: t.Boolean(),
  }),
  t.Object({
    // F4.4: solo si quien consulta puede descontar (EMPLEADO+) — permite
    // mostrar el descuento aplicado sin exponerlo a VENDEDOR.
    precioSugerido: t.Optional(t.String()),
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
  // F4.4: 1..N plataformas para UNIDAD — reemplaza a plataformaId singular.
  // Repetir un id pide varias pantallas de esa plataforma.
  plataformas: t.Optional(t.Array(t.String(), { minItems: 1 })),
  paqueteId: t.Optional(t.String()),
  duracionId: t.String(),
  tipoClienteId: t.String(),
  // Validación de formato es responsabilidad del frontend (suave, no
  // bloqueante); aquí solo se acepta y se guarda tal cual (R3).
  celularCliente: t.Optional(t.String()),
  // F4.4 Parte 3: ajuste manual del total — solo EMPLEADO+ y solo en
  // ventas de 2+ renglones (ver POST / más abajo). Viaja como string: el
  // dinero nunca se maneja como number flotante (CLAUDE.md).
  precioFinal: t.Optional(t.String()),
});

// Entrega 9 — listado de ventas (secciones 1 y 2).

const esquemaDetalleVenta = t.Object({
  id: t.String(),
  plataformaId: t.String(),
  nombrePlataforma: t.String(),
  correoCuenta: t.Union([t.String(), t.Null()]),
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
  celularCliente: t.Union([t.String(), t.Null()]),
  fechaVenta: t.String(),
  fechaVencimientoMax: t.String(),
  mensajeGenerado: t.String(),
  anulada: t.Boolean(),
  esPromocion: t.Boolean(),
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
  esPromocion: t.Optional(t.Boolean()),
  codigoCompra: t.Optional(t.String()),
  celularCliente: t.Optional(t.String()),
});

/** Filtros comunes a /listado y /codigos (Entrega 10): mismo criterio, para
 * que "copiar códigos" siempre refleje exactamente lo que el filtro activo
 * está mostrando en la pantalla. */
function whereDesdeFiltros(query: {
  desde?: string;
  hasta?: string;
  vendedorId?: string;
  tipoVenta?: "UNIDAD" | "PAQUETE";
  plataformaId?: string;
  paqueteId?: string;
  esPromocion?: boolean;
  codigoCompra?: string;
  celularCliente?: string;
}): Prisma.VentaWhereInput {
  const fechaVenta: Prisma.DateTimeFilter<"Venta"> = {};
  if (query.desde) fechaVenta.gte = new Date(query.desde);
  if (query.hasta) fechaVenta.lte = new Date(query.hasta);

  return {
    // F4.3: una venta externa no es una venta real (es el soporte de una
    // garantía de una venta hecha fuera del sistema) — nunca aparece en
    // /listado ni en /codigos, sin importar el filtro recibido.
    esExterna: false,
    ...(Object.keys(fechaVenta).length > 0 ? { fechaVenta } : {}),
    ...(query.vendedorId ? { vendedorId: query.vendedorId } : {}),
    ...(query.tipoVenta ? { tipoVenta: query.tipoVenta } : {}),
    // F4.4: Venta.plataformaId es null en una venta de 2+ productos (no
    // hay un único id que la represente) — filtrar por el renglón real en
    // VentaDetalle encuentra esas ventas también, no solo las de 1 renglón.
    ...(query.plataformaId ? { detalles: { some: { plataformaId: query.plataformaId } } } : {}),
    ...(query.paqueteId ? { paqueteId: query.paqueteId } : {}),
    // Venta.esPromocion directamente, nunca el paquete relacionado (R3): el
    // paquete pudo dejar de ser promoción después de esta venta.
    ...(query.esPromocion !== undefined ? { esPromocion: query.esPromocion } : {}),
    // Búsqueda por código de compra: es como el cliente final pide
    // soporte, así que debe tolerar mayúsculas/minúsculas y coincidir
    // con un fragmento, no solo con el código completo.
    ...(query.codigoCompra ? { codigoCompra: { contains: query.codigoCompra, mode: "insensitive" } } : {}),
    ...(query.celularCliente ? { celularCliente: { contains: query.celularCliente, mode: "insensitive" } } : {}),
  };
}

const esquemaTotalesPeriodo = t.Object({
  numeroVentas: t.Number(),
  ingresos: t.String(),
  costos: t.String(),
  // Utilidad NETA: ya descuenta perdidaGarantias (punto 4, camino del
  // dinero). perdidaGarantias viaja aparte para que el frontend la muestre
  // como línea secundaria, nunca como una quinta tarjeta.
  utilidad: t.String(),
  perdidaGarantias: t.String(),
});

// F4.5 — estadísticas segmentadas. Ver lib/estadisticas-ventas.ts para el
// cálculo; aquí solo vive la resolución del periodo y la forma HTTP.
const esquemaResumenEstadisticas = t.Object({
  numeroVentas: t.Number(),
  unidadesEntregadas: t.Number(),
  ingresos: t.String(),
  costos: t.String(),
  utilidad: t.String(),
  descuentosOtorgados: t.String(),
  recargosAplicados: t.String(),
  perdidaGarantias: t.String(),
  ventasSinCostoRegistrado: t.Number(),
});

const esquemaSegmentoTipo = t.Object({
  clave: t.String(),
  etiqueta: t.String(),
  numeroVentas: t.Number(),
  unidades: t.Number(),
  ingresos: t.String(),
  costos: t.String(),
  utilidad: t.String(),
});

const esquemaSegmentoPaquete = t.Object({
  paqueteId: t.String(),
  nombre: t.String(),
  numeroVentas: t.Number(),
  unidades: t.Number(),
  ingresos: t.String(),
  costos: t.String(),
  utilidad: t.String(),
});

const esquemaSegmentoVendedor = t.Object({
  vendedorId: t.String(),
  nombre: t.String(),
  numeroVentas: t.Number(),
  unidades: t.Number(),
  ingresos: t.String(),
  costos: t.String(),
  utilidad: t.String(),
  descuentosOtorgados: t.String(),
});

const esquemaSegmentoPlataforma = t.Object({
  plataformaId: t.String(),
  nombre: t.String(),
  unidades: t.Number(),
  ingresoAtribuible: t.String(),
  costoAtribuible: t.String(),
  renglonesSinIngresoAtribuible: t.Number(),
  renglonesSinCostoAtribuible: t.Number(),
  perdidaGarantias: t.String(),
});

const esquemaEstadisticas = t.Object({
  periodo: t.Object({ desde: t.String(), hasta: t.String() }),
  resumen: esquemaResumenEstadisticas,
  porTipo: t.Array(esquemaSegmentoTipo),
  porPaquete: t.Array(esquemaSegmentoPaquete),
  porVendedor: t.Array(esquemaSegmentoVendedor),
  porPlataforma: t.Array(esquemaSegmentoPlataforma),
});

const PRESETS_ESTADISTICAS = ["hoy", "semana", "mes", "mes_anterior"] as const;
type PresetEstadisticas = (typeof PRESETS_ESTADISTICAS)[number];

/**
 * Resuelve el rango [desde, hasta) de /ventas/estadisticas. Un solo
 * endpoint, un solo rango: así las cuatro tablas de la pantalla siempre
 * describen exactamente la misma ventana de tiempo.
 *
 * `desde`/`hasta` explícitos (formato "YYYY-MM-DD", el de un <input
 * type="date">) ganan sobre `preset` y deben venir juntos — un rango libre
 * a medias no tiene un significado razonable. Sin ninguno de los dos, por
 * defecto "mes" (el aterrizaje más útil para una pantalla de estadísticas).
 *
 * Importante — Parte 3 del encargo: esto NO es whereDesdeFiltros() de
 * /listado. Esa función sigue interpretando "desde"/"hasta" como
 * medianoche UTC (bug conocido, pendiente de su propia entrega); esta
 * función nueva sí convierte a medianoche de Bogotá con periodos.ts. Las
 * dos convivirán con comportamiento distinto hasta que /listado se corrija
 * aparte.
 */
function resolverRangoEstadisticas(
  query: { preset?: PresetEstadisticas; desde?: string; hasta?: string },
  ahora: Date,
): { desde: Date; hasta: Date } | null {
  if (query.desde || query.hasta) {
    if (!query.desde || !query.hasta) return null;
    return { desde: inicioDeFechaBogota(query.desde), hasta: finDeFechaBogota(query.hasta) };
  }
  switch (query.preset ?? "mes") {
    case "hoy":
      return { desde: inicioDiaBogota(ahora), hasta: finDiaBogota(ahora) };
    case "semana":
      return { desde: inicioSemanaBogota(ahora), hasta: finSemanaBogota(ahora) };
    case "mes_anterior":
      return { desde: inicioMesAnteriorBogota(ahora), hasta: inicioMesBogota(ahora) };
    case "mes":
      return { desde: inicioMesBogota(ahora), hasta: finMesBogota(ahora) };
  }
}

const esquemaDetalleVentaMap = (detalle: {
  id: string;
  plataformaId: string;
  nombrePlataforma: string;
  correoCuenta: string | null;
  fechaVencimiento: Date;
}) => ({
  id: detalle.id,
  plataformaId: detalle.plataformaId,
  nombrePlataforma: detalle.nombrePlataforma,
  correoCuenta: detalle.correoCuenta,
  fechaVencimiento: detalle.fechaVencimiento.toISOString(),
});

/**
 * Totales (R1: filtrados por empresa vía prismaParaEmpresa) de un período que
 * arranca en `desde`. Punto 4 del camino del dinero: la pérdida de una
 * garantía se descuenta del período en que la GARANTÍA se creó, nunca del
 * de la venta original (R3 — Venta.utilidad no se toca). Por eso agrega
 * Garantia.createdAt, no Venta.fechaVenta.
 */
async function totalesDesde(cliente: Prisma.TransactionClient, desde: Date) {
  const [agregado, agregadoGarantias] = await Promise.all([
    cliente.venta.aggregate({
      // F4.3: esExterna:false — una venta externa no es un ingreso
      // (precioVenta/costo/utilidad ya están en cero), pero numeroVentas sí
      // debe excluirla o el contador de "ventas de hoy" quedaría inflado.
      where: { anulada: false, esExterna: false, fechaVenta: { gte: desde } },
      _count: { _all: true },
      _sum: { precioVenta: true, costo: true, utilidad: true },
    }),
    cliente.garantia.aggregate({
      where: { createdAt: { gte: desde } },
      _sum: { costoAsumido: true },
    }),
  ]);
  const utilidadBruta = new Prisma.Decimal(agregado._sum.utilidad ?? 0);
  const perdidaGarantias = new Prisma.Decimal(agregadoGarantias._sum.costoAsumido ?? 0);
  return {
    numeroVentas: agregado._count._all,
    ingresos: (agregado._sum.precioVenta ?? 0).toString(),
    costos: (agregado._sum.costo ?? 0).toString(),
    utilidad: utilidadBruta.minus(perdidaGarantias).toString(),
    perdidaGarantias: perdidaGarantias.toString(),
  };
}

// Venta rápida (entrega 8, PRD 5.8) — abierta a VENDEDOR (y por jerarquía a
// ADMIN/SUPER_ADMIN). Los selectores GET viven aquí mismo, en vez de exponer
// el catálogo completo (tipos-cliente.ts, duraciones.ts) a VENDEDOR: mismo
// patrón que disponibilidad.ts frente a cuentas.ts — el vendedor ve solo lo
// que necesita para vender, nunca la administración del catálogo.
export const ventas = new Elysia({ prefix: "/ventas" })
  .use(requiereRol(Rol.VENDEDOR))
  .onBeforeHandle(({ contexto, set }) => {
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
      const celularCliente = body.celularCliente?.trim() || null;

      // F4.4 Parte 3 — el ajuste manual del precio se valida siempre en el
      // servidor (R4: ocultar el campo en el frontend no es control de
      // acceso). Una venta de paquete cuenta como 1 renglón (su precio ya
      // es un bloque único de la matriz, no una suma de componentes): el
      // chequeo de "2+ renglones" la rechaza igual, sin una regla aparte.
      let precioFinal: Prisma.Decimal | undefined;
      if (body.precioFinal !== undefined) {
        if (contexto.rol === Rol.VENDEDOR) {
          set.status = 403;
          return {
            error: { codigo: "DESCUENTO_NO_PERMITIDO", mensaje: "No tienes permiso para ajustar el precio de una venta." },
          };
        }
        const numeroRenglones = body.tipoVenta === "UNIDAD" ? (body.plataformas?.length ?? 0) : 1;
        if (numeroRenglones < 2) {
          set.status = 409;
          return {
            error: {
              codigo: "DESCUENTO_SOLO_MULTIPRODUCTO",
              mensaje: "El precio final solo se puede ajustar en una venta de dos o más productos.",
            },
          };
        }
        let valor: Prisma.Decimal;
        try {
          valor = new Prisma.Decimal(body.precioFinal);
        } catch {
          set.status = 409;
          return { error: { codigo: "PRECIO_FINAL_INVALIDO", mensaje: "El precio final no es un número válido." } };
        }
        if (!valor.isFinite() || valor.lessThanOrEqualTo(0)) {
          set.status = 409;
          return { error: { codigo: "PRECIO_FINAL_INVALIDO", mensaje: "El precio final debe ser mayor a cero." } };
        }
        precioFinal = valor;
      }

      const entrada: EntradaVenta =
        body.tipoVenta === "UNIDAD"
          ? {
              tipoVenta: "UNIDAD",
              plataformas: body.plataformas ?? [],
              duracionId: body.duracionId,
              tipoClienteId: body.tipoClienteId,
              celularCliente,
              precioFinal,
            }
          : {
              tipoVenta: "PAQUETE",
              paqueteId: body.paqueteId ?? "",
              duracionId: body.duracionId,
              tipoClienteId: body.tipoClienteId,
              celularCliente,
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
      if (resultado.tipo === "saldo_insuficiente") {
        set.status = 409;
        return {
          error: {
            codigo: "SALDO_INSUFICIENTE",
            mensaje:
              `Esta venta cuesta $${resultado.precioVenta.toString()}. Tu saldo es $${resultado.saldo.toString()}, ` +
              `te faltan $${resultado.falta.toString()}.`,
          },
        };
      }

      const venta = resultado.venta;
      const esAdmin = contexto.rol === Rol.ADMIN || contexto.rol === Rol.SUPER_ADMIN;
      // F4.4 — precioSugerido revela el descuento: solo para quien puede
      // descontar (EMPLEADO+), nunca VENDEDOR (R4).
      const puedeVerDescuento = contexto.rol !== Rol.VENDEDOR;
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
          celularCliente: venta.celularCliente,
          fechaVenta: venta.fechaVenta.toISOString(),
          fechaVencimientoMax: venta.fechaVencimientoMax.toISOString(),
          mensajeGenerado: venta.mensajeGenerado,
          esPromocion: venta.esPromocion,
          ...(puedeVerDescuento ? { precioSugerido: venta.precioSugerido.toString() } : {}),
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
      response: {
        201: t.Object({ venta: esquemaVenta, aviso: t.Optional(esquemaAviso) }),
        403: esquemaError,
        409: esquemaError,
      },
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
        // F4.3: una venta externa no es una venta del vendedor, es el
        // registro de una garantía — no pertenece a este listado.
        where: { vendedorId: contexto.usuarioId!, esExterna: false },
        orderBy: { fechaVenta: "desc" },
        select: {
          id: true,
          codigoCompra: true,
          tipoVenta: true,
          nombreItem: true,
          nombreDuracion: true,
          nombreTipoCliente: true,
          precioVenta: true,
          celularCliente: true,
          fechaVenta: true,
          fechaVencimientoMax: true,
          mensajeGenerado: true,
          anulada: true,
          esPromocion: true,
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
          celularCliente: venta.celularCliente,
          fechaVenta: venta.fechaVenta.toISOString(),
          fechaVencimientoMax: venta.fechaVencimientoMax.toISOString(),
          mensajeGenerado: venta.mensajeGenerado,
          anulada: venta.anulada,
          esPromocion: venta.esPromocion,
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
      const where = whereDesdeFiltros(query);

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
          celularCliente: true,
          costo: true,
          utilidad: true,
          fechaVenta: true,
          fechaVencimientoMax: true,
          mensajeGenerado: true,
          anulada: true,
          anuladaEn: true,
          esPromocion: true,
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
          celularCliente: venta.celularCliente,
          costo: venta.costo.toString(),
          utilidad: venta.utilidad.toString(),
          fechaVenta: venta.fechaVenta.toISOString(),
          fechaVencimientoMax: venta.fechaVencimientoMax.toISOString(),
          mensajeGenerado: venta.mensajeGenerado,
          anulada: venta.anulada,
          anuladaEn: venta.anuladaEn?.toISOString() ?? null,
          esPromocion: venta.esPromocion,
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

  // Entrega 10 — códigos de compra del conjunto filtrado completo, para
  // sorteos. Un código por VENTA (no por pantalla): el campo vive en Venta,
  // así que un paquete que entregó tres pantallas sigue aportando un solo
  // código. Nunca incluye anuladas, sin importar el filtro recibido.
  .get(
    "/codigos",
    async ({ contexto, query }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const where: Prisma.VentaWhereInput = { ...whereDesdeFiltros(query), anulada: false };

      const ventas = await cliente.venta.findMany({
        where,
        orderBy: { fechaVenta: "desc" },
        select: { codigoCompra: true },
      });

      return { codigos: ventas.map((v) => v.codigoCompra) };
    },
    {
      query: filtrosListado,
      response: { 200: t.Object({ codigos: t.Array(t.String()) }) },
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

  // F4.5 — estadísticas segmentadas (ADMIN/SUPER_ADMIN, por la escalada de
  // rol ya aplicada arriba). "Cada tabla reporta su propia cobertura": R4
  // ya queda cubierto por la escalada de .use(requiereRol(Rol.ADMIN)), así
  // que costo/utilidad aquí no necesitan exclusión aparte.
  .get(
    "/estadisticas",
    async ({ contexto, query, set }) => {
      const rango = resolverRangoEstadisticas(query, new Date());
      if (!rango) {
        set.status = 409;
        return {
          error: {
            codigo: "RANGO_INVALIDO",
            mensaje: "Envía 'desde' y 'hasta' juntos para un rango libre, o ninguno para usar el preset.",
          },
        };
      }

      const cliente = prismaParaEmpresa(contexto.empresaId);
      const estadisticas = await calcularEstadisticas(cliente, rango.desde, rango.hasta);

      return {
        // "hasta" se muestra como el último instante incluido (hasta - 1ms),
        // no el límite exclusivo real que usan las consultas: así se lee
        // como un rango cerrado normal ("del 1 al 15"), no uno que parece
        // cortar un milisegundo antes del día 16.
        periodo: { desde: rango.desde.toISOString(), hasta: new Date(rango.hasta.getTime() - 1).toISOString() },
        ...estadisticas,
      };
    },
    {
      query: t.Object({
        preset: t.Optional(
          t.Union([t.Literal("hoy"), t.Literal("semana"), t.Literal("mes"), t.Literal("mes_anterior")]),
        ),
        desde: t.Optional(t.String()),
        hasta: t.Optional(t.String()),
      }),
      response: { 200: esquemaEstadisticas, 409: esquemaError },
    },
  )

  // Entrega 9, sección 3 — anular una venta. R3: nunca se borra, solo se
  // marca; R5 libera las pantallas de inmediato como consecuencia de que
  // la disponibilidad siempre filtra por `venta.anulada: false` (pantallas.ts),
  // no como un paso adicional que haya que ejecutar aquí.
  //
  // Saldo: si la venta consumió saldo (existe un MovimientoSaldo CONSUMO
  // para ella), anular la devuelve — dentro de la MISMA transacción que
  // marca `anulada`, con la fila del usuario bloqueada primero (mismo
  // orden que realizarVenta, ver lib/ventas.ts). El monto que se devuelve
  // sale del movimiento de CONSUMO original, nunca del precio actual de
  // nada. Doble anulación no puede devolver dos veces: el bloqueo de la
  // fila del usuario serializa con cualquier otra anulación concurrente de
  // la misma venta (la segunda ve `anulada: true` al releer tras esperar el
  // lock), y la restricción única (empresaId, ventaId, tipo) es el respaldo
  // en la base si de todos modos coincidieran.
  .patch(
    "/:id/anular",
    async ({ params, contexto, set }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);

      const resultado = await cliente.$transaction(async (tx) => {
        const venta = await tx.venta.findUnique({ where: { id: params.id } });
        if (!venta) return { tipo: "no_encontrada" as const };
        if (venta.anulada) return { tipo: "ya_anulada" as const };
        // F4.3: anular una venta externa liberaría la pantalla del
        // comprador sin que nadie se entere — esa venta no existió para el
        // sistema hasta la garantía, no hay "antes" al que volver.
        if (venta.esExterna) return { tipo: "externa" as const };

        const usuarioBloqueado = await bloquearUsuarioParaVenta(tx, contexto.empresaId!, venta.vendedorId);

        // Releer tras el bloqueo: si otra anulación concurrente de esta
        // misma venta ya terminó mientras esta esperaba la fila del
        // usuario, debe verse reflejado aquí antes de devolver dos veces.
        const ventaFresca = await tx.venta.findUniqueOrThrow({ where: { id: params.id } });
        if (ventaFresca.anulada) return { tipo: "ya_anulada" as const };

        if (usuarioBloqueado) {
          const consumo = await tx.movimientoSaldo.findFirst({ where: { ventaId: venta.id, tipo: "CONSUMO" } });
          if (consumo) {
            const montoDevolucion = consumo.monto.negated();
            const saldoResultante = usuarioBloqueado.saldo.plus(montoDevolucion);
            try {
              await tx.movimientoSaldo.create({
                data: datosSinEmpresa<Prisma.MovimientoSaldoUncheckedCreateInput>({
                  usuarioId: venta.vendedorId,
                  tipo: "DEVOLUCION",
                  monto: montoDevolucion,
                  saldoResultante,
                  ventaId: venta.id,
                  creadoPorId: contexto.usuarioId!,
                }),
              });
              await tx.usuario.update({ where: { id: venta.vendedorId }, data: { saldo: saldoResultante } });
            } catch (error) {
              const esDevolucionDuplicada =
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2002" &&
                restriccionViolada(error).includes("ventaId");
              if (!esDevolucionDuplicada) throw error;
              // Una anulación concurrente ya registró la devolución: no-op,
              // nunca se devuelve el saldo dos veces.
            }
          }
        }

        const actualizada = await tx.venta.update({
          where: { id: params.id },
          data: { anulada: true, anuladaPorId: contexto.usuarioId!, anuladaEn: new Date() },
        });
        return { tipo: "ok" as const, venta: actualizada };
      });

      if (resultado.tipo === "no_encontrada") {
        set.status = 404;
        return { error: { codigo: "VENTA_NO_ENCONTRADA", mensaje: "La venta no existe." } };
      }
      if (resultado.tipo === "ya_anulada") {
        set.status = 409;
        return { error: { codigo: "VENTA_YA_ANULADA", mensaje: "Esta venta ya fue anulada." } };
      }
      if (resultado.tipo === "externa") {
        set.status = 409;
        return {
          error: {
            codigo: "VENTA_EXTERNA_NO_SE_ANULA",
            mensaje: "Esta venta sostiene una garantía externa y no se puede anular.",
          },
        };
      }

      const actualizada = resultado.venta;
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
