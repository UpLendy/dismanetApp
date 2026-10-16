import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
// prismaRaw: arma la fixture (empresa, plataformas, usuarios, paquete,
// cuenta, pantalla) y crea Venta/VentaDetalle/Garantia directamente con
// fechas y montos exactos, fuera de cualquier contexto de empresa
// autenticado — mismo patrón que prisma-empresa.test.ts/ventas.test.ts.
// calcularEstadisticas() en sí siempre corre sobre prismaParaEmpresa().
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { calcularEstadisticas } from "./estadisticas-ventas.ts";
import { inicioMesBogota, finMesBogota } from "./periodos.ts";

interface FixtureEmpresa {
  empresaId: string;
  vendedorAId: string;
  vendedorBId: string;
  plataformaNetflixId: string;
  plataformaDisneyId: string;
  paqueteId: string;
  pantallaNetflixId: string;
  cuentaNetflixId: string;
  pantallaDisneyId: string;
  cuentaDisneyId: string;
  duracionId: string;
}

async function crearFixture(etiqueta: string): Promise<FixtureEmpresa> {
  // prefijoCodigo es @db.VarChar(3) y único — un slice de un UUID evita
  // colisiones entre los dos empresas de la prueba de R1 (y entre corridas).
  const prefijo = randomUUID().slice(0, 3).toUpperCase();
  const empresa = await prismaRaw.empresa.create({
    data: { nombre: `Empresa estadísticas ${etiqueta}`, prefijoCodigo: prefijo },
  });
  const empresaId = empresa.id;

  const vendedorA = await prismaRaw.usuario.create({
    data: { empresaId, email: `vendedor-a-${randomUUID()}@test.local`, passwordHash: "hash", nombre: "Vendedor A", rol: "VENDEDOR" },
  });
  const vendedorB = await prismaRaw.usuario.create({
    data: { empresaId, email: `vendedor-b-${randomUUID()}@test.local`, passwordHash: "hash", nombre: "Vendedor B", rol: "VENDEDOR" },
  });

  const netflix = await prismaRaw.plataforma.create({
    data: { empresaId, nombre: `Netflix (${prefijo})`, capacidadPantallas: 10, usaPerfilPin: false },
  });
  const disney = await prismaRaw.plataforma.create({
    data: { empresaId, nombre: `Disney+ (${prefijo})`, capacidadPantallas: 10, usaPerfilPin: false },
  });

  const cuentaNetflix = await prismaRaw.cuenta.create({
    data: { empresaId, plataformaId: netflix.id, correo: `netflix-${randomUUID()}@test.local`, password: "cifrado", capacidadPantallas: 10 },
  });
  const pantallaNetflix = await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaNetflix.id, numero: 1 } });

  const cuentaDisney = await prismaRaw.cuenta.create({
    data: { empresaId, plataformaId: disney.id, correo: `disney-${randomUUID()}@test.local`, password: "cifrado", capacidadPantallas: 10 },
  });
  const pantallaDisney = await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaDisney.id, numero: 1 } });

  const duracion = await prismaRaw.duracion.create({
    data: { empresaId, nombre: `30 días (${prefijo})`, cantidad: 30, unidad: "DIAS" },
  });

  const paquete = await prismaRaw.paquete.create({ data: { empresaId, nombre: `Básico 1 (${prefijo})` } });

  return {
    empresaId,
    vendedorAId: vendedorA.id,
    vendedorBId: vendedorB.id,
    plataformaNetflixId: netflix.id,
    plataformaDisneyId: disney.id,
    paqueteId: paquete.id,
    pantallaNetflixId: pantallaNetflix.id,
    cuentaNetflixId: cuentaNetflix.id,
    pantallaDisneyId: pantallaDisney.id,
    cuentaDisneyId: cuentaDisney.id,
    duracionId: duracion.id,
  };
}

async function borrarFixture(empresaId: string) {
  await prismaRaw.garantia.deleteMany({ where: { empresaId } });
  await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
  await prismaRaw.venta.deleteMany({ where: { empresaId } });
  await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
  await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
  await prismaRaw.paquete.deleteMany({ where: { empresaId } });
  await prismaRaw.duracion.deleteMany({ where: { empresaId } });
  await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
  await prismaRaw.usuario.deleteMany({ where: { empresaId } });
  await prismaRaw.empresa.delete({ where: { id: empresaId } });
}

interface OpcionesVenta {
  vendedorId: string;
  tipoVenta?: "UNIDAD" | "PAQUETE";
  paqueteId?: string;
  esPromocion?: boolean;
  esExterna?: boolean;
  anulada?: boolean;
  precioSugerido: string;
  precioVenta: string;
  costo: string;
  utilidad: string;
  fechaVenta: Date;
  duracionId: string;
}

async function crearVenta(empresaId: string, opciones: OpcionesVenta) {
  return prismaRaw.venta.create({
    data: {
      empresaId,
      vendedorId: opciones.vendedorId,
      codigoCompra: `EST-${randomUUID().slice(0, 8)}`,
      tipoVenta: opciones.tipoVenta ?? "UNIDAD",
      paqueteId: opciones.paqueteId,
      duracionId: opciones.duracionId,
      esExterna: opciones.esExterna ?? false,
      esPromocion: opciones.esPromocion ?? false,
      anulada: opciones.anulada ?? false,
      nombreItem: "Item de prueba",
      nombreDuracion: "30 días",
      cantidadDuracion: 30,
      unidadDuracion: "DIAS",
      nombreTipoCliente: "Nuevo",
      precioSugerido: opciones.precioSugerido,
      precioVenta: opciones.precioVenta,
      costo: opciones.costo,
      utilidad: opciones.utilidad,
      fechaVenta: opciones.fechaVenta,
      fechaVencimientoMax: new Date(opciones.fechaVenta.getTime() + 30 * 24 * 60 * 60 * 1000),
      mensajeGenerado: "Mensaje de prueba",
    },
  });
}

interface OpcionesDetalle {
  ventaId: string;
  plataformaId: string;
  pantallaId: string;
  cuentaId: string;
  nombrePlataforma: string;
  precioSugerido: string | null;
  costo: string | null;
  fechaVencimiento: Date;
}

async function crearDetalle(empresaId: string, duracionId: string, opciones: OpcionesDetalle) {
  return prismaRaw.ventaDetalle.create({
    data: {
      empresaId,
      ventaId: opciones.ventaId,
      pantallaId: opciones.pantallaId,
      cuentaId: opciones.cuentaId,
      plataformaId: opciones.plataformaId,
      nombrePlataforma: opciones.nombrePlataforma,
      correoCuenta: "cliente@test.local",
      passwordCuenta: "cifrado",
      duracionId,
      cantidadDuracion: 30,
      unidadDuracion: "DIAS",
      fechaVencimiento: opciones.fechaVencimiento,
      precioSugerido: opciones.precioSugerido,
      costo: opciones.costo,
    },
  });
}

describe("calcularEstadisticas", () => {
  let f: FixtureEmpresa;

  beforeAll(async () => {
    f = await crearFixture("EST1");
  });

  afterAll(async () => {
    await borrarFixture(f.empresaId);
  });

  it("R1: dos empresas con ventas en el mismo periodo — ninguna estadística de una incluye a la otra, en ningún segmento", async () => {
    const otra = await crearFixture("EST1B");
    try {
      const desde = new Date("2031-01-01T00:00:00.000Z");
      const hasta = new Date("2031-02-01T00:00:00.000Z");

      // Empresa A: una venta UNIDAD normal.
      const ventaA = await crearVenta(f.empresaId, {
        vendedorId: f.vendedorAId,
        precioSugerido: "10000",
        precioVenta: "10000",
        costo: "4000",
        utilidad: "6000",
        fechaVenta: new Date("2031-01-05T12:00:00.000Z"),
        duracionId: f.duracionId,
      });
      await crearDetalle(f.empresaId, f.duracionId, {
        ventaId: ventaA.id,
        plataformaId: f.plataformaNetflixId,
        pantallaId: f.pantallaNetflixId,
        cuentaId: f.cuentaNetflixId,
        nombrePlataforma: "Netflix",
        precioSugerido: "10000",
        costo: "4000",
        fechaVencimiento: new Date("2031-02-05T00:00:00.000Z"),
      });

      // Empresa B (otra): una venta UNIDAD mucho más grande, mismo periodo exacto.
      const ventaB = await crearVenta(otra.empresaId, {
        vendedorId: otra.vendedorAId,
        precioSugerido: "999999",
        precioVenta: "999999",
        costo: "500000",
        utilidad: "499999",
        fechaVenta: new Date("2031-01-06T12:00:00.000Z"),
        duracionId: otra.duracionId,
      });
      await crearDetalle(otra.empresaId, otra.duracionId, {
        ventaId: ventaB.id,
        plataformaId: otra.plataformaNetflixId,
        pantallaId: otra.pantallaNetflixId,
        cuentaId: otra.cuentaNetflixId,
        nombrePlataforma: "Netflix",
        precioSugerido: "999999",
        costo: "500000",
        fechaVencimiento: new Date("2031-02-06T00:00:00.000Z"),
      });

      const statsA = await calcularEstadisticas(prismaParaEmpresa(f.empresaId), desde, hasta);
      const statsB = await calcularEstadisticas(prismaParaEmpresa(otra.empresaId), desde, hasta);

      expect(statsA.resumen.numeroVentas).toBe(1);
      expect(statsA.resumen.ingresos).toBe("10000");
      expect(statsB.resumen.numeroVentas).toBe(1);
      expect(statsB.resumen.ingresos).toBe("999999");

      expect(statsA.porTipo.find((t) => t.clave === "UNIDAD")!.ingresos).toBe("10000");
      expect(statsB.porTipo.find((t) => t.clave === "UNIDAD")!.ingresos).toBe("999999");

      expect(statsA.porVendedor.map((v) => v.ingresos)).toEqual(["10000"]);
      expect(statsB.porVendedor.map((v) => v.ingresos)).toEqual(["999999"]);

      const plataformaA = statsA.porPlataforma.find((p) => p.plataformaId === f.plataformaNetflixId)!;
      expect(plataformaA.ingresoAtribuible).toBe("10000");
      const plataformaB = statsB.porPlataforma.find((p) => p.plataformaId === otra.plataformaNetflixId)!;
      expect(plataformaB.ingresoAtribuible).toBe("999999");

      // Ningún id de empresa B aparece en los segmentos de A.
      expect(statsA.porVendedor.some((v) => v.vendedorId === otra.vendedorAId)).toBe(false);
      expect(statsA.porPlataforma.some((p) => p.plataformaId === otra.plataformaNetflixId)).toBe(false);
    } finally {
      await borrarFixture(otra.empresaId);
    }
  });

  it("nulo no es cero: una venta previa a F4.4 (costo nulo) y una posterior en el mismo periodo — costoAtribuible solo suma la segunda", async () => {
    const desde = new Date("2031-03-01T00:00:00.000Z");
    const hasta = new Date("2031-04-01T00:00:00.000Z");

    const ventaVieja = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorAId,
      precioSugerido: "8000",
      precioVenta: "8000",
      costo: "0",
      utilidad: "8000",
      fechaVenta: new Date("2031-03-02T12:00:00.000Z"),
      duracionId: f.duracionId,
    });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: ventaVieja.id,
      plataformaId: f.plataformaNetflixId,
      pantallaId: f.pantallaNetflixId,
      cuentaId: f.cuentaNetflixId,
      nombrePlataforma: "Netflix",
      precioSugerido: null,
      costo: null,
      fechaVencimiento: new Date("2031-04-02T00:00:00.000Z"),
    });

    const ventaNueva = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorAId,
      precioSugerido: "9000",
      precioVenta: "9000",
      costo: "3000",
      utilidad: "6000",
      fechaVenta: new Date("2031-03-03T12:00:00.000Z"),
      duracionId: f.duracionId,
    });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: ventaNueva.id,
      plataformaId: f.plataformaNetflixId,
      pantallaId: f.pantallaNetflixId,
      cuentaId: f.cuentaNetflixId,
      nombrePlataforma: "Netflix",
      precioSugerido: "9000",
      costo: "3000",
      fechaVencimiento: new Date("2031-04-03T00:00:00.000Z"),
    });

    const stats = await calcularEstadisticas(prismaParaEmpresa(f.empresaId), desde, hasta);
    const netflix = stats.porPlataforma.find((p) => p.plataformaId === f.plataformaNetflixId)!;

    expect(netflix.unidades).toBe(2);
    expect(netflix.costoAtribuible).toBe("3000");
    expect(netflix.renglonesSinCostoAtribuible).toBe(1);
    expect(netflix.ingresoAtribuible).toBe("9000");
    expect(netflix.renglonesSinIngresoAtribuible).toBe(1);
    expect(stats.resumen.ventasSinCostoRegistrado).toBe(1);
  });

  it("una venta de paquete no aporta ingresoAtribuible a ninguna plataforma, sí aporta unidades y costo", async () => {
    const desde = new Date("2031-05-01T00:00:00.000Z");
    const hasta = new Date("2031-06-01T00:00:00.000Z");

    const ventaPaquete = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorAId,
      tipoVenta: "PAQUETE",
      paqueteId: f.paqueteId,
      precioSugerido: "15000",
      precioVenta: "15000",
      costo: "6000",
      utilidad: "9000",
      fechaVenta: new Date("2031-05-10T12:00:00.000Z"),
      duracionId: f.duracionId,
    });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: ventaPaquete.id,
      plataformaId: f.plataformaNetflixId,
      pantallaId: f.pantallaNetflixId,
      cuentaId: f.cuentaNetflixId,
      nombrePlataforma: "Netflix",
      precioSugerido: null, // F4.4: el precio de un paquete no se atribuye por plataforma.
      costo: "3000",
      fechaVencimiento: new Date("2031-06-10T00:00:00.000Z"),
    });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: ventaPaquete.id,
      plataformaId: f.plataformaDisneyId,
      pantallaId: f.pantallaDisneyId,
      cuentaId: f.cuentaDisneyId,
      nombrePlataforma: "Disney+",
      precioSugerido: null,
      costo: "3000",
      fechaVencimiento: new Date("2031-06-10T00:00:00.000Z"),
    });

    const stats = await calcularEstadisticas(prismaParaEmpresa(f.empresaId), desde, hasta);
    const netflix = stats.porPlataforma.find((p) => p.plataformaId === f.plataformaNetflixId)!;
    const disney = stats.porPlataforma.find((p) => p.plataformaId === f.plataformaDisneyId)!;

    for (const plataforma of [netflix, disney]) {
      expect(plataforma.unidades).toBe(1);
      expect(plataforma.ingresoAtribuible).toBe("0");
      expect(plataforma.renglonesSinIngresoAtribuible).toBe(1);
      expect(plataforma.costoAtribuible).toBe("3000");
      expect(plataforma.renglonesSinCostoAtribuible).toBe(0);
    }

    const paquete = stats.porPaquete.find((p) => p.paqueteId === f.paqueteId)!;
    expect(paquete.ingresos).toBe("15000");
    expect(paquete.unidades).toBe(2);
  });

  it("multi-producto: Netflix+Disney+ aporta ingreso a las dos con su precio de catálogo; el descuento aparece una sola vez en el resumen", async () => {
    const desde = new Date("2031-07-01T00:00:00.000Z");
    const hasta = new Date("2031-08-01T00:00:00.000Z");

    // Catálogo: Netflix 6000 + Disney+ 5000 = 11000 sugerido; se vendió en 10000 (descuento de 1000).
    const venta = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorAId,
      precioSugerido: "11000",
      precioVenta: "10000",
      costo: "5000",
      utilidad: "5000",
      fechaVenta: new Date("2031-07-10T12:00:00.000Z"),
      duracionId: f.duracionId,
    });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: venta.id,
      plataformaId: f.plataformaNetflixId,
      pantallaId: f.pantallaNetflixId,
      cuentaId: f.cuentaNetflixId,
      nombrePlataforma: "Netflix",
      precioSugerido: "6000",
      costo: "2500",
      fechaVencimiento: new Date("2031-08-10T00:00:00.000Z"),
    });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: venta.id,
      plataformaId: f.plataformaDisneyId,
      pantallaId: f.pantallaDisneyId,
      cuentaId: f.cuentaDisneyId,
      nombrePlataforma: "Disney+",
      precioSugerido: "5000",
      costo: "2500",
      fechaVencimiento: new Date("2031-08-10T00:00:00.000Z"),
    });

    const stats = await calcularEstadisticas(prismaParaEmpresa(f.empresaId), desde, hasta);
    const netflix = stats.porPlataforma.find((p) => p.plataformaId === f.plataformaNetflixId)!;
    const disney = stats.porPlataforma.find((p) => p.plataformaId === f.plataformaDisneyId)!;

    expect(netflix.ingresoAtribuible).toBe("6000");
    expect(disney.ingresoAtribuible).toBe("5000");
    expect(stats.resumen.descuentosOtorgados).toBe("1000");
    expect(stats.resumen.numeroVentas).toBe(1);
  });

  it("descuento y recargo no se netean: un periodo con descuento de 2000 y recargo de 500 reporta ambos por separado", async () => {
    const desde = new Date("2031-09-01T00:00:00.000Z");
    const hasta = new Date("2031-10-01T00:00:00.000Z");

    // Descuento de 2000: sugerido 10000, vendido en 8000.
    await crearVenta(f.empresaId, {
      vendedorId: f.vendedorAId,
      precioSugerido: "10000",
      precioVenta: "8000",
      costo: "3000",
      utilidad: "5000",
      fechaVenta: new Date("2031-09-05T12:00:00.000Z"),
      duracionId: f.duracionId,
    });
    // Recargo de 500: sugerido 4000, vendido en 4500.
    await crearVenta(f.empresaId, {
      vendedorId: f.vendedorAId,
      precioSugerido: "4000",
      precioVenta: "4500",
      costo: "1500",
      utilidad: "3000",
      fechaVenta: new Date("2031-09-06T12:00:00.000Z"),
      duracionId: f.duracionId,
    });

    const stats = await calcularEstadisticas(prismaParaEmpresa(f.empresaId), desde, hasta);
    expect(stats.resumen.descuentosOtorgados).toBe("2000");
    expect(stats.resumen.recargosAplicados).toBe("500");
  });

  it("garantías: la pérdida cae en el periodo de la garantía, no en el de la venta; una garantía externa aporta pérdida sin ingresos ni número de ventas", async () => {
    const desdeMes1 = new Date("2031-11-01T00:00:00.000Z");
    const hastaMes1 = new Date("2031-12-01T00:00:00.000Z");
    const desdeMes2 = new Date("2031-12-01T00:00:00.000Z");
    const hastaMes2 = new Date("2032-01-01T00:00:00.000Z");

    const venta = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorAId,
      precioSugerido: "10000",
      precioVenta: "10000",
      costo: "4000",
      utilidad: "6000",
      fechaVenta: new Date("2031-11-10T12:00:00.000Z"),
      duracionId: f.duracionId,
    });
    const detalleOriginal = await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: venta.id,
      plataformaId: f.plataformaNetflixId,
      pantallaId: f.pantallaNetflixId,
      cuentaId: f.cuentaNetflixId,
      nombrePlataforma: "Netflix",
      precioSugerido: "10000",
      costo: "4000",
      fechaVencimiento: new Date("2031-12-10T00:00:00.000Z"),
    });
    const detalleReemplazo = await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: venta.id,
      plataformaId: f.plataformaNetflixId,
      pantallaId: f.pantallaNetflixId,
      cuentaId: f.cuentaNetflixId,
      nombrePlataforma: "Netflix",
      precioSugerido: null,
      costo: null,
      fechaVencimiento: new Date("2031-12-15T00:00:00.000Z"),
    });
    await prismaRaw.garantia.create({
      data: {
        empresaId: f.empresaId,
        ventaDetalleOriginalId: detalleOriginal.id,
        ventaDetalleReemplazoId: detalleReemplazo.id,
        costoAsumido: "4000",
        mensajeGenerado: "Garantía de prueba",
        creadoPorId: f.vendedorAId,
        createdAt: new Date("2031-12-05T12:00:00.000Z"), // mes 2, no el mes de la venta.
      },
    });

    // Garantía externa: sin venta/detalle original, solo el detalle de reemplazo entregado.
    const ventaExterna = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorAId,
      esExterna: true,
      precioSugerido: "0",
      precioVenta: "0",
      costo: "0",
      utilidad: "0",
      fechaVenta: new Date("2031-12-06T12:00:00.000Z"),
      duracionId: f.duracionId,
    });
    const detalleExterno = await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: ventaExterna.id,
      plataformaId: f.plataformaDisneyId,
      pantallaId: f.pantallaDisneyId,
      cuentaId: f.cuentaDisneyId,
      nombrePlataforma: "Disney+",
      precioSugerido: null,
      costo: null,
      fechaVencimiento: new Date("2031-12-20T00:00:00.000Z"),
    });
    await prismaRaw.garantia.create({
      data: {
        empresaId: f.empresaId,
        ventaDetalleReemplazoId: detalleExterno.id,
        costoAsumido: "2000",
        mensajeGenerado: "Garantía externa de prueba",
        creadoPorId: f.vendedorAId,
        esExterna: true,
        createdAt: new Date("2031-12-07T12:00:00.000Z"),
      },
    });

    const statsMes1 = await calcularEstadisticas(prismaParaEmpresa(f.empresaId), desdeMes1, hastaMes1);
    const statsMes2 = await calcularEstadisticas(prismaParaEmpresa(f.empresaId), desdeMes2, hastaMes2);

    // La venta original (ingresos) cuenta en mes 1; la pérdida de la
    // garantía normal + la externa caen en mes 2.
    expect(statsMes1.resumen.perdidaGarantias).toBe("0");
    expect(statsMes1.resumen.ingresos).toBe("10000");

    expect(statsMes2.resumen.perdidaGarantias).toBe("6000"); // 4000 + 2000
    expect(statsMes2.resumen.ingresos).toBe("0"); // la venta externa no es ingreso (esExterna:false excluida).
    expect(statsMes2.resumen.numeroVentas).toBe(0); // la venta externa no cuenta como venta.

    const netflixMes2 = statsMes2.porPlataforma.find((p) => p.plataformaId === f.plataformaNetflixId)!;
    expect(netflixMes2.perdidaGarantias).toBe("4000");
    const disneyMes2 = statsMes2.porPlataforma.find((p) => p.plataformaId === f.plataformaDisneyId)!;
    expect(disneyMes2.perdidaGarantias).toBe("2000");
  });

  it("ventas anuladas y externas quedan fuera de todos los segmentos", async () => {
    const desde = new Date("2032-02-01T00:00:00.000Z");
    const hasta = new Date("2032-03-01T00:00:00.000Z");

    const ventaAnulada = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorAId,
      anulada: true,
      precioSugerido: "10000",
      precioVenta: "10000",
      costo: "4000",
      utilidad: "6000",
      fechaVenta: new Date("2032-02-10T12:00:00.000Z"),
      duracionId: f.duracionId,
    });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: ventaAnulada.id,
      plataformaId: f.plataformaNetflixId,
      pantallaId: f.pantallaNetflixId,
      cuentaId: f.cuentaNetflixId,
      nombrePlataforma: "Netflix",
      precioSugerido: "10000",
      costo: "4000",
      fechaVencimiento: new Date("2032-03-10T00:00:00.000Z"),
    });

    const ventaExterna = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorAId,
      esExterna: true,
      precioSugerido: "0",
      precioVenta: "0",
      costo: "0",
      utilidad: "0",
      fechaVenta: new Date("2032-02-11T12:00:00.000Z"),
      duracionId: f.duracionId,
    });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: ventaExterna.id,
      plataformaId: f.plataformaDisneyId,
      pantallaId: f.pantallaDisneyId,
      cuentaId: f.cuentaDisneyId,
      nombrePlataforma: "Disney+",
      precioSugerido: "5000",
      costo: "2000",
      fechaVencimiento: new Date("2032-03-11T00:00:00.000Z"),
    });

    const stats = await calcularEstadisticas(prismaParaEmpresa(f.empresaId), desde, hasta);
    expect(stats.resumen.numeroVentas).toBe(0);
    expect(stats.resumen.unidadesEntregadas).toBe(0);
    expect(stats.porPlataforma).toEqual([]);
  });

  it("zona horaria: una venta a las 23:00 Bogotá del último día del mes entra en el mes, no en el siguiente", async () => {
    const ahoraDentroDelMes = new Date("2032-04-15T12:00:00.000Z");
    const desde = inicioMesBogota(ahoraDentroDelMes);
    const hasta = finMesBogota(ahoraDentroDelMes);

    // 2032-04-30 23:00 Bogotá = 2032-05-01T04:00:00.000Z.
    const ventaTardia = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorAId,
      precioSugerido: "7000",
      precioVenta: "7000",
      costo: "2000",
      utilidad: "5000",
      fechaVenta: new Date("2032-05-01T04:00:00.000Z"),
      duracionId: f.duracionId,
    });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: ventaTardia.id,
      plataformaId: f.plataformaNetflixId,
      pantallaId: f.pantallaNetflixId,
      cuentaId: f.cuentaNetflixId,
      nombrePlataforma: "Netflix",
      precioSugerido: "7000",
      costo: "2000",
      fechaVencimiento: new Date("2032-06-01T00:00:00.000Z"),
    });

    const statsAbril = await calcularEstadisticas(prismaParaEmpresa(f.empresaId), desde, hasta);
    expect(statsAbril.resumen.numeroVentas).toBe(1);
    expect(statsAbril.resumen.ingresos).toBe("7000");

    const statsMayo = await calcularEstadisticas(
      prismaParaEmpresa(f.empresaId),
      hasta,
      finMesBogota(new Date("2032-05-15T12:00:00.000Z")),
    );
    expect(statsMayo.resumen.numeroVentas).toBe(0);
  });
});
