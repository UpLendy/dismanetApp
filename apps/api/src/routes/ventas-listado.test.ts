import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: arma la fixture fuera de cualquier contexto de
// empresa autenticado — mismo patrón que ventas.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { cifrar } from "../lib/cifrado.ts";
import { auth } from "./auth.ts";
import { ventas } from "./ventas.ts";

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
// listos para vender, más un ADMIN y un VENDEDOR ya logueados.
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
  await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "UNIDAD", contenido: "Código {{codigoCompra}} - {{correo}} - {{clave}}" } });
  await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "PAQUETE", contenido: "Código {{codigoCompra}}\n{{listaCuentas}}" } });

  return { empresaId, adminId: admin.id, cookieAdmin, plataformaId: plataforma.id, duracionId: duracion.id, tipoClienteId: tipoCliente.id };
}

async function borrarEmpresa(empresaId: string) {
  await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
  await prismaRaw.venta.deleteMany({ where: { empresaId } });
  await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
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
      data: { empresaId: empresaAId, email: vendedor1Email, passwordHash: hash, nombre: "Vendedor Uno", rol: "VENDEDOR" },
    });
    vendedor1Id = vendedor1.id;
    cookieVendedor1 = await iniciarSesion(vendedor1Email);

    vendedor2Email = `vendedor2-lsa-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: vendedor2Email, passwordHash: hash, nombre: "Vendedor Dos", rol: "VENDEDOR" },
    });
    cookieVendedor2 = await iniciarSesion(vendedor2Email);

    // Empresa B: aislada, solo para probar que los totales de A nunca
    // incluyen su dinero.
    const empresaB = await crearEmpresaLista("LSB", "Empresa listado B (ventas-listado.test)", 1);
    empresaBId = empresaB.empresaId;
    cookieAdminB = empresaB.cookieAdmin;
    const respuestaVentaB = await post(
      { tipoVenta: "UNIDAD", plataformaId: empresaB.plataformaId, duracionId: empresaB.duracionId, tipoClienteId: empresaB.tipoClienteId },
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
      { tipoVenta: "UNIDAD", plataformaId: plataformaAId, duracionId: duracionAId, tipoClienteId: tipoClienteAId },
      cookieVendedor1,
    );
    expect(r1.status).toBe(201);
    const c1 = (await r1.json()) as { venta: { id: string; codigoCompra: string } };
    codigoVenta1 = c1.venta.codigoCompra;
    ventaId1 = c1.venta.id;

    const r2 = await post(
      { tipoVenta: "UNIDAD", plataformaId: plataformaAId, duracionId: duracionAId, tipoClienteId: tipoClienteAId },
      cookieVendedor2,
    );
    expect(r2.status).toBe(201);
  });

  it("a una tercera venta ya no le queda pantalla libre (inventario agotado por las dos anteriores)", async () => {
    const r3 = await post(
      { tipoVenta: "UNIDAD", plataformaId: plataformaAId, duracionId: duracionAId, tipoClienteId: tipoClienteAId },
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

  it("(b, c) VENDEDOR: /mias solo trae sus propias ventas, nunca las de otro vendedor, y el JSON crudo no tiene costo/utilidad/margen", async () => {
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

  it("VENDEDOR no puede usar /listado ni /totales (son exclusivos de ADMIN)", async () => {
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
      { tipoVenta: "UNIDAD", plataformaId: plataformaAId, duracionId: duracionAId, tipoClienteId: tipoClienteAId },
      cookieVendedor1,
    );
    expect(reventa.status).toBe(201);
  });

  it("anular responde 404 para una venta inexistente y 409 si ya estaba anulada", async () => {
    const inexistente = await patch("/ventas/no-existe/anular", cookieAdminA);
    expect(inexistente.status).toBe(404);

    const yaAnulada = await patch(`/ventas/${ventaId1}/anular`, cookieAdminA);
    expect(yaAnulada.status).toBe(409);
  });

  it("VENDEDOR no puede anular una venta (403)", async () => {
    const respuesta = await patch(`/ventas/${ventaId1}/anular`, cookieVendedor1);
    expect(respuesta.status).toBe(403);
  });
});
