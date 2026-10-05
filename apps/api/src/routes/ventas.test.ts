import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita — arma la fixture fuera de
// cualquier contexto de empresa autenticado, igual que cuentas.test.ts.
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

describe("Rutas de ventas (venta rápida)", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let cookieVendedor: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa ventas-ruta (ventas.test)", prefijoCodigo: "VTR" },
    });
    empresaId = empresa.id;

    const adminEmail = `admin-ventas-ruta-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });
    cookieAdmin = await iniciarSesion(adminEmail);

    const vendedorEmail = `vendedor-ventas-ruta-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: vendedorEmail, passwordHash: hash, nombre: "Vendedor", rol: "VENDEDOR" },
    });
    cookieVendedor = await iniciarSesion(vendedorEmail);

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (ventas-ruta.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "netflix@ventas-ruta.test", password: cifrar("clave"), capacidadPantallas: 2 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 1 } });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 2 } });

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (ventas-ruta.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (ventas-ruta.test)" } });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "15000", costo: "8000" },
    });

    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "UNIDAD", contenido: "Código {{codigoCompra}} - {{correo}} - {{clave}}" },
    });
    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "PAQUETE", contenido: "Código {{codigoCompra}} - {{paquete}}\n{{listaCuentas}}" },
    });
  });

  afterAll(async () => {
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
  });

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

  it("un VENDEDOR ve la plataforma en el selector /ventas/plataformas con precio pero sin costo", async () => {
    const respuesta = await get(`/ventas/plataformas?duracionId=${duracionId}&tipoClienteId=${tipoClienteId}`, cookieVendedor);
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as { plataformas: Array<{ id: string; precioVenta: string }> };
    const fila = cuerpo.plataformas.find((p) => p.id === plataformaId);
    expect(fila).toBeDefined();
    expect(fila?.precioVenta).toBe("15000");
    expect(JSON.stringify(fila)).not.toContain("costo");
  });

  it("R4: un VENDEDOR que vende UNIDAD recibe el mensaje pero NUNCA costo/utilidad; un ADMIN sí los recibe", async () => {
    const respuestaVendedor = await post(
      { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId },
      cookieVendedor,
    );
    expect(respuestaVendedor.status).toBe(201);
    const cuerpoVendedor = (await respuestaVendedor.json()) as { venta: Record<string, unknown> };
    expect(cuerpoVendedor.venta.mensajeGenerado).toBeString();
    expect(cuerpoVendedor.venta.costo).toBeUndefined();
    expect(cuerpoVendedor.venta.utilidad).toBeUndefined();

    const respuestaAdmin = await post(
      { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId },
      cookieAdmin,
    );
    expect(respuestaAdmin.status).toBe(201);
    const cuerpoAdmin = (await respuestaAdmin.json()) as { venta: { costo: string; utilidad: string } };
    expect(cuerpoAdmin.venta.costo).toBe("8000");
    expect(cuerpoAdmin.venta.utilidad).toBe("7000");
  });

  it("sin pantallas libres (ambas ya vendidas por las dos pruebas anteriores), responde 409 INVENTARIO_INSUFICIENTE", async () => {
    const respuesta = await post({ tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }, cookieVendedor);
    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe("INVENTARIO_INSUFICIENTE");
  });

  it("precio inexistente para la combinación responde 409 ITEM_NO_DISPONIBLE, no 500", async () => {
    const otraDuracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "14 días sin precio (ventas-ruta.test)", cantidad: 14, unidad: "DIAS" },
    });

    const respuesta = await post(
      { tipoVenta: "UNIDAD", plataformaId, duracionId: otraDuracion.id, tipoClienteId },
      cookieVendedor,
    );
    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe("ITEM_NO_DISPONIBLE");

    await prismaRaw.duracion.delete({ where: { id: otraDuracion.id } });
  });
});
