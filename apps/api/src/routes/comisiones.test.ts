import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw: arma la fixture (empresa, usuarios, plataformas, cuentas,
// pantallas) y crea Venta/VentaDetalle directamente con fechas y precios
// exactos, fuera de cualquier contexto de empresa autenticado — mismo
// patrón que estadisticas-ventas.test.ts/reportes.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { comisiones } from "./comisiones.ts";

const CONTRASENA = "Clave#Segura123";

async function iniciarSesion(email: string): Promise<string> {
  const respuesta = await auth.handle(
    new Request("http://local/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: CONTRASENA }),
    }),
  );
  const setCookie = respuesta.headers.get("set-cookie");
  if (!setCookie) throw new Error(`Login falló para ${email}: ${await respuesta.text()}`);
  return setCookie.split(";")[0];
}

async function peticion(metodo: string, ruta: string, cookie: string, cuerpo?: unknown) {
  const respuesta = await comisiones.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

interface FixtureEmpresa {
  empresaId: string;
  cookieAdmin: string;
  cookieEmpleado: string;
  cookieVendedor: string;
  vendedorId: string;
  plataformaNetflixId: string;
  plataformaDisneyId: string;
  cuentaNetflixId: string;
  pantallaNetflixId: string;
  cuentaDisneyId: string;
  pantallaDisneyId: string;
  duracionId: string;
}

async function crearFixture(etiqueta: string): Promise<FixtureEmpresa> {
  const prefijo = randomUUID().slice(0, 3).toUpperCase();
  const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

  const empresa = await prismaRaw.empresa.create({
    data: { nombre: `Empresa comisiones ${etiqueta}`, prefijoCodigo: prefijo },
  });
  const empresaId = empresa.id;

  const adminEmail = `admin-comisiones-${randomUUID()}@test.local`;
  await prismaRaw.usuario.create({
    data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
  });
  const cookieAdmin = await iniciarSesion(adminEmail);

  const empleadoEmail = `empleado-comisiones-${randomUUID()}@test.local`;
  await prismaRaw.usuario.create({
    data: { empresaId, email: empleadoEmail, passwordHash: hash, nombre: "Empleado", rol: "EMPLEADO" },
  });
  const cookieEmpleado = await iniciarSesion(empleadoEmail);

  const vendedorEmail = `vendedor-comisiones-${randomUUID()}@test.local`;
  const vendedor = await prismaRaw.usuario.create({
    data: { empresaId, email: vendedorEmail, passwordHash: hash, nombre: "Vendedor", rol: "VENDEDOR" },
  });
  const cookieVendedor = await iniciarSesion(vendedorEmail);

  const netflix = await prismaRaw.plataforma.create({
    data: { empresaId, nombre: `Netflix (${prefijo})`, capacidadPantallas: 50, usaPerfilPin: false },
  });
  const disney = await prismaRaw.plataforma.create({
    data: { empresaId, nombre: `Disney+ (${prefijo})`, capacidadPantallas: 50, usaPerfilPin: false },
  });

  const cuentaNetflix = await prismaRaw.cuenta.create({
    data: { empresaId, plataformaId: netflix.id, correo: `netflix-${randomUUID()}@test.local`, password: "cifrado", capacidadPantallas: 50 },
  });
  const pantallaNetflix = await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaNetflix.id, numero: 1 } });

  const cuentaDisney = await prismaRaw.cuenta.create({
    data: { empresaId, plataformaId: disney.id, correo: `disney-${randomUUID()}@test.local`, password: "cifrado", capacidadPantallas: 50 },
  });
  const pantallaDisney = await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaDisney.id, numero: 1 } });

  const duracion = await prismaRaw.duracion.create({
    data: { empresaId, nombre: `30 días (${prefijo})`, cantidad: 30, unidad: "DIAS" },
  });

  return {
    empresaId,
    cookieAdmin,
    cookieEmpleado,
    cookieVendedor,
    vendedorId: vendedor.id,
    plataformaNetflixId: netflix.id,
    plataformaDisneyId: disney.id,
    cuentaNetflixId: cuentaNetflix.id,
    pantallaNetflixId: pantallaNetflix.id,
    cuentaDisneyId: cuentaDisney.id,
    pantallaDisneyId: pantallaDisney.id,
    duracionId: duracion.id,
  };
}

async function borrarFixture(empresaId: string) {
  await prismaRaw.configuracionComision.deleteMany({ where: { empresaId } });
  await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
  await prismaRaw.venta.deleteMany({ where: { empresaId } });
  await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
  await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
  await prismaRaw.duracion.deleteMany({ where: { empresaId } });
  await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
  await prismaRaw.usuario.deleteMany({ where: { empresaId } });
  await prismaRaw.empresa.delete({ where: { id: empresaId } });
}

interface OpcionesVenta {
  vendedorId: string;
  tipoVenta?: "UNIDAD" | "PAQUETE";
  esExterna?: boolean;
  anulada?: boolean;
  precioVenta: string;
  fechaVenta: Date;
  duracionId: string;
}

async function crearVenta(empresaId: string, opciones: OpcionesVenta) {
  return prismaRaw.venta.create({
    data: {
      empresaId,
      vendedorId: opciones.vendedorId,
      codigoCompra: `COM-${randomUUID().slice(0, 8)}`,
      tipoVenta: opciones.tipoVenta ?? "UNIDAD",
      duracionId: opciones.duracionId,
      esExterna: opciones.esExterna ?? false,
      anulada: opciones.anulada ?? false,
      nombreItem: "Item de prueba",
      nombreDuracion: "30 días",
      cantidadDuracion: 30,
      unidadDuracion: "DIAS",
      nombreTipoCliente: "Nuevo",
      precioSugerido: opciones.precioVenta,
      precioVenta: opciones.precioVenta,
      costo: "0",
      utilidad: opciones.precioVenta,
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
      nombrePlataforma: "Plataforma de prueba",
      passwordCuenta: "cifrado",
      duracionId,
      cantidadDuracion: 30,
      unidadDuracion: "DIAS",
      fechaVencimiento: opciones.fechaVencimiento,
    },
  });
}

async function crearVariosDetalles(
  empresaId: string,
  duracionId: string,
  ventaId: string,
  plataformaId: string,
  cuentaId: string,
  pantallaId: string,
  cantidad: number,
  fechaVencimiento: Date,
) {
  for (let i = 0; i < cantidad; i++) {
    await crearDetalle(empresaId, duracionId, { ventaId, plataformaId, cuentaId, pantallaId, fechaVencimiento });
  }
}

function urlSimulacion(parametros: Record<string, string>): string {
  return `/comisiones/simulacion?${new URLSearchParams(parametros).toString()}`;
}

describe("Configuración de comisiones (F6.5)", () => {
  let f: FixtureEmpresa;

  beforeAll(async () => {
    f = await crearFixture("CFG");
  });

  afterAll(async () => {
    await borrarFixture(f.empresaId);
  });

  it("GET /comisiones/configuracion devuelve null antes de guardar nada", async () => {
    const respuesta = await peticion("GET", "/comisiones/configuracion", f.cookieAdmin);
    expect(respuesta.status).toBe(200);
    expect(respuesta.cuerpo.configuracion).toBeNull();
  });

  it("PUT valida el valor y el umbral antes de guardar: porcentaje fuera de (0,100], monto fijo no positivo, umbral negativo", async () => {
    const porcentajeCero = await peticion("PUT", "/comisiones/configuracion", f.cookieAdmin, {
      modo: "PORCENTAJE_VENTA",
      valor: "0",
      umbralCantidad: 10,
      umbralAmbito: "TOTAL",
      umbralPeriodo: "DIA",
    });
    expect(porcentajeCero.status).toBe(400);
    expect(porcentajeCero.cuerpo.error.codigo).toBe("VALOR_INVALIDO");

    const porcentajeAlto = await peticion("PUT", "/comisiones/configuracion", f.cookieAdmin, {
      modo: "PORCENTAJE_VENTA",
      valor: "150",
      umbralCantidad: 10,
      umbralAmbito: "TOTAL",
      umbralPeriodo: "DIA",
    });
    expect(porcentajeAlto.status).toBe(400);
    expect(porcentajeAlto.cuerpo.error.codigo).toBe("VALOR_INVALIDO");

    const fijoCero = await peticion("PUT", "/comisiones/configuracion", f.cookieAdmin, {
      modo: "FIJO_POR_PANTALLA",
      valor: "0",
      umbralCantidad: 10,
      umbralAmbito: "TOTAL",
      umbralPeriodo: "DIA",
    });
    expect(fijoCero.status).toBe(400);
    expect(fijoCero.cuerpo.error.codigo).toBe("VALOR_INVALIDO");

    const umbralNegativo = await peticion("PUT", "/comisiones/configuracion", f.cookieAdmin, {
      modo: "FIJO_POR_PANTALLA",
      valor: "1000",
      umbralCantidad: -1,
      umbralAmbito: "TOTAL",
      umbralPeriodo: "DIA",
    });
    expect(umbralNegativo.status).not.toBe(201);

    // Nada de lo anterior debió quedar guardado.
    const vigente = await peticion("GET", "/comisiones/configuracion", f.cookieAdmin);
    expect(vigente.cuerpo.configuracion).toBeNull();
  });

  it("guardar dos veces crea dos filas; la vigente es la última y la anterior sigue consultable en el historial", async () => {
    const primera = await peticion("PUT", "/comisiones/configuracion", f.cookieAdmin, {
      modo: "FIJO_POR_PANTALLA",
      valor: "1000",
      umbralCantidad: 10,
      umbralAmbito: "TOTAL",
      umbralPeriodo: "DIA",
    });
    expect(primera.status).toBe(201);
    const idPrimera = primera.cuerpo.configuracion.id;

    const segunda = await peticion("PUT", "/comisiones/configuracion", f.cookieAdmin, {
      modo: "PORCENTAJE_VENTA",
      valor: "15",
      umbralCantidad: 5,
      umbralAmbito: "POR_PLATAFORMA",
      umbralPeriodo: "MES",
    });
    expect(segunda.status).toBe(201);
    const idSegunda = segunda.cuerpo.configuracion.id;
    expect(idSegunda).not.toBe(idPrimera);

    const vigente = await peticion("GET", "/comisiones/configuracion", f.cookieAdmin);
    expect(vigente.cuerpo.configuracion.id).toBe(idSegunda);
    expect(vigente.cuerpo.configuracion.modo).toBe("PORCENTAJE_VENTA");

    const historial = await peticion("GET", "/comisiones/configuracion/historial", f.cookieAdmin);
    const ids = historial.cuerpo.versiones.map((v: { id: string }) => v.id);
    expect(ids).toContain(idPrimera);
    expect(ids).toContain(idSegunda);
    // La más reciente primero.
    expect(ids[0]).toBe(idSegunda);

    const total = await prismaRaw.configuracionComision.count({ where: { empresaId: f.empresaId } });
    expect(total).toBe(2);
  });

  it("un EMPLEADO y un VENDEDOR reciben 403 en las 4 rutas de /comisiones (solo ADMIN: política y cifras financieras, R4)", async () => {
    for (const cookie of [f.cookieEmpleado, f.cookieVendedor]) {
      expect((await peticion("GET", "/comisiones/configuracion", cookie)).status).toBe(403);
      expect((await peticion("GET", "/comisiones/configuracion/historial", cookie)).status).toBe(403);
      expect(
        (
          await peticion("PUT", "/comisiones/configuracion", cookie, {
            modo: "FIJO_POR_PANTALLA",
            valor: "1000",
            umbralCantidad: 10,
            umbralAmbito: "TOTAL",
            umbralPeriodo: "DIA",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await peticion(
            "GET",
            urlSimulacion({
              desde: "2033-01-01",
              hasta: "2033-01-01",
              modo: "FIJO_POR_PANTALLA",
              valor: "1000",
              umbralCantidad: "10",
              umbralAmbito: "TOTAL",
              umbralPeriodo: "DIA",
            }),
            cookie,
          )
        ).status,
      ).toBe(403);
    }
  });
});

describe("Simulador de comisiones (F6.5)", () => {
  let f: FixtureEmpresa;

  beforeAll(async () => {
    f = await crearFixture("SIM");
  });

  afterAll(async () => {
    await borrarFixture(f.empresaId);
  });

  it("umbral exacto: con 10 pantallas en el período comisionan 0; con 11, comisiona 1", async () => {
    const fechaVenta = new Date("2033-01-10T15:00:00.000Z"); // 10:00 Bogotá, bien dentro del día.
    const venta = await crearVenta(f.empresaId, { vendedorId: f.vendedorId, precioVenta: "100000", fechaVenta, duracionId: f.duracionId });
    await crearVariosDetalles(
      f.empresaId,
      f.duracionId,
      venta.id,
      f.plataformaNetflixId,
      f.cuentaNetflixId,
      f.pantallaNetflixId,
      10,
      new Date(fechaVenta.getTime() + 30 * 24 * 60 * 60 * 1000),
    );

    const parametros = {
      desde: "2033-01-10",
      hasta: "2033-01-10",
      modo: "FIJO_POR_PANTALLA",
      valor: "1000",
      umbralCantidad: "10",
      umbralAmbito: "TOTAL",
      umbralPeriodo: "DIA",
    };

    const conDiez = await peticion("GET", urlSimulacion(parametros), f.cookieAdmin);
    expect(conDiez.status).toBe(200);
    expect(conDiez.cuerpo.pantallasVendidas).toBe(10);
    expect(conDiez.cuerpo.pantallasAbsorbidas).toBe(10);
    expect(conDiez.cuerpo.pantallasComisionadas).toBe(0);
    expect(conDiez.cuerpo.pozoTotal).toBe("0");

    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: venta.id,
      plataformaId: f.plataformaNetflixId,
      cuentaId: f.cuentaNetflixId,
      pantallaId: f.pantallaNetflixId,
      fechaVencimiento: new Date(fechaVenta.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    const conOnce = await peticion("GET", urlSimulacion(parametros), f.cookieAdmin);
    expect(conOnce.cuerpo.pantallasVendidas).toBe(11);
    expect(conOnce.cuerpo.pantallasAbsorbidas).toBe(10);
    expect(conOnce.cuerpo.pantallasComisionadas).toBe(1);
    expect(conOnce.cuerpo.pozoTotal).toBe("1000");
  });

  it("TOTAL y POR_PLATAFORMA sobre los mismos datos dan resultados distintos y ambos correctos", async () => {
    const fechaVenta = new Date("2033-01-11T15:00:00.000Z");
    const venta = await crearVenta(f.empresaId, { vendedorId: f.vendedorId, precioVenta: "100000", fechaVenta, duracionId: f.duracionId });
    const vencimiento = new Date(fechaVenta.getTime() + 30 * 24 * 60 * 60 * 1000);
    await crearVariosDetalles(f.empresaId, f.duracionId, venta.id, f.plataformaNetflixId, f.cuentaNetflixId, f.pantallaNetflixId, 6, vencimiento);
    await crearVariosDetalles(f.empresaId, f.duracionId, venta.id, f.plataformaDisneyId, f.cuentaDisneyId, f.pantallaDisneyId, 6, vencimiento);

    const base = {
      desde: "2033-01-11",
      hasta: "2033-01-11",
      modo: "FIJO_POR_PANTALLA",
      valor: "1000",
      umbralCantidad: "5",
      umbralPeriodo: "DIA",
    };

    const total = await peticion("GET", urlSimulacion({ ...base, umbralAmbito: "TOTAL" }), f.cookieAdmin);
    expect(total.cuerpo.pantallasVendidas).toBe(12);
    expect(total.cuerpo.pantallasComisionadas).toBe(7); // 12 - 5 absorbidas por un solo contador total.
    expect(total.cuerpo.pozoTotal).toBe("7000");

    const porPlataforma = await peticion("GET", urlSimulacion({ ...base, umbralAmbito: "POR_PLATAFORMA" }), f.cookieAdmin);
    expect(porPlataforma.cuerpo.pantallasVendidas).toBe(12);
    expect(porPlataforma.cuerpo.pantallasComisionadas).toBe(2); // (6-5) + (6-5): un contador por plataforma.
    expect(porPlataforma.cuerpo.pozoTotal).toBe("2000");
  });

  it("DIA y MES sobre los mismos datos dan resultados distintos y ambos correctos", async () => {
    const vencimiento = new Date("2033-04-01T00:00:00.000Z");
    const ventaDia1 = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorId,
      precioVenta: "100000",
      fechaVenta: new Date("2033-02-01T15:00:00.000Z"),
      duracionId: f.duracionId,
    });
    await crearVariosDetalles(f.empresaId, f.duracionId, ventaDia1.id, f.plataformaNetflixId, f.cuentaNetflixId, f.pantallaNetflixId, 6, vencimiento);

    const ventaDia2 = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorId,
      precioVenta: "100000",
      fechaVenta: new Date("2033-02-02T15:00:00.000Z"),
      duracionId: f.duracionId,
    });
    await crearVariosDetalles(f.empresaId, f.duracionId, ventaDia2.id, f.plataformaNetflixId, f.cuentaNetflixId, f.pantallaNetflixId, 6, vencimiento);

    const base = {
      desde: "2033-02-01",
      hasta: "2033-02-02",
      modo: "FIJO_POR_PANTALLA",
      valor: "1000",
      umbralCantidad: "5",
      umbralAmbito: "TOTAL",
    };

    const porDia = await peticion("GET", urlSimulacion({ ...base, umbralPeriodo: "DIA" }), f.cookieAdmin);
    expect(porDia.cuerpo.pantallasComisionadas).toBe(2); // (6-5) por cada uno de los 2 días.
    expect(porDia.cuerpo.pozoTotal).toBe("2000");
    expect(porDia.cuerpo.porPeriodo.length).toBe(2);

    const porMes = await peticion("GET", urlSimulacion({ ...base, umbralPeriodo: "MES" }), f.cookieAdmin);
    expect(porMes.cuerpo.pantallasComisionadas).toBe(7); // 12 - 5 absorbidas por un solo contador mensual.
    expect(porMes.cuerpo.pozoTotal).toBe("7000");
    expect(porMes.cuerpo.porPeriodo.length).toBe(1);
  });

  it("frontera Bogotá: una venta a las 23:00 del último día del mes cuenta en ese mes, no en el siguiente", async () => {
    // 2033-03-31 23:00 Bogotá = 2033-04-01T04:00:00.000Z UTC.
    const fechaVenta = new Date("2033-04-01T04:00:00.000Z");
    const venta = await crearVenta(f.empresaId, { vendedorId: f.vendedorId, precioVenta: "5000", fechaVenta, duracionId: f.duracionId });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: venta.id,
      plataformaId: f.plataformaNetflixId,
      cuentaId: f.cuentaNetflixId,
      pantallaId: f.pantallaNetflixId,
      fechaVencimiento: new Date(fechaVenta.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    const parametrosMarzo = {
      desde: "2033-03-01",
      hasta: "2033-03-31",
      modo: "FIJO_POR_PANTALLA",
      valor: "1000",
      umbralCantidad: "0",
      umbralAmbito: "TOTAL",
      umbralPeriodo: "MES",
    };
    const marzo = await peticion("GET", urlSimulacion(parametrosMarzo), f.cookieAdmin);
    expect(marzo.cuerpo.pantallasVendidas).toBe(1);

    const abril = await peticion(
      "GET",
      urlSimulacion({ ...parametrosMarzo, desde: "2033-04-01", hasta: "2033-04-30" }),
      f.cookieAdmin,
    );
    expect(abril.cuerpo.pantallasVendidas).toBe(0);
  });

  it("ventas anuladas y esExterna no cuentan ni para el umbral ni para el pozo", async () => {
    const fechaVenta = new Date("2033-05-01T15:00:00.000Z");
    const vencimiento = new Date(fechaVenta.getTime() + 30 * 24 * 60 * 60 * 1000);

    const ventaNormal = await crearVenta(f.empresaId, { vendedorId: f.vendedorId, precioVenta: "1000", fechaVenta, duracionId: f.duracionId });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: ventaNormal.id,
      plataformaId: f.plataformaNetflixId,
      cuentaId: f.cuentaNetflixId,
      pantallaId: f.pantallaNetflixId,
      fechaVencimiento: vencimiento,
    });

    const ventaAnulada = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorId,
      precioVenta: "1000",
      fechaVenta,
      duracionId: f.duracionId,
      anulada: true,
    });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: ventaAnulada.id,
      plataformaId: f.plataformaNetflixId,
      cuentaId: f.cuentaNetflixId,
      pantallaId: f.pantallaNetflixId,
      fechaVencimiento: vencimiento,
    });

    const ventaExterna = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorId,
      precioVenta: "1000",
      fechaVenta,
      duracionId: f.duracionId,
      esExterna: true,
    });
    await crearDetalle(f.empresaId, f.duracionId, {
      ventaId: ventaExterna.id,
      plataformaId: f.plataformaNetflixId,
      cuentaId: f.cuentaNetflixId,
      pantallaId: f.pantallaNetflixId,
      fechaVencimiento: vencimiento,
    });

    const resultado = await peticion(
      "GET",
      urlSimulacion({
        desde: "2033-05-01",
        hasta: "2033-05-01",
        modo: "FIJO_POR_PANTALLA",
        valor: "1000",
        umbralCantidad: "0",
        umbralAmbito: "TOTAL",
        umbralPeriodo: "DIA",
      }),
      f.cookieAdmin,
    );
    expect(resultado.cuerpo.pantallasVendidas).toBe(1);
    expect(resultado.cuerpo.pantallasComisionadas).toBe(1);
    expect(resultado.cuerpo.pozoTotal).toBe("1000");
  });

  it("orden determinista: misma simulación corrida dos veces da el mismo pozoTotal, con precios distintos entre renglones y fechaVenta empatada", async () => {
    const fechaVenta = new Date("2033-06-01T15:00:00.000Z");
    const vencimiento = new Date(fechaVenta.getTime() + 30 * 24 * 60 * 60 * 1000);

    for (const precio of ["1000", "2000", "3000"]) {
      const venta = await crearVenta(f.empresaId, { vendedorId: f.vendedorId, precioVenta: precio, fechaVenta, duracionId: f.duracionId });
      await crearDetalle(f.empresaId, f.duracionId, {
        ventaId: venta.id,
        plataformaId: f.plataformaNetflixId,
        cuentaId: f.cuentaNetflixId,
        pantallaId: f.pantallaNetflixId,
        fechaVencimiento: vencimiento,
      });
    }

    const parametros = {
      desde: "2033-06-01",
      hasta: "2033-06-01",
      modo: "PORCENTAJE_VENTA",
      valor: "100",
      umbralCantidad: "1",
      umbralAmbito: "TOTAL",
      umbralPeriodo: "DIA",
    };

    const primera = await peticion("GET", urlSimulacion(parametros), f.cookieAdmin);
    const segunda = await peticion("GET", urlSimulacion(parametros), f.cookieAdmin);

    expect(primera.cuerpo.pantallasAbsorbidas).toBe(1);
    expect(primera.cuerpo.pantallasComisionadas).toBe(2);
    // La primera venta creada (precio 1000) es la absorbida por el orden
    // determinista (fechaVenta empatada, id ascendente = orden de creación);
    // quedan comisionadas las de 2000 + 3000 = 5000.
    expect(primera.cuerpo.pozoTotal).toBe("5000");
    expect(segunda.cuerpo.pozoTotal).toBe(primera.cuerpo.pozoTotal);
  });

  it("PORCENTAJE_VENTA prorratea Venta.precioVenta entre los renglones, nunca usa precioSugerido, y refleja el descuento manual", async () => {
    const vencimiento = new Date("2033-08-01T00:00:00.000Z");

    // Paquete de 3 renglones a 30.000: 10.000 por renglón, 50% → 5.000 c/u = 15.000.
    const ventaPaquete = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorId,
      tipoVenta: "PAQUETE",
      precioVenta: "30000",
      fechaVenta: new Date("2033-07-01T15:00:00.000Z"),
      duracionId: f.duracionId,
    });
    await crearVariosDetalles(f.empresaId, f.duracionId, ventaPaquete.id, f.plataformaNetflixId, f.cuentaNetflixId, f.pantallaNetflixId, 3, vencimiento);

    const paquete = await peticion(
      "GET",
      urlSimulacion({
        desde: "2033-07-01",
        hasta: "2033-07-01",
        modo: "PORCENTAJE_VENTA",
        valor: "50",
        umbralCantidad: "0",
        umbralAmbito: "TOTAL",
        umbralPeriodo: "DIA",
      }),
      f.cookieAdmin,
    );
    expect(paquete.cuerpo.pantallasComisionadas).toBe(3);
    expect(paquete.cuerpo.pozoTotal).toBe("15000");

    // Descuento manual: 3 renglones, Venta.precioVenta = 9.000 (no 12.000 de
    // precioSugerido); con 100% el pozo debe ser exactamente 9.000.
    const ventaConDescuento = await crearVenta(f.empresaId, {
      vendedorId: f.vendedorId,
      tipoVenta: "PAQUETE",
      precioVenta: "9000",
      fechaVenta: new Date("2033-07-02T15:00:00.000Z"),
      duracionId: f.duracionId,
    });
    await crearVariosDetalles(
      f.empresaId,
      f.duracionId,
      ventaConDescuento.id,
      f.plataformaNetflixId,
      f.cuentaNetflixId,
      f.pantallaNetflixId,
      3,
      vencimiento,
    );

    const conDescuento = await peticion(
      "GET",
      urlSimulacion({
        desde: "2033-07-02",
        hasta: "2033-07-02",
        modo: "PORCENTAJE_VENTA",
        valor: "100",
        umbralCantidad: "0",
        umbralAmbito: "TOTAL",
        umbralPeriodo: "DIA",
      }),
      f.cookieAdmin,
    );
    expect(conDescuento.cuerpo.pozoTotal).toBe("9000");
  });

  it("FIJO_POR_PANTALLA: el pozo es pantallas comisionadas × valor", async () => {
    const fechaVenta = new Date("2033-08-01T15:00:00.000Z");
    const venta = await crearVenta(f.empresaId, { vendedorId: f.vendedorId, precioVenta: "50000", fechaVenta, duracionId: f.duracionId });
    await crearVariosDetalles(
      f.empresaId,
      f.duracionId,
      venta.id,
      f.plataformaNetflixId,
      f.cuentaNetflixId,
      f.pantallaNetflixId,
      5,
      new Date(fechaVenta.getTime() + 30 * 24 * 60 * 60 * 1000),
    );

    const resultado = await peticion(
      "GET",
      urlSimulacion({
        desde: "2033-08-01",
        hasta: "2033-08-01",
        modo: "FIJO_POR_PANTALLA",
        valor: "1500",
        umbralCantidad: "2",
        umbralAmbito: "TOTAL",
        umbralPeriodo: "DIA",
      }),
      f.cookieAdmin,
    );
    expect(resultado.cuerpo.pantallasVendidas).toBe(5);
    expect(resultado.cuerpo.pantallasAbsorbidas).toBe(2);
    expect(resultado.cuerpo.pantallasComisionadas).toBe(3);
    expect(resultado.cuerpo.pozoTotal).toBe("4500");
  });
});

describe("R1 — aislamiento entre empresas en /comisiones (F6.5)", () => {
  let fA: FixtureEmpresa;
  let fB: FixtureEmpresa;

  beforeAll(async () => {
    fA = await crearFixture("R1A");
    fB = await crearFixture("R1B");
  });

  afterAll(async () => {
    await borrarFixture(fA.empresaId);
    await borrarFixture(fB.empresaId);
  });

  it("la configuración y la simulación de una empresa nunca exponen datos de otra", async () => {
    const guardado = await peticion("PUT", "/comisiones/configuracion", fA.cookieAdmin, {
      modo: "FIJO_POR_PANTALLA",
      valor: "1000",
      umbralCantidad: 10,
      umbralAmbito: "TOTAL",
      umbralPeriodo: "DIA",
    });
    expect(guardado.status).toBe(201);

    // B nunca ve la configuración de A.
    const vigenteB = await peticion("GET", "/comisiones/configuracion", fB.cookieAdmin);
    expect(vigenteB.cuerpo.configuracion).toBeNull();
    const historialB = await peticion("GET", "/comisiones/configuracion/historial", fB.cookieAdmin);
    expect(historialB.cuerpo.versiones).toEqual([]);

    // A tiene ventas; B simula sobre el mismo rango de fechas y no ve nada de A.
    const fechaVenta = new Date("2033-09-01T15:00:00.000Z");
    const venta = await crearVenta(fA.empresaId, { vendedorId: fA.vendedorId, precioVenta: "10000", fechaVenta, duracionId: fA.duracionId });
    await crearDetalle(fA.empresaId, fA.duracionId, {
      ventaId: venta.id,
      plataformaId: fA.plataformaNetflixId,
      cuentaId: fA.cuentaNetflixId,
      pantallaId: fA.pantallaNetflixId,
      fechaVencimiento: new Date(fechaVenta.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    const parametros = {
      desde: "2033-09-01",
      hasta: "2033-09-01",
      modo: "FIJO_POR_PANTALLA",
      valor: "1000",
      umbralCantidad: "0",
      umbralAmbito: "TOTAL",
      umbralPeriodo: "DIA",
    };

    const simulacionA = await peticion("GET", urlSimulacion(parametros), fA.cookieAdmin);
    expect(simulacionA.cuerpo.pantallasVendidas).toBe(1);

    const simulacionB = await peticion("GET", urlSimulacion(parametros), fB.cookieAdmin);
    expect(simulacionB.cuerpo.pantallasVendidas).toBe(0);
    expect(simulacionB.cuerpo.pozoTotal).toBe("0");
  });
});
