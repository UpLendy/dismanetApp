import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita, igual que plataformas.test.ts
// — arma la fixture (empresa, admin, plataformas, duraciones) fuera de
// cualquier contexto de empresa autenticado.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { paquetes } from "./paquetes.ts";

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
  const respuesta = await paquetes.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

describe("Paquetes — CRUD, composición y excepciones de duración (c, d, e, f)", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let netflixId: string;
  let disneyId: string;
  let duracion14Id: string;
  let duracion28Id: string;
  let duracion30Id: string;
  let duracionInactivaId: string;
  let plataformaInactivaId: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa paquetes (paquetes.test)", prefijoCodigo: "PAQ" },
    });
    empresaId = empresa.id;
    idsEmpresas.push(empresaId);

    const adminEmail = `admin-paquetes-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminEmail);
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });
    cookieAdmin = await iniciarSesion(adminEmail);

    const netflix = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (paquetes.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    netflixId = netflix.id;

    const disney = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ Premium (paquetes.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    disneyId = disney.id;

    const plataformaInactiva = await prismaRaw.plataforma.create({
      data: {
        empresaId,
        nombre: "Plataforma inactiva (paquetes.test)",
        capacidadPantallas: 1,
        usaPerfilPin: false,
        activa: false,
      },
    });
    plataformaInactivaId = plataformaInactiva.id;

    const d14 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "14 días (paquetes.test)", cantidad: 14, unidad: "DIAS" },
    });
    duracion14Id = d14.id;

    const d28 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "28 días (paquetes.test)", cantidad: 28, unidad: "DIAS" },
    });
    duracion28Id = d28.id;

    const d30 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (paquetes.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracion30Id = d30.id;

    const dInactiva = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "Inactiva (paquetes.test)", cantidad: 7, unidad: "DIAS", activa: false },
    });
    duracionInactivaId = dInactiva.id;
  });

  afterAll(async () => {
    await prismaRaw.paqueteDuracionPlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquetePlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquete.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("c) un paquete sin plataformas no se puede activar, y no puede quedarse sin la última al quitarla estando activo", async () => {
    const creado = await peticion("POST", "/paquetes", cookieAdmin, { nombre: `Sin plataformas ${randomUUID()}` });
    expect(creado.status).toBe(201);
    const paqueteId = creado.cuerpo.paquete.id;

    const activarVacio = await peticion("PATCH", `/paquetes/${paqueteId}/activar`, cookieAdmin);
    expect(activarVacio.status).toBe(400);
    expect(activarVacio.cuerpo.error.codigo).toBe("PAQUETE_SIN_PLATAFORMAS");

    const agregada = await peticion("POST", `/paquetes/${paqueteId}/plataformas`, cookieAdmin, {
      plataformaId: netflixId,
    });
    expect(agregada.status).toBe(201);

    const activado = await peticion("PATCH", `/paquetes/${paqueteId}/activar`, cookieAdmin);
    expect(activado.status).toBe(200);
    expect(activado.cuerpo.paquete.activo).toBe(true);

    const quitarUltima = await peticion("DELETE", `/paquetes/${paqueteId}/plataformas/${netflixId}`, cookieAdmin);
    expect(quitarUltima.status).toBe(400);
    expect(quitarUltima.cuerpo.error.codigo).toBe("PAQUETE_SIN_PLATAFORMAS");

    const sigueComponente = await prismaRaw.paquetePlataforma.findUnique({
      where: { paqueteId_plataformaId: { paqueteId, plataformaId: netflixId } },
    });
    expect(sigueComponente).not.toBeNull();
  });

  it("d) quitar una plataforma de la composición elimina también sus excepciones de duración", async () => {
    const creado = await peticion("POST", "/paquetes", cookieAdmin, { nombre: `Cascada ${randomUUID()}` });
    const paqueteId = creado.cuerpo.paquete.id;

    await peticion("POST", `/paquetes/${paqueteId}/plataformas`, cookieAdmin, { plataformaId: netflixId });
    await peticion("POST", `/paquetes/${paqueteId}/plataformas`, cookieAdmin, { plataformaId: disneyId });

    const excepcion = await peticion("PUT", `/paquetes/${paqueteId}/excepciones`, cookieAdmin, {
      duracionVendidaId: duracion30Id,
      plataformaId: netflixId,
      duracionRealId: duracion28Id,
    });
    expect(excepcion.status).toBe(200);
    expect(excepcion.cuerpo.excepcion).not.toBeNull();

    const antes = await prismaRaw.paqueteDuracionPlataforma.count({ where: { paqueteId, plataformaId: netflixId } });
    expect(antes).toBe(1);

    const quitar = await peticion("DELETE", `/paquetes/${paqueteId}/plataformas/${netflixId}`, cookieAdmin);
    expect(quitar.status).toBe(200);

    const despues = await prismaRaw.paqueteDuracionPlataforma.count({
      where: { paqueteId, plataformaId: netflixId },
    });
    expect(despues).toBe(0);
  });

  it("e) guardar una excepción con duracionReal = duracionVendida no crea fila; si existía, la borra", async () => {
    const creado = await peticion("POST", "/paquetes", cookieAdmin, { nombre: `Igual a la vendida ${randomUUID()}` });
    const paqueteId = creado.cuerpo.paquete.id;
    await peticion("POST", `/paquetes/${paqueteId}/plataformas`, cookieAdmin, { plataformaId: netflixId });

    // Intento directo con duracionReal = duracionVendida: nunca se crea.
    const intento = await peticion("PUT", `/paquetes/${paqueteId}/excepciones`, cookieAdmin, {
      duracionVendidaId: duracion30Id,
      plataformaId: netflixId,
      duracionRealId: duracion30Id,
    });
    expect(intento.status).toBe(200);
    expect(intento.cuerpo.excepcion).toBeNull();
    const sinFila = await prismaRaw.paqueteDuracionPlataforma.count({ where: { paqueteId, plataformaId: netflixId } });
    expect(sinFila).toBe(0);

    // Primero se crea una excepción real (28 ≠ 30)...
    const creada = await peticion("PUT", `/paquetes/${paqueteId}/excepciones`, cookieAdmin, {
      duracionVendidaId: duracion30Id,
      plataformaId: netflixId,
      duracionRealId: duracion28Id,
    });
    expect(creada.status).toBe(200);
    expect(creada.cuerpo.excepcion).not.toBeNull();

    // ...y volver a "igual a la vendida" la borra.
    const revertida = await peticion("PUT", `/paquetes/${paqueteId}/excepciones`, cookieAdmin, {
      duracionVendidaId: duracion30Id,
      plataformaId: netflixId,
      duracionRealId: duracion30Id,
    });
    expect(revertida.status).toBe(200);
    expect(revertida.cuerpo.excepcion).toBeNull();

    const filaFinal = await prismaRaw.paqueteDuracionPlataforma.findUnique({
      where: {
        paqueteId_duracionVendidaId_plataformaId: { paqueteId, duracionVendidaId: duracion30Id, plataformaId: netflixId },
      },
    });
    expect(filaFinal).toBeNull();
  });

  it("e) una excepción donde la duración real es mayor que la vendida se guarda con advertencia", async () => {
    const creado = await peticion("POST", "/paquetes", cookieAdmin, { nombre: `Advertencia ${randomUUID()}` });
    const paqueteId = creado.cuerpo.paquete.id;
    await peticion("POST", `/paquetes/${paqueteId}/plataformas`, cookieAdmin, { plataformaId: netflixId });

    const respuesta = await peticion("PUT", `/paquetes/${paqueteId}/excepciones`, cookieAdmin, {
      duracionVendidaId: duracion14Id,
      plataformaId: netflixId,
      duracionRealId: duracion30Id,
    });
    expect(respuesta.status).toBe(200);
    expect(respuesta.cuerpo.excepcion).not.toBeNull();
    expect(respuesta.cuerpo.advertencia).toBe("Estás entregando más tiempo del que vendes.");
  });

  it("f) agregar dos veces la misma plataforma a un paquete devuelve error de negocio, no 500", async () => {
    const creado = await peticion("POST", "/paquetes", cookieAdmin, { nombre: `Duplicada ${randomUUID()}` });
    const paqueteId = creado.cuerpo.paquete.id;

    const primera = await peticion("POST", `/paquetes/${paqueteId}/plataformas`, cookieAdmin, {
      plataformaId: netflixId,
    });
    expect(primera.status).toBe(201);

    const segunda = await peticion("POST", `/paquetes/${paqueteId}/plataformas`, cookieAdmin, {
      plataformaId: netflixId,
    });
    expect(segunda.status).toBe(409);
    expect(segunda.cuerpo.error.codigo).toBe("PLATAFORMA_DUPLICADA");
  });

  it("solo se pueden agregar plataformas activas a un paquete", async () => {
    const creado = await peticion("POST", "/paquetes", cookieAdmin, { nombre: `Plataforma inactiva ${randomUUID()}` });
    const paqueteId = creado.cuerpo.paquete.id;

    const respuesta = await peticion("POST", `/paquetes/${paqueteId}/plataformas`, cookieAdmin, {
      plataformaId: plataformaInactivaId,
    });
    expect(respuesta.status).toBe(400);
    expect(respuesta.cuerpo.error.codigo).toBe("PLATAFORMA_INACTIVA");
  });

  it("la plataforma de una excepción debe pertenecer a la composición del paquete", async () => {
    const creado = await peticion("POST", "/paquetes", cookieAdmin, { nombre: `Sin Disney ${randomUUID()}` });
    const paqueteId = creado.cuerpo.paquete.id;
    await peticion("POST", `/paquetes/${paqueteId}/plataformas`, cookieAdmin, { plataformaId: netflixId });

    const respuesta = await peticion("PUT", `/paquetes/${paqueteId}/excepciones`, cookieAdmin, {
      duracionVendidaId: duracion30Id,
      plataformaId: disneyId,
      duracionRealId: duracion28Id,
    });
    expect(respuesta.status).toBe(400);
    expect(respuesta.cuerpo.error.codigo).toBe("PLATAFORMA_NO_EN_PAQUETE");
  });

  it("ambas duraciones de una excepción deben estar activas", async () => {
    const creado = await peticion("POST", "/paquetes", cookieAdmin, { nombre: `Duracion inactiva ${randomUUID()}` });
    const paqueteId = creado.cuerpo.paquete.id;
    await peticion("POST", `/paquetes/${paqueteId}/plataformas`, cookieAdmin, { plataformaId: netflixId });

    const respuesta = await peticion("PUT", `/paquetes/${paqueteId}/excepciones`, cookieAdmin, {
      duracionVendidaId: duracion30Id,
      plataformaId: netflixId,
      duracionRealId: duracionInactivaId,
    });
    expect(respuesta.status).toBe(400);
    expect(respuesta.cuerpo.error.codigo).toBe("DURACION_INACTIVA");
  });

  it("cantidadPantallas >= 1 es validado por el servidor", async () => {
    const creado = await peticion("POST", "/paquetes", cookieAdmin, { nombre: `Cantidad cero ${randomUUID()}` });
    const paqueteId = creado.cuerpo.paquete.id;

    const respuesta = await peticion("POST", `/paquetes/${paqueteId}/plataformas`, cookieAdmin, {
      plataformaId: netflixId,
      cantidadPantallas: 0,
    });
    expect(respuesta.status).toBe(422);
  });

  it("dos paquetes ACTIVOS con el mismo nombre: el segundo falla con error de negocio, no 500", async () => {
    const nombre = `Paquete duplicado ${randomUUID()}`;
    const primera = await peticion("POST", "/paquetes", cookieAdmin, { nombre });
    expect(primera.status).toBe(201);

    const segunda = await peticion("POST", "/paquetes", cookieAdmin, { nombre });
    expect(segunda.status).toBe(409);
    expect(segunda.cuerpo.error.codigo).toBe("NOMBRE_EN_USO");
  });
});
