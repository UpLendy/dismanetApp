import { Prisma } from "../generated/prisma/client.ts";

// Prisma.TransactionClient (no PrismaClient completo): ver el comentario
// equivalente en pantallas.ts — así esta función acepta tanto
// prismaParaEmpresa(empresaId) como un tx dentro de una transacción.
type ClienteEmpresa = Prisma.TransactionClient;

export interface ResumenEstadisticas {
  numeroVentas: number;
  unidadesEntregadas: number;
  ingresos: string;
  costos: string;
  // Utilidad NETA (ya descuenta perdidaGarantias), mismo criterio que
  // totalesDesde() en routes/ventas.ts.
  utilidad: string;
  descuentosOtorgados: string;
  recargosAplicados: string;
  perdidaGarantias: string;
  ventasSinCostoRegistrado: number;
}

export interface SegmentoTipo {
  clave: string;
  etiqueta: string;
  numeroVentas: number;
  unidades: number;
  ingresos: string;
  costos: string;
  utilidad: string;
}

export interface SegmentoPaquete {
  paqueteId: string;
  nombre: string;
  numeroVentas: number;
  unidades: number;
  ingresos: string;
  costos: string;
  utilidad: string;
}

export interface SegmentoVendedor {
  vendedorId: string;
  nombre: string;
  numeroVentas: number;
  unidades: number;
  ingresos: string;
  costos: string;
  utilidad: string;
  descuentosOtorgados: string;
}

export interface SegmentoPlataforma {
  plataformaId: string;
  nombre: string;
  unidades: number;
  ingresoAtribuible: string;
  costoAtribuible: string;
  renglonesSinIngresoAtribuible: number;
  renglonesSinCostoAtribuible: number;
  perdidaGarantias: string;
}

export interface Estadisticas {
  resumen: ResumenEstadisticas;
  porTipo: SegmentoTipo[];
  porPaquete: SegmentoPaquete[];
  porVendedor: SegmentoVendedor[];
  porPlataforma: SegmentoPlataforma[];
}

const CERO = new Prisma.Decimal(0);

function claveTipo(venta: { tipoVenta: string; esPromocion: boolean }): { clave: string; etiqueta: string } {
  if (venta.tipoVenta !== "PAQUETE") return { clave: "UNIDAD", etiqueta: "Unidad" };
  if (venta.esPromocion) return { clave: "PROMOCION", etiqueta: "Promoción" };
  return { clave: "PAQUETE", etiqueta: "Paquete" };
}

interface Acumulador {
  numeroVentas: number;
  unidades: number;
  ingresos: Prisma.Decimal;
  costos: Prisma.Decimal;
  utilidad: Prisma.Decimal;
  descuentosOtorgados: Prisma.Decimal;
}

function acumuladorVacio(): Acumulador {
  return { numeroVentas: 0, unidades: 0, ingresos: CERO, costos: CERO, utilidad: CERO, descuentosOtorgados: CERO };
}

function sumarEnAcumulador(
  acumulador: Acumulador,
  venta: { precioVenta: Prisma.Decimal; costo: Prisma.Decimal; utilidad: Prisma.Decimal; descuento: Prisma.Decimal },
  unidades: number,
): Acumulador {
  return {
    numeroVentas: acumulador.numeroVentas + 1,
    unidades: acumulador.unidades + unidades,
    ingresos: acumulador.ingresos.plus(venta.precioVenta),
    costos: acumulador.costos.plus(venta.costo),
    utilidad: acumulador.utilidad.plus(venta.utilidad),
    descuentosOtorgados: venta.descuento.greaterThan(0)
      ? acumulador.descuentosOtorgados.plus(venta.descuento)
      : acumulador.descuentosOtorgados,
  };
}

/**
 * Estadísticas de ventas de la empresa en [desde, hasta) — ambos límites ya
 * resueltos a instantes UTC reales por quien llama (ver lib/periodos.ts),
 * esta función no sabe nada de zonas horarias.
 *
 * R1: `cliente` debe ser el resultado de prismaParaEmpresa(empresaId) — toda
 * consulta de aquí abajo queda filtrada por esa empresa sin excepción.
 *
 * Nada de SQL crudo ni de un groupBy mixto: las sumas condicionales
 * (descuento vs. recargo, costo nulo vs. cero) no se pueden expresar en un
 * solo aggregate de Prisma porque comparan dos columnas de la MISMA fila,
 * así que se trae el conjunto de ventas/renglones del periodo con findMany
 * (ya filtrado por la extensión de empresa) y se combina en TypeScript —
 * exactamente lo que CLAUDE.md pide para este caso.
 */
export async function calcularEstadisticas(cliente: ClienteEmpresa, desde: Date, hasta: Date): Promise<Estadisticas> {
  const whereVentasPeriodo: Prisma.VentaWhereInput = {
    anulada: false,
    esExterna: false,
    fechaVenta: { gte: desde, lt: hasta },
  };

  const [ventas, detalles, garantias] = await Promise.all([
    cliente.venta.findMany({
      where: whereVentasPeriodo,
      select: {
        id: true,
        tipoVenta: true,
        esPromocion: true,
        paqueteId: true,
        paquete: { select: { nombre: true } },
        vendedorId: true,
        vendedor: { select: { nombre: true } },
        nombreItem: true,
        precioSugerido: true,
        precioVenta: true,
        costo: true,
        utilidad: true,
      },
    }),
    cliente.ventaDetalle.findMany({
      where: { venta: whereVentasPeriodo },
      select: { ventaId: true, plataformaId: true, nombrePlataforma: true, precioSugerido: true, costo: true },
    }),
    cliente.garantia.findMany({
      where: { createdAt: { gte: desde, lt: hasta } },
      select: {
        costoAsumido: true,
        ventaDetalleReemplazo: { select: { plataformaId: true, nombrePlataforma: true } },
      },
    }),
  ]);

  // Unidades por venta (para porTipo/porPaquete/porVendedor) y ventas con
  // algún renglón sin costo registrado (null, no cero — ver comentario de
  // VentaDetalle.costo en schema.prisma).
  const unidadesPorVenta = new Map<string, number>();
  const ventasConCostoFaltante = new Set<string>();
  for (const detalle of detalles) {
    unidadesPorVenta.set(detalle.ventaId, (unidadesPorVenta.get(detalle.ventaId) ?? 0) + 1);
    if (detalle.costo === null) ventasConCostoFaltante.add(detalle.ventaId);
  }

  const porTipoMapa = new Map<string, Acumulador>();
  const porPaqueteMapa = new Map<string, { nombre: string; acumulador: Acumulador }>();
  const porVendedorMapa = new Map<string, { nombre: string; acumulador: Acumulador }>();

  let ingresos = CERO;
  let costos = CERO;
  let utilidadBruta = CERO;
  let descuentosOtorgados = CERO;
  let recargosAplicados = CERO;

  for (const venta of ventas) {
    const unidades = unidadesPorVenta.get(venta.id) ?? 0;
    const descuento = venta.precioSugerido.minus(venta.precioVenta);
    const ventaConDescuento = { precioVenta: venta.precioVenta, costo: venta.costo, utilidad: venta.utilidad, descuento };

    ingresos = ingresos.plus(venta.precioVenta);
    costos = costos.plus(venta.costo);
    utilidadBruta = utilidadBruta.plus(venta.utilidad);
    if (descuento.greaterThan(0)) descuentosOtorgados = descuentosOtorgados.plus(descuento);
    else if (descuento.lessThan(0)) recargosAplicados = recargosAplicados.plus(descuento.negated());

    const { clave, etiqueta } = claveTipo(venta);
    porTipoMapa.set(clave, sumarEnAcumulador(porTipoMapa.get(clave) ?? acumuladorVacio(), ventaConDescuento, unidades));
    void etiqueta;

    if (venta.paqueteId) {
      const nombre = venta.paquete?.nombre ?? venta.nombreItem;
      const actual = porPaqueteMapa.get(venta.paqueteId) ?? { nombre, acumulador: acumuladorVacio() };
      porPaqueteMapa.set(venta.paqueteId, {
        nombre,
        acumulador: sumarEnAcumulador(actual.acumulador, ventaConDescuento, unidades),
      });
    }

    const nombreVendedor = venta.vendedor.nombre;
    const actualVendedor = porVendedorMapa.get(venta.vendedorId) ?? { nombre: nombreVendedor, acumulador: acumuladorVacio() };
    porVendedorMapa.set(venta.vendedorId, {
      nombre: nombreVendedor,
      acumulador: sumarEnAcumulador(actualVendedor.acumulador, ventaConDescuento, unidades),
    });
  }

  // Siempre los tres tipos, aunque el periodo no tenga ventas de alguno: una
  // tabla con filas que aparecen y desaparecen según los datos es más
  // confusa que una con ceros explícitos.
  const etiquetaPorClave: Record<string, string> = { UNIDAD: "Unidad", PAQUETE: "Paquete", PROMOCION: "Promoción" };
  const porTipo: SegmentoTipo[] = (["UNIDAD", "PAQUETE", "PROMOCION"] as const).map((clave) => {
    const acumulador = porTipoMapa.get(clave) ?? acumuladorVacio();
    return {
      clave,
      etiqueta: etiquetaPorClave[clave],
      numeroVentas: acumulador.numeroVentas,
      unidades: acumulador.unidades,
      ingresos: acumulador.ingresos.toString(),
      costos: acumulador.costos.toString(),
      utilidad: acumulador.utilidad.toString(),
    };
  });

  const porPaquete: SegmentoPaquete[] = Array.from(porPaqueteMapa.entries())
    .map(([paqueteId, { nombre, acumulador }]) => ({
      paqueteId,
      nombre,
      numeroVentas: acumulador.numeroVentas,
      unidades: acumulador.unidades,
      ingresos: acumulador.ingresos.toString(),
      costos: acumulador.costos.toString(),
      utilidad: acumulador.utilidad.toString(),
    }))
    .sort((a, b) => b.numeroVentas - a.numeroVentas);

  const porVendedor: SegmentoVendedor[] = Array.from(porVendedorMapa.entries())
    .map(([vendedorId, { nombre, acumulador }]) => ({
      vendedorId,
      nombre,
      numeroVentas: acumulador.numeroVentas,
      unidades: acumulador.unidades,
      ingresos: acumulador.ingresos.toString(),
      costos: acumulador.costos.toString(),
      utilidad: acumulador.utilidad.toString(),
      descuentosOtorgados: acumulador.descuentosOtorgados.toString(),
    }))
    .sort((a, b) => b.numeroVentas - a.numeroVentas);

  // Plataforma: unidades siempre completas (cada VentaDetalle tiene
  // plataformaId); ingreso/costo son parciales — null no entra en la suma
  // como cero, cuenta en su propio contador de renglones sin dato.
  interface AcumuladorPlataforma {
    nombre: string;
    unidades: number;
    ingresoAtribuible: Prisma.Decimal;
    costoAtribuible: Prisma.Decimal;
    renglonesSinIngresoAtribuible: number;
    renglonesSinCostoAtribuible: number;
    perdidaGarantias: Prisma.Decimal;
  }
  const porPlataformaMapa = new Map<string, AcumuladorPlataforma>();
  function entradaPlataforma(id: string, nombre: string): AcumuladorPlataforma {
    let entrada = porPlataformaMapa.get(id);
    if (!entrada) {
      entrada = {
        nombre,
        unidades: 0,
        ingresoAtribuible: CERO,
        costoAtribuible: CERO,
        renglonesSinIngresoAtribuible: 0,
        renglonesSinCostoAtribuible: 0,
        perdidaGarantias: CERO,
      };
      porPlataformaMapa.set(id, entrada);
    }
    return entrada;
  }

  for (const detalle of detalles) {
    const entrada = entradaPlataforma(detalle.plataformaId, detalle.nombrePlataforma);
    entrada.unidades += 1;
    if (detalle.precioSugerido === null) entrada.renglonesSinIngresoAtribuible += 1;
    else entrada.ingresoAtribuible = entrada.ingresoAtribuible.plus(detalle.precioSugerido);
    if (detalle.costo === null) entrada.renglonesSinCostoAtribuible += 1;
    else entrada.costoAtribuible = entrada.costoAtribuible.plus(detalle.costo);
  }

  let perdidaGarantiasTotal = CERO;
  for (const garantia of garantias) {
    perdidaGarantiasTotal = perdidaGarantiasTotal.plus(garantia.costoAsumido);
    const entrada = entradaPlataforma(
      garantia.ventaDetalleReemplazo.plataformaId,
      garantia.ventaDetalleReemplazo.nombrePlataforma,
    );
    entrada.perdidaGarantias = entrada.perdidaGarantias.plus(garantia.costoAsumido);
  }

  const porPlataforma: SegmentoPlataforma[] = Array.from(porPlataformaMapa.entries())
    .map(([plataformaId, entrada]) => ({
      plataformaId,
      nombre: entrada.nombre,
      unidades: entrada.unidades,
      ingresoAtribuible: entrada.ingresoAtribuible.toString(),
      costoAtribuible: entrada.costoAtribuible.toString(),
      renglonesSinIngresoAtribuible: entrada.renglonesSinIngresoAtribuible,
      renglonesSinCostoAtribuible: entrada.renglonesSinCostoAtribuible,
      perdidaGarantias: entrada.perdidaGarantias.toString(),
    }))
    .sort((a, b) => b.unidades - a.unidades);

  const utilidadNeta = utilidadBruta.minus(perdidaGarantiasTotal);

  const resumen: ResumenEstadisticas = {
    numeroVentas: ventas.length,
    unidadesEntregadas: detalles.length,
    ingresos: ingresos.toString(),
    costos: costos.toString(),
    utilidad: utilidadNeta.toString(),
    descuentosOtorgados: descuentosOtorgados.toString(),
    recargosAplicados: recargosAplicados.toString(),
    perdidaGarantias: perdidaGarantiasTotal.toString(),
    ventasSinCostoRegistrado: ventasConCostoFaltante.size,
  };

  return { resumen, porTipo, porPaquete, porVendedor, porPlataforma };
}
