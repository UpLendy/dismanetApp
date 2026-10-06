import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita — arma la fixture (empresa,
// catálogo y la venta ya registrada) fuera de cualquier contexto de empresa
// autenticado, igual que diagnostico-empresa.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { cifrar } from "../lib/cifrado.ts";
import { auth } from "./auth.ts";
import { plantillas } from "./plantillas.ts";

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
  const respuesta = await plantillas.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

describe("PUT /plantillas/:tipo — inmutabilidad del histórico (R3)", () => {
  let empresaId: string;
  let adminEmail: string;
  let ventaId: string;
  const MENSAJE_ORIGINAL = "Mensaje ya entregado al comprador — no debe cambiar nunca (plantillas.test)";

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa plantillas (plantillas.test)", prefijoCodigo: "PLT" },
    });
    empresaId = empresa.id;

    adminEmail = `admin-plt-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (PLT)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (PLT)", cantidad: 30, unidad: "DIAS" },
    });
    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (PLT)" } });
    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataforma.id, correo: "plt@plantillas.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    const pantalla = await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 1 } });
    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: `vendedor-plt-${randomUUID()}@test.local`, passwordHash: "x", nombre: "V", rol: "VENDEDOR" },
    });

    // La venta ya registrada: su mensajeGenerado es una copia congelada en el
    // momento de la venta (R3) — PUT /plantillas no debe tocarla jamás,
    // aunque cambie la plantilla que la originó.
    const venta = await prismaRaw.venta.create({
      data: {
        empresaId,
        vendedorId: vendedor.id,
        codigoCompra: `PLT${randomUUID().slice(0, 6)}`,
        tipoVenta: "UNIDAD",
        plataformaId: plataforma.id,
        duracionId: duracion.id,
        tipoClienteId: tipoCliente.id,
        nombreItem: "Netflix",
        nombreDuracion: "30 días",
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        nombreTipoCliente: "Nuevo",
        precioVenta: "15000",
        costo: "8000",
        utilidad: "7000",
        fechaVencimientoMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        mensajeGenerado: MENSAJE_ORIGINAL,
      },
    });
    ventaId = venta.id;
    await prismaRaw.ventaDetalle.create({
      data: {
        empresaId,
        ventaId: venta.id,
        pantallaId: pantalla.id,
        cuentaId: cuenta.id,
        plataformaId: plataforma.id,
        nombrePlataforma: "Netflix",
        correoCuenta: "plt@plantillas.test",
        passwordCuenta: cifrar("clave"),
        duracionId: duracion.id,
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("editar la plantilla UNIDAD no altera el mensajeGenerado de una venta ya registrada", async () => {
    const cookieAdmin = await iniciarSesion(adminEmail);

    const { status } = await peticion("PUT", "/plantillas/UNIDAD", cookieAdmin, {
      contenido: "Plantilla editada después de la venta — {{codigoCompra}} / {{plataforma}} / {{perfil}} / {{pin}} / {{correo}} / {{clave}} / {{duracion}}",
    });
    expect(status).toBe(200);

    const ventaTrasEditar = await prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaId } });
    expect(ventaTrasEditar.mensajeGenerado).toBe(MENSAJE_ORIGINAL);
  });

  it("restaurar la plantilla por defecto tampoco altera el histórico", async () => {
    const cookieAdmin = await iniciarSesion(adminEmail);

    const { status } = await peticion("POST", "/plantillas/UNIDAD/restaurar", cookieAdmin);
    expect(status).toBe(200);

    const ventaTrasRestaurar = await prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaId } });
    expect(ventaTrasRestaurar.mensajeGenerado).toBe(MENSAJE_ORIGINAL);
  });
});
