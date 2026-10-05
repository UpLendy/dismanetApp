import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita — arma la fixture (empresa,
// vendedor, plataforma, cuenta, pantalla y una Venta/VentaDetalle históricas)
// directamente, sin pasar por el flujo de venta (aún no existe en esta
// entrega) ni por ningún contexto de empresa autenticado.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { duraciones } from "./duraciones.ts";

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
  const respuesta = await duraciones.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

describe("Duraciones — catálogo (e, g)", () => {
  let empresaId: string;
  let adminEmail: string;
  let cookieAdmin: string;
  let vendedorId: string;
  let duracionId: string;
  let ventaId: string;
  let ventaDetalleId: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa duraciones (duraciones.test)", prefijoCodigo: "DUR" },
    });
    empresaId = empresa.id;
    idsEmpresas.push(empresaId);

    adminEmail = `admin-duraciones-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminEmail);
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin duraciones", rol: "ADMIN" },
    });
    cookieAdmin = await iniciarSesion(adminEmail);

    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: `vendedor-duraciones-${randomUUID()}@test.local`, passwordHash: hash, nombre: "Vendedor", rol: "VENDEDOR" },
    });
    vendedorId = vendedor.id;
    emailsUsuarios.push(vendedor.email);

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (duraciones.test)", capacidadPantallas: 4, usaPerfilPin: false },
    });

    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Nuevo (duraciones.test)" },
    });

    const duracionOriginal = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días original", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracionOriginal.id;

    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataforma.id, correo: "cuenta@test.local", password: "cifrado", capacidadPantallas: 4 },
    });

    const pantalla = await prismaRaw.pantalla.create({
      data: { empresaId, cuentaId: cuenta.id, numero: 1 },
    });

    const fechaVencimiento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const venta = await prismaRaw.venta.create({
      data: {
        empresaId,
        vendedorId,
        codigoCompra: `DUR-${randomUUID()}`,
        tipoVenta: "UNIDAD",
        plataformaId: plataforma.id,
        duracionId: duracionOriginal.id,
        tipoClienteId: tipoCliente.id,
        // Copias inmutables (R3) — el nombre y cantidad de la duración
        // ORIGINAL, capturados al momento de la venta.
        nombreItem: plataforma.nombre,
        nombreDuracion: duracionOriginal.nombre,
        cantidadDuracion: duracionOriginal.cantidad,
        unidadDuracion: duracionOriginal.unidad,
        nombreTipoCliente: tipoCliente.nombre,
        precioVenta: "20000",
        costo: "10000",
        utilidad: "10000",
        fechaVencimientoMax: fechaVencimiento,
        mensajeGenerado: "Mensaje de prueba (duraciones.test)",
      },
    });
    ventaId = venta.id;

    const ventaDetalle = await prismaRaw.ventaDetalle.create({
      data: {
        empresaId,
        ventaId: venta.id,
        pantallaId: pantalla.id,
        cuentaId: cuenta.id,
        plataformaId: plataforma.id,
        nombrePlataforma: plataforma.nombre,
        correoCuenta: cuenta.correo,
        passwordCuenta: cuenta.password,
        duracionId: duracionOriginal.id,
        cantidadDuracion: duracionOriginal.cantidad,
        unidadDuracion: duracionOriginal.unidad,
        fechaVencimiento,
      },
    });
    ventaDetalleId = ventaDetalle.id;
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("e) editar nombre y cantidad de una Duracion no altera las copias ya guardadas en Venta/VentaDetalle", async () => {
    const { status, cuerpo } = await peticion("PATCH", `/duraciones/${duracionId}`, cookieAdmin, {
      nombre: "45 días editado",
      cantidad: 45,
      unidad: "DIAS",
    });
    expect(status).toBe(200);
    expect(cuerpo.duracion.nombre).toBe("45 días editado");
    expect(cuerpo.duracion.cantidad).toBe(45);

    const ventaSinCambios = await prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaId } });
    expect(ventaSinCambios.nombreDuracion).toBe("30 días original");
    expect(ventaSinCambios.cantidadDuracion).toBe(30);

    const detalleSinCambios = await prismaRaw.ventaDetalle.findUniqueOrThrow({ where: { id: ventaDetalleId } });
    expect(detalleSinCambios.cantidadDuracion).toBe(30);
  });

  it("g) cantidad = 0 es rechazada por la validación del servidor", async () => {
    const { status } = await peticion("POST", "/duraciones", cookieAdmin, {
      nombre: `Cantidad cero ${randomUUID()}`,
      cantidad: 0,
      unidad: "DIAS",
    });
    expect(status).toBe(422);
  });

  it("g) cantidad negativa es rechazada por la validación del servidor", async () => {
    const { status } = await peticion("POST", "/duraciones", cookieAdmin, {
      nombre: `Cantidad negativa ${randomUUID()}`,
      cantidad: -5,
      unidad: "DIAS",
    });
    expect(status).toBe(422);
  });
});
