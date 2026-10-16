import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: arma la fixture fuera de cualquier contexto de
// empresa autenticado — mismo patrón que ventas.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { cifrar } from "../lib/cifrado.ts";
import { auth } from "./auth.ts";
import { ventas } from "./ventas.ts";
import { garantias } from "./garantias.ts";

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

async function get(ruta: string, cookie: string) {
  return ventas.handle(new Request(`http://local${ruta}`, { headers: { cookie } }));
}

async function post(body: unknown, cookie: string) {
  return ventas.handle(
    new Request("http://local/ventas", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );
}

async function patch(ruta: string, cookie: string) {
  return ventas.handle(new Request(`http://local${ruta}`, { method: "PATCH", headers: { cookie } }));
}

// Crea una empresa con una plataforma, duración, tipo de cliente y precio
// listos para vender, más un ADMIN ya logueado.
async function crearEmpresaLista(prefijo: string, nombre: string, capacidadPantallas: number) {
  const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });
  const empresa = await prismaRaw.empresa.create({ data: { nombre, prefijoCodigo: prefijo } });
  const empresaId = empresa.id;

  const adminEmail = `admin-${prefijo}-${randomUUID()}@test.local`;
  const admin = await prismaRaw.usuario.create({
    data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
  });
  const cookieAdmin = await iniciarSesion(adminEmail);

  const plataforma = await prismaRaw.plataforma.create({
    data: { empresaId, nombre: `Netflix (${prefijo})`, capacidadPantallas, usaPerfilPin: false },
  });
  const cuenta = await prismaRaw.cuenta.create({
    data: { empresaId, plataformaId: plataforma.id, correo: `netflix@${prefijo}.test`, password: cifrar("clave"), capacidadPantallas },
  });
  for (let numero = 1; numero <= capacidadPantallas; numero++) {
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero } });
  }

  const duracion = await prismaRaw.duracion.create({
    data: { empresaId, nombre: `30 días (${prefijo})`, cantidad: 30, unidad: "DIAS" },
  });
  const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: `Nuevo (${prefijo})` } });

  await prismaRaw.precio.create({
    data: { empresaId, plataformaId: plataforma.id, duracionId: duracion.id, tipoClienteId: tipoCliente.id, precioVenta: "15000", costo: "8000" },
  });
  // El costo real que realizarVenta consulta ya no sale de Precio.costo —
  // ver CostoPlataforma (lib/ventas.ts, camino del dinero).
  await prismaRaw.costoPlataforma.create({
    data: { empresaId, plataformaId: plataforma.id, duracionId: duracion.id, costo: "8000" },
  });
  await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "UNIDAD", contenido: "Código {{codigoCompra}} - {{correo}} - {{clave}}" } });
  await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "PAQUETE", contenido: "Código {{codigoCompra}}\n{{listaCuentas}}" } });

  return { empresaId, adminId: admin.id, cookieAdmin, plataformaId: plataforma.id, duracionId: duracion.id, tipoClienteId: tipoCliente.id };
}

async function borrarEmpresa(empresaId: string) {
  await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
  await prismaRaw.venta.deleteMany({ where: { empresaId } });
  await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
  await prismaRaw.costoPlataforma.deleteMany({ where: { empresaId } });
  await prismaRaw.precio.deleteMany({ where: { empresaId } });
  await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
  await prismaRaw.duracion.deleteMany({ where: { empresaId } });
  await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
  await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
  await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
  await prismaRaw.usuario.deleteMany({ where: { empresaId } });
  await prismaRaw.empresa.delete({ where: { id: empresaId } });
}

describe("Rutas de ventas — listado, totales y anulación (Entrega 9, secciones 1-3)", () => {
  let empresaAId: string;
  let cookieAdminA: string;
  let plataformaAId: string;
  let duracionAId: string;
  let tipoClienteAId: string;
  let vendedor1Email: string;
  let vendedor1Id: string;
  let cookieVendedor1: string;
  let vendedor2Email: string;
  let cookieVendedor2: string;

  let empresaBId: string;
  let cookieAdminB: string;

  let codigoVenta1: string;
  let ventaId1: string;
  let codigoVentaB: string;

  beforeAll(async () => {
    const empresaA = await crearEmpresaLista("LSA", "Empresa listado A (ventas-listado.test)", 2);
    empresaAId = empresaA.empresaId;
    cookieAdminA = empresaA.cookieAdmin;
    plataformaAId = empresaA.plataformaId;
    duracionAId = empresaA.duracionId;
    tipoClienteAId = empresaA.tipoClienteId;

    vendedor1Email = `vendedor1-lsa-${randomUUID()}@test.local`;
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });
    const vendedor1 = await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: vendedor1Email, passwordHash: hash, nombre: "Empleado Uno", rol: "EMPLEADO" },
    });
    vendedor1Id = vendedor1.id;
    cookieVendedor1 = await iniciarSesion(vendedor1Email);

    vendedor2Email = `vendedor2-lsa-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: vendedor2Email, passwordHash: hash, nombre: "Empleado Dos", rol: "EMPLEADO" },
    });
    cookieVendedor2 = await iniciarSesion(vendedor2Email);

    // Empresa B: aislada, solo para probar que los totales de A nunca
    // incluyen su dinero.
    const empresaB = await crearEmpresaLista("LSB", "Empresa listado B (ventas-listado.test)", 1);
    empresaBId = empresaB.empresaId;
    cookieAdminB = empresaB.cookieAdmin;
    const respuestaVentaB = await post(
      { tipoVenta: "UNIDAD", plataformas: [empresaB.plataformaId], duracionId: empresaB.duracionId, tipoClienteId: empresaB.tipoClienteId },
      cookieAdminB,
    );
    expect(respuestaVentaB.status).toBe(201);
    const cuerpoVentaB = (await respuestaVentaB.json()) as { venta: { codigoCompra: string } };
    codigoVentaB = cuerpoVentaB.venta.codigoCompra;
  });

  afterAll(async () => {
    await borrarEmpresa(empresaAId);
    await borrarEmpresa(empresaBId);
  });

  it("vendedor1 y vendedor2 venden (misma plataforma, 2 pantallas disponibles en total)", async () => {
    const r1 = await post(
      { tipoVenta: "UNIDAD", plataformas: [plataformaAId], duracionId: duracionAId, tipoClienteId: tipoClienteAId },
      cookieVendedor1,
    );
    expect(r1.status).toBe(201);
    const c1 = (await r1.json()) as { venta: { id: string; codigoCompra: string } };
    codigoVenta1 = c1.venta.codigoCompra;
    ventaId1 = c1.venta.id;

    const r2 = await post(
      { tipoVenta: "UNIDAD", plataformas: [plataformaAId], duracionId: duracionAId, tipoClienteId: tipoClienteAId },
      cookieVendedor2,
    );
    expect(r2.status).toBe(201);
  });

  it("a una tercera venta ya no le queda pantalla libre (inventario agotado por las dos anteriores)", async () => {
    const r3 = await post(
      { tipoVenta: "UNIDAD", plataformas: [plataformaAId], duracionId: duracionAId, tipoClienteId: tipoClienteAId },
      cookieVendedor1,
    );
    expect(r3.status).toBe(409);
  });

  it("(e) ADMIN: /listado trae costo/utilidad/vendedor y busca por código de compra parcial, insensible a mayúsculas, sin cruzar empresas", async () => {
    const respuestaTodas = await get("/ventas/listado", cookieAdminA);
    expect(respuestaTodas.status).toBe(200);
    const cuerpoTodas = (await respuestaTodas.json()) as { ventas: Array<Record<string, unknown>> };
    expect(cuerpoTodas.ventas).toHaveLength(2);
    expect(cuerpoTodas.ventas[0].costo).toBeDefined();
    expect(cuerpoTodas.ventas[0].utilidad).toBeDefined();
    expect((cuerpoTodas.ventas[0] as { vendedor: { nombre: string } }).vendedor.nombre).toBeString();

    const fragmento = codigoVenta1.slice(-4).toLowerCase();
    const respuestaBusqueda = await get(`/ventas/listado?codigoCompra=${fragmento}`, cookieAdminA);
    expect(respuestaBusqueda.status).toBe(200);
    const cuerpoBusqueda = (await respuestaBusqueda.json()) as { ventas: Array<{ codigoCompra: string }> };
    expect(cuerpoBusqueda.ventas).toHaveLength(1);
    expect(cuerpoBusqueda.ventas[0].codigoCompra).toBe(codigoVenta1);

    const respuestaVendedor = await get(`/ventas/listado?vendedorId=${vendedor1Id}`, cookieAdminA);
    const cuerpoVendedor = (await respuestaVendedor.json()) as { ventas: Array<{ codigoCompra: string }> };
    expect(cuerpoVendedor.ventas).toHaveLength(1);
    expect(cuerpoVendedor.ventas[0].codigoCompra).toBe(codigoVenta1);

    const respuestaPlataformaAjena = await get("/ventas/listado?plataformaId=no-existe", cookieAdminA);
    const cuerpoPlataformaAjena = (await respuestaPlataformaAjena.json()) as { ventas: unknown[] };
    expect(cuerpoPlataformaAjena.ventas).toHaveLength(0);

    // La venta de empresa B existe y su código es real, pero buscarlo desde
    // el admin de empresa A debe devolver vacío: la búsqueda por código no
    // puede ser una puerta trasera que cruce empresas (R1).
    const fragmentoAjeno = codigoVentaB.slice(-4).toLowerCase();
    const respuestaBusquedaAjena = await get(`/ventas/listado?codigoCompra=${fragmentoAjeno}`, cookieAdminA);
    expect(respuestaBusquedaAjena.status).toBe(200);
    const cuerpoBusquedaAjena = (await respuestaBusquedaAjena.json()) as { ventas: unknown[] };
    expect(cuerpoBusquedaAjena.ventas).toHaveLength(0);
  });

  it("(b, c) EMPLEADO: /mias solo trae sus propias ventas, nunca las de otro vendedor, y el JSON crudo no tiene costo/utilidad/margen", async () => {
    const respuesta = await get("/ventas/mias", cookieVendedor1);
    expect(respuesta.status).toBe(200);
    const texto = await respuesta.text();
    expect(texto).not.toContain("costo");
    expect(texto).not.toContain("utilidad");
    expect(texto).not.toContain("margen");

    const cuerpo = JSON.parse(texto) as { ventas: Array<{ codigoCompra: string }> };
    expect(cuerpo.ventas).toHaveLength(1);
    expect(cuerpo.ventas[0].codigoCompra).toBe(codigoVenta1);
  });

  it("EMPLEADO no puede usar /listado ni /totales (son exclusivos de ADMIN)", async () => {
    const respuestaListado = await get("/ventas/listado", cookieVendedor1);
    expect(respuestaListado.status).toBe(403);
    const respuestaTotales = await get("/ventas/totales", cookieVendedor1);
    expect(respuestaTotales.status).toBe(403);
  });

  it("(a) /totales nunca cruza empresas: los totales de A solo suman las dos ventas de A, no la de B", async () => {
    const respuesta = await get("/ventas/totales", cookieAdminA);
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as {
      mes: { numeroVentas: number; ingresos: string; costos: string; utilidad: string };
    };
    // Dos ventas de 15000/8000 cada una. Si los totales incluyeran la venta
    // de la empresa B, numeroVentas sería 3 y los montos no cuadrarían.
    expect(cuerpo.mes.numeroVentas).toBe(2);
    expect(Number(cuerpo.mes.ingresos)).toBe(30000);
    expect(Number(cuerpo.mes.costos)).toBe(16000);
    expect(Number(cuerpo.mes.utilidad)).toBe(14000);
  });

  it("(d) anular una venta libera su pantalla de inmediato: la siguiente venta, antes rechazada por falta de inventario, ahora se completa", async () => {
    const anulacion = await patch(`/ventas/${ventaId1}/anular`, cookieAdminA);
    expect(anulacion.status).toBe(200);
    const cuerpoAnulacion = (await anulacion.json()) as { venta: { anulada: boolean; anuladaEn: string } };
    expect(cuerpoAnulacion.venta.anulada).toBe(true);
    expect(cuerpoAnulacion.venta.anuladaEn).toBeString();

    const ventaAnulada = await prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaId1 } });
    expect(ventaAnulada.anulada).toBe(true);
    expect(ventaAnulada.anuladaPorId).toBeString();

    const reventa = await post(
      { tipoVenta: "UNIDAD", plataformas: [plataformaAId], duracionId: duracionAId, tipoClienteId: tipoClienteAId },
      cookieVendedor1,
    );
    expect(reventa.status).toBe(201);
  });

  it("(f) /codigos: solo el conjunto filtrado, sin anuladas, sin paginar, y exclusivo de ADMIN", async () => {
    // En este punto empresa A tiene 3 ventas en total: la de vendedor2 (activa),
    // codigoVenta1 (anulada en la prueba anterior) y la reventa que la
    // sustituyó (activa). codigoVenta1 debe quedar fuera sin importar el filtro.
    const sinFiltro = await get("/ventas/codigos", cookieAdminA);
    expect(sinFiltro.status).toBe(200);
    const cuerpoSinFiltro = (await sinFiltro.json()) as { codigos: string[] };
    expect(cuerpoSinFiltro.codigos).toHaveLength(2);
    expect(cuerpoSinFiltro.codigos).not.toContain(codigoVenta1);

    // Filtrado por vendedor1: solo le queda una venta activa (la reventa),
    // la anulada no entra aunque el filtro no excluya explícitamente a codigoVenta1.
    const porVendedor = await get(`/ventas/codigos?vendedorId=${vendedor1Id}`, cookieAdminA);
    const cuerpoPorVendedor = (await porVendedor.json()) as { codigos: string[] };
    expect(cuerpoPorVendedor.codigos).toHaveLength(1);
    expect(cuerpoPorVendedor.codigos[0]).not.toBe(codigoVenta1);

    // Un filtro que no devuelve ninguna venta responde con lista vacía, no error.
    const sinResultados = await get("/ventas/codigos?plataformaId=no-existe", cookieAdminA);
    expect(sinResultados.status).toBe(200);
    expect(((await sinResultados.json()) as { codigos: string[] }).codigos).toHaveLength(0);

    // No cruza empresas: el código de la venta de empresa B nunca aparece.
    expect(cuerpoSinFiltro.codigos).not.toContain(codigoVentaB);

    const comoVendedor = await get("/ventas/codigos", cookieVendedor1);
    expect(comoVendedor.status).toBe(403);
  });

  it("anular responde 404 para una venta inexistente y 409 si ya estaba anulada", async () => {
    const inexistente = await patch("/ventas/no-existe/anular", cookieAdminA);
    expect(inexistente.status).toBe(404);

    const yaAnulada = await patch(`/ventas/${ventaId1}/anular`, cookieAdminA);
    expect(yaAnulada.status).toBe(409);
  });

  it("EMPLEADO no puede anular una venta (403)", async () => {
    const respuesta = await patch(`/ventas/${ventaId1}/anular`, cookieVendedor1);
    expect(respuesta.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Camino del dinero, punto 4 — la pérdida de una garantía descuenta de la
// utilidad del PERÍODO EN QUE LA GARANTÍA SE CREÓ, nunca de la venta
// original (R3: Venta.utilidad nunca se toca). /ventas/totales debe devolver
// ambas cifras por separado: utilidad ya neta, y perdidaGarantias aparte.
// ---------------------------------------------------------------------------
describe("Totales — la pérdida por garantías descuenta la utilidad del período", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let ventaId: string;

  beforeAll(async () => {
    const empresa = await crearEmpresaLista("LSG", "Empresa totales-garantías (ventas-listado.test)", 2);
    empresaId = empresa.empresaId;
    cookieAdmin = empresa.cookieAdmin;

    const respuestaVenta = await post(
      { tipoVenta: "UNIDAD", plataformas: [empresa.plataformaId], duracionId: empresa.duracionId, tipoClienteId: empresa.tipoClienteId },
      cookieAdmin,
    );
    expect(respuestaVenta.status).toBe(201);
    const cuerpoVenta = (await respuestaVenta.json()) as { venta: { id: string } };
    ventaId = cuerpoVenta.venta.id;

    const detalleOriginal = await prismaRaw.ventaDetalle.findFirstOrThrow({ where: { ventaId } });
    const respuestaGarantia = await garantias.handle(
      new Request(`http://local/garantias/${detalleOriginal.id}/reemplazar`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieAdmin },
        body: JSON.stringify({ motivo: "Pantalla dañada" }),
      }),
    );
    expect(respuestaGarantia.status).toBe(201);
  });

  afterAll(async () => {
    await prismaRaw.garantia.deleteMany({ where: { empresaId } });
    await borrarEmpresa(empresaId);
  });

  it("perdidaGarantias llega aparte y utilidad ya viene neta (bruta - pérdida)", async () => {
    const respuesta = await get("/ventas/totales", cookieAdmin);
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as {
      mes: { ingresos: string; costos: string; utilidad: string; perdidaGarantias: string };
    };

    // Venta: precioVenta 15000, costo 8000 (CostoPlataforma) -> utilidad bruta 7000.
    // Garantía: mismo CostoPlataforma (8000) -> perdidaGarantias "8000".
    // Utilidad neta esperada: 7000 - 8000 = -1000.
    expect(Number(cuerpo.mes.ingresos)).toBe(15000);
    expect(Number(cuerpo.mes.costos)).toBe(8000);
    expect(cuerpo.mes.perdidaGarantias).toBe("8000");
    expect(Number(cuerpo.mes.utilidad)).toBe(-1000);

    // La venta original jamás se tocó (R3): su utilidad guardada sigue
    // siendo la bruta, no la neta del período.
    const ventaRecargada = await prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaId } });
    expect(ventaRecargada.utilidad.toString()).toBe("7000");
  });
});

// ---------------------------------------------------------------------------
// F4.3 — garantía de una venta hecha fuera del sistema: la Venta esExterna
// que la sostiene NO es un ingreso. Esta es la prueba que de verdad protege
// la plata: una venta normal y una garantía externa en la MISMA ventana
// deben dejar numeroVentas/listado/codigos viendo solo la normal, mientras
// que perdidaGarantias SÍ suma la pérdida de la externa (Garantia.costoAsumido
// no se filtra por esExterna — ver routes/ventas.ts totalesDesde()).
// ---------------------------------------------------------------------------
describe("F4.3 — la Venta esExterna no contamina /ventas (listado, totales, códigos)", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let plataformaId: string;
  let duracionId: string;
  let codigoVentaNormal: string;
  let ventaExternaId: string;

  async function postExterna(body: unknown, cookie: string) {
    return garantias.handle(
      new Request("http://local/garantias/externa", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  beforeAll(async () => {
    // 2 pantallas: una para la venta normal, otra para la pantalla que
    // entrega la garantía externa.
    const empresa = await crearEmpresaLista("LSE", "Empresa venta externa (ventas-listado.test)", 2);
    empresaId = empresa.empresaId;
    cookieAdmin = empresa.cookieAdmin;
    plataformaId = empresa.plataformaId;
    duracionId = empresa.duracionId;

    const respuestaNormal = await post(
      { tipoVenta: "UNIDAD", plataformas: [plataformaId], duracionId, tipoClienteId: empresa.tipoClienteId },
      cookieAdmin,
    );
    expect(respuestaNormal.status).toBe(201);
    const cuerpoNormal = (await respuestaNormal.json()) as { venta: { codigoCompra: string } };
    codigoVentaNormal = cuerpoNormal.venta.codigoCompra;

    const fechaVencimiento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const respuestaExterna = await postExterna(
      { plataformaId, duracionId, fechaVencimiento, celularCliente: "3000000000", motivo: "Venta por WhatsApp" },
      cookieAdmin,
    );
    expect(respuestaExterna.status).toBe(201);

    const ventaExterna = await prismaRaw.venta.findFirstOrThrow({ where: { empresaId, esExterna: true } });
    ventaExternaId = ventaExterna.id;
  });

  afterAll(async () => {
    await prismaRaw.garantia.deleteMany({ where: { empresaId } });
    await borrarEmpresa(empresaId);
  });

  it("la Venta externa nace con precio/costo/utilidad cero, sin tipoCliente, marcada esExterna", async () => {
    const venta = await prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaExternaId } });
    expect(venta.esExterna).toBe(true);
    expect(venta.tipoClienteId).toBeNull();
    expect(venta.nombreTipoCliente).toBe("Venta externa");
    expect(venta.precioVenta.toString()).toBe("0");
    expect(venta.costo.toString()).toBe("0");
    expect(venta.utilidad.toString()).toBe("0");
  });

  it("numeroVentas, /listado y /codigos ven solo la venta normal; perdidaGarantias SÍ incluye la pérdida externa", async () => {
    const respuestaListado = await get("/ventas/listado", cookieAdmin);
    expect(respuestaListado.status).toBe(200);
    const cuerpoListado = (await respuestaListado.json()) as { ventas: Array<{ codigoCompra: string }> };
    expect(cuerpoListado.ventas).toHaveLength(1);
    expect(cuerpoListado.ventas[0].codigoCompra).toBe(codigoVentaNormal);

    const respuestaCodigos = await get("/ventas/codigos", cookieAdmin);
    const cuerpoCodigos = (await respuestaCodigos.json()) as { codigos: string[] };
    expect(cuerpoCodigos.codigos).toHaveLength(1);
    expect(cuerpoCodigos.codigos[0]).toBe(codigoVentaNormal);

    const respuestaTotales = await get("/ventas/totales", cookieAdmin);
    const cuerpoTotales = (await respuestaTotales.json()) as {
      mes: { numeroVentas: number; ingresos: string; costos: string; utilidad: string; perdidaGarantias: string };
    };
    // Venta normal: 15000/8000 -> utilidad bruta 7000. Garantía externa:
    // mismo CostoPlataforma (8000) -> perdidaGarantias "8000". numeroVentas
    // cuenta solo la normal: si contara la externa también sería 2.
    expect(cuerpoTotales.mes.numeroVentas).toBe(1);
    expect(Number(cuerpoTotales.mes.ingresos)).toBe(15000);
    expect(Number(cuerpoTotales.mes.costos)).toBe(8000);
    expect(cuerpoTotales.mes.perdidaGarantias).toBe("8000");
    expect(Number(cuerpoTotales.mes.utilidad)).toBe(-1000);
  });

  it("una venta externa no se puede anular (409 VENTA_EXTERNA_NO_SE_ANULA)", async () => {
    const respuesta = await patch(`/ventas/${ventaExternaId}/anular`, cookieAdmin);
    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe("VENTA_EXTERNA_NO_SE_ANULA");
  });

  it("GET /garantias/pantallas-vendidas SÍ muestra la fila entregada por la garantía externa, marcada como tal", async () => {
    const respuesta = await garantias.handle(
      new Request("http://local/garantias/pantallas-vendidas", { headers: { cookie: cookieAdmin } }),
    );
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as {
      pantallas: Array<{ esExterna: boolean; celularExterno: string | null; codigoCompra: string }>;
    };
    const filaExterna = cuerpo.pantallas.find((p) => p.esExterna);
    expect(filaExterna).toBeDefined();
    expect(filaExterna?.celularExterno).toBe("3000000000");
  });
});

// ---------------------------------------------------------------------------
// F4.4 decisión 6 — una venta de 2+ renglones nace con Venta.plataformaId
// null (no hay un único id que represente "Netflix y Disney+"). Si
// whereDesdeFiltros() siguiera filtrando por Venta.plataformaId, esta venta
// sería invisible al filtrar /listado por cualquiera de sus dos
// plataformas — exactamente el bug que el cambio a `detalles: { some: ... }`
// (routes/ventas.ts) tiene que evitar.
// ---------------------------------------------------------------------------
describe("F4.4 — filtrar /listado por plataforma encuentra ventas de 2+ renglones (Venta.plataformaId null)", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let plataformaNetflixId: string;
  let plataformaDisneyId: string;
  let duracionId: string;
  let tipoClienteId: string;
  let codigoVentaMulti: string;
  let codigoVentaUnica: string;

  beforeAll(async () => {
    const empresa = await crearEmpresaLista("LSF", "Empresa filtro multi-renglón (ventas-listado.test)", 1);
    empresaId = empresa.empresaId;
    cookieAdmin = empresa.cookieAdmin;
    plataformaNetflixId = empresa.plataformaId;
    duracionId = empresa.duracionId;
    tipoClienteId = empresa.tipoClienteId;

    // Disney+ con 2 pantallas: una para la venta de un solo renglón, otra
    // para el renglón que aporta a la venta multi-renglón — sin que compitan
    // por el mismo cupo.
    const disney = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ (filtro-multi.test)", capacidadPantallas: 2, usaPerfilPin: false },
    });
    plataformaDisneyId = disney.id;
    const cuentaDisney = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaDisneyId, correo: "disney@filtro-multi.test", password: cifrar("clave"), capacidadPantallas: 2 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaDisney.id, numero: 1 } });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaDisney.id, numero: 2 } });
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: plataformaDisneyId, duracionId, tipoClienteId, precioVenta: "12000", costo: "5000" },
    });
    await prismaRaw.costoPlataforma.create({ data: { empresaId, plataformaId: plataformaDisneyId, duracionId, costo: "5000" } });

    // Una venta de un solo renglón (solo Disney+) para confirmar que el
    // filtro no empieza a traer TODO al cambiar a detalles.some (falso
    // positivo): no debe aparecer al filtrar por Netflix.
    const respuestaUnica = await post(
      { tipoVenta: "UNIDAD", plataformas: [plataformaDisneyId], duracionId, tipoClienteId },
      cookieAdmin,
    );
    expect(respuestaUnica.status).toBe(201);
    codigoVentaUnica = ((await respuestaUnica.json()) as { venta: { codigoCompra: string } }).venta.codigoCompra;

    const respuestaMulti = await post(
      { tipoVenta: "UNIDAD", plataformas: [plataformaNetflixId, plataformaDisneyId], duracionId, tipoClienteId },
      cookieAdmin,
    );
    expect(respuestaMulti.status).toBe(201);
    const cuerpoMulti = (await respuestaMulti.json()) as { venta: { codigoCompra: string } };
    codigoVentaMulti = cuerpoMulti.venta.codigoCompra;
  });

  afterAll(async () => {
    await borrarEmpresa(empresaId);
  });

  it("Venta.plataformaId es null para la venta de 2 renglones", async () => {
    const venta = await prismaRaw.venta.findFirstOrThrow({ where: { empresaId, codigoCompra: codigoVentaMulti } });
    expect(venta.plataformaId).toBeNull();
  });

  it("/listado?plataformaId=<Netflix> encuentra la venta multi-renglón (no solo las de un renglón)", async () => {
    const respuesta = await get(`/ventas/listado?plataformaId=${plataformaNetflixId}`, cookieAdmin);
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as { ventas: Array<{ codigoCompra: string }> };
    const codigos = cuerpo.ventas.map((v) => v.codigoCompra);
    expect(codigos).toContain(codigoVentaMulti);
    expect(codigos).not.toContain(codigoVentaUnica); // esa venta no llevó Netflix
  });

  it("/listado?plataformaId=<Disney+> TAMBIÉN encuentra la misma venta multi-renglón, por su otro renglón", async () => {
    const respuesta = await get(`/ventas/listado?plataformaId=${plataformaDisneyId}`, cookieAdmin);
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as { ventas: Array<{ codigoCompra: string }> };
    const codigos = cuerpo.ventas.map((v) => v.codigoCompra);
    expect(codigos).toContain(codigoVentaMulti);
    expect(codigos).toContain(codigoVentaUnica); // esa sí llevó Disney+
  });
});
