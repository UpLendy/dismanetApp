import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita — arma la fixture (empresa,
// vendedor, y una fila de catálogo existente por entidad) fuera de cualquier
// contexto de empresa autenticado.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { plataformas } from "./plataformas.ts";
import { duraciones } from "./duraciones.ts";
import { tiposCliente } from "./tipos-cliente.ts";
import { paquetes } from "./paquetes.ts";
import { precios } from "./precios.ts";

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

describe("Catálogo — un VENDEDOR recibe 403 en cada endpoint (f, h)", () => {
  let empresaId: string;
  let cookieVendedor: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;
  let paqueteId: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa permisos catálogo (catalogo-permisos.test)", prefijoCodigo: "CAT" },
    });
    empresaId = empresa.id;
    idsEmpresas.push(empresaId);

    const vendedorEmail = `vendedor-catalogo-${randomUUID()}@test.local`;
    emailsUsuarios.push(vendedorEmail);
    await prismaRaw.usuario.create({
      data: { empresaId, email: vendedorEmail, passwordHash: hash, nombre: "Vendedor", rol: "VENDEDOR" },
    });
    cookieVendedor = await iniciarSesion(vendedorEmail);

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (catalogo-permisos.test)", capacidadPantallas: 4, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (catalogo-permisos.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Nuevo (catalogo-permisos.test)" },
    });
    tipoClienteId = tipoCliente.id;

    const paquete = await prismaRaw.paquete.create({
      data: { empresaId, nombre: "Básico (catalogo-permisos.test)" },
    });
    paqueteId = paquete.id;
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId, plataformaId, cantidadPantallas: 1 },
    });
  });

  afterAll(async () => {
    await prismaRaw.paqueteDuracionPlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquetePlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquete.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  async function esperar403(app: { handle: (req: Request) => Promise<Response> }, metodo: string, ruta: string, cuerpo?: unknown) {
    const respuesta = await app.handle(
      new Request(`http://local${ruta}`, {
        method: metodo,
        headers: { "content-type": "application/json", cookie: cookieVendedor },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      }),
    );
    const texto = await respuesta.text();
    const json = texto ? JSON.parse(texto) : null;
    expect(respuesta.status).toBe(403);
    expect(json.error.codigo).toBe("PERMISO_DENEGADO");
  }

  it("plataformas: GET, POST, PATCH, activar, desactivar e impacto — todos 403", async () => {
    await esperar403(plataformas, "GET", "/plataformas");
    await esperar403(plataformas, "POST", "/plataformas", { nombre: "X", capacidadPantallas: 1, usaPerfilPin: false });
    await esperar403(plataformas, "PATCH", `/plataformas/${plataformaId}`, { nombre: "X", capacidadPantallas: 1, usaPerfilPin: false });
    await esperar403(plataformas, "GET", `/plataformas/${plataformaId}/impacto-desactivacion`);
    await esperar403(plataformas, "PATCH", `/plataformas/${plataformaId}/activar`);
    await esperar403(plataformas, "PATCH", `/plataformas/${plataformaId}/desactivar`);
  });

  it("duraciones: GET, POST, PATCH, activar, desactivar e impacto — todos 403", async () => {
    await esperar403(duraciones, "GET", "/duraciones");
    await esperar403(duraciones, "POST", "/duraciones", { nombre: "X", cantidad: 1, unidad: "DIAS" });
    await esperar403(duraciones, "PATCH", `/duraciones/${duracionId}`, { nombre: "X", cantidad: 1, unidad: "DIAS" });
    await esperar403(duraciones, "GET", `/duraciones/${duracionId}/impacto-desactivacion`);
    await esperar403(duraciones, "PATCH", `/duraciones/${duracionId}/activar`);
    await esperar403(duraciones, "PATCH", `/duraciones/${duracionId}/desactivar`);
  });

  it("tipos-cliente: GET, POST, PATCH, activar, desactivar e impacto — todos 403", async () => {
    await esperar403(tiposCliente, "GET", "/tipos-cliente");
    await esperar403(tiposCliente, "POST", "/tipos-cliente", { nombre: "X" });
    await esperar403(tiposCliente, "PATCH", `/tipos-cliente/${tipoClienteId}`, { nombre: "X" });
    await esperar403(tiposCliente, "GET", `/tipos-cliente/${tipoClienteId}/impacto-desactivacion`);
    await esperar403(tiposCliente, "PATCH", `/tipos-cliente/${tipoClienteId}/activar`);
    await esperar403(tiposCliente, "PATCH", `/tipos-cliente/${tipoClienteId}/desactivar`);
  });

  it("paquetes: CRUD, composición y excepciones — todos 403 (h)", async () => {
    await esperar403(paquetes, "GET", "/paquetes");
    await esperar403(paquetes, "POST", "/paquetes", { nombre: "X" });
    await esperar403(paquetes, "PATCH", `/paquetes/${paqueteId}`, { nombre: "X" });
    await esperar403(paquetes, "GET", `/paquetes/${paqueteId}/impacto-desactivacion`);
    await esperar403(paquetes, "PATCH", `/paquetes/${paqueteId}/activar`);
    await esperar403(paquetes, "PATCH", `/paquetes/${paqueteId}/desactivar`);
    await esperar403(paquetes, "POST", `/paquetes/${paqueteId}/plataformas`, { plataformaId, cantidadPantallas: 1 });
    await esperar403(paquetes, "PATCH", `/paquetes/${paqueteId}/plataformas/${plataformaId}`, { cantidadPantallas: 2 });
    await esperar403(paquetes, "DELETE", `/paquetes/${paqueteId}/plataformas/${plataformaId}`);
    await esperar403(paquetes, "PUT", `/paquetes/${paqueteId}/excepciones`, {
      duracionVendidaId: duracionId,
      plataformaId,
      duracionRealId: duracionId,
    });
  });

  it("precios: unidades y paquetes, GET y PUT — todos 403 (h)", async () => {
    await esperar403(precios, "GET", `/precios/unidades?plataformaId=${plataformaId}`);
    await esperar403(precios, "PUT", "/precios/unidades", {
      plataformaId,
      celdas: [{ duracionId, tipoClienteId, precioVenta: "1000", costo: "0" }],
    });
    await esperar403(precios, "GET", `/precios/paquetes?paqueteId=${paqueteId}`);
    await esperar403(precios, "PUT", "/precios/paquetes", {
      paqueteId,
      celdas: [{ duracionId, tipoClienteId, precioVenta: "1000", costo: "0" }],
    });
  });
});
