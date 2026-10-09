import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita, igual que empresas.test.ts
// — arma la fixture (empresas/admins de partida) fuera de cualquier contexto
// de empresa autenticado.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { plataformas } from "./plataformas.ts";

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
  const respuesta = await plataformas.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

const datosPlataforma = {
  nombre: "Netflix",
  capacidadPantallas: 4,
  usaPerfilPin: false,
};

describe("Plataformas — catálogo (b, c, d, g)", () => {
  let empresaAId: string;
  let adminAEmail: string;
  let cookieAdminA: string;

  let empresaBId: string;
  let adminBEmail: string;
  let cookieAdminB: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresaA = await prismaRaw.empresa.create({
      data: { nombre: "Empresa A (plataformas.test)", prefijoCodigo: "PLA" },
    });
    empresaAId = empresaA.id;
    idsEmpresas.push(empresaAId);
    adminAEmail = `admin-a-plataformas-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminAEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: adminAEmail, passwordHash: hash, nombre: "Admin A", rol: "ADMIN" },
    });

    const empresaB = await prismaRaw.empresa.create({
      data: { nombre: "Empresa B (plataformas.test)", prefijoCodigo: "PLB" },
    });
    empresaBId = empresaB.id;
    idsEmpresas.push(empresaBId);
    adminBEmail = `admin-b-plataformas-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminBEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaBId, email: adminBEmail, passwordHash: hash, nombre: "Admin B", rol: "ADMIN" },
    });

    cookieAdminA = await iniciarSesion(adminAEmail);
    cookieAdminB = await iniciarSesion(adminBEmail);
  });

  afterAll(async () => {
    await prismaRaw.plataforma.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("b) dos plataformas ACTIVAS con el mismo nombre en la misma empresa: la segunda falla con error de negocio, no 500", async () => {
    const primera = await peticion("POST", "/plataformas", cookieAdminA, datosPlataforma);
    expect(primera.status).toBe(201);

    const segunda = await peticion("POST", "/plataformas", cookieAdminA, datosPlataforma);
    expect(segunda.status).toBe(409);
    expect(segunda.cuerpo.error.codigo).toBe("NOMBRE_EN_USO");
  });

  it("c) desactivar una plataforma y luego crear otra con el mismo nombre funciona (índice parcial)", async () => {
    const nombre = `Disney+ ${randomUUID()}`;
    const creada = await peticion("POST", "/plataformas", cookieAdminA, { ...datosPlataforma, nombre });
    expect(creada.status).toBe(201);

    const desactivada = await peticion("PATCH", `/plataformas/${creada.cuerpo.plataforma.id}/desactivar`, cookieAdminA);
    expect(desactivada.status).toBe(200);
    expect(desactivada.cuerpo.plataforma.activa).toBe(false);

    const recreada = await peticion("POST", "/plataformas", cookieAdminA, { ...datosPlataforma, nombre });
    expect(recreada.status).toBe(201);
    expect(recreada.cuerpo.plataforma.activa).toBe(true);
  });

  it("d) dos empresas distintas pueden tener cada una su propia plataforma 'Netflix' (aislamiento por empresa)", async () => {
    const nombre = `Netflix aislamiento ${randomUUID()}`;
    const enA = await peticion("POST", "/plataformas", cookieAdminA, { ...datosPlataforma, nombre });
    const enB = await peticion("POST", "/plataformas", cookieAdminB, { ...datosPlataforma, nombre });

    expect(enA.status).toBe(201);
    expect(enB.status).toBe(201);

    const listaA = await peticion("GET", "/plataformas", cookieAdminA);
    const listaB = await peticion("GET", "/plataformas", cookieAdminB);
    const nombresA = listaA.cuerpo.plataformas.map((p: { nombre: string }) => p.nombre);
    const nombresB = listaB.cuerpo.plataformas.map((p: { nombre: string }) => p.nombre);
    expect(nombresA).toContain(nombre);
    expect(nombresB).toContain(nombre);
  });

  it("g) capacidadPantallas = 0 es rechazado por la validación del servidor", async () => {
    const { status } = await peticion("POST", "/plataformas", cookieAdminA, {
      ...datosPlataforma,
      nombre: `Capacidad cero ${randomUUID()}`,
      capacidadPantallas: 0,
    });
    expect(status).toBe(422);
  });
});

describe("Plataformas — plantilla de pantallas (/plataformas/:id/pantallas)", () => {
  let empresaAId: string;
  let adminAEmail: string;
  let cookieAdminA: string;

  let empresaBId: string;
  let adminBEmail: string;
  let cookieAdminB: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresaA = await prismaRaw.empresa.create({
      data: { nombre: "Empresa A (plataformas-pantallas.test)", prefijoCodigo: "PPA" },
    });
    empresaAId = empresaA.id;
    idsEmpresas.push(empresaAId);
    adminAEmail = `admin-a-pantallas-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminAEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: adminAEmail, passwordHash: hash, nombre: "Admin A", rol: "ADMIN" },
    });

    const empresaB = await prismaRaw.empresa.create({
      data: { nombre: "Empresa B (plataformas-pantallas.test)", prefijoCodigo: "PPB" },
    });
    empresaBId = empresaB.id;
    idsEmpresas.push(empresaBId);
    adminBEmail = `admin-b-pantallas-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminBEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaBId, email: adminBEmail, passwordHash: hash, nombre: "Admin B", rol: "ADMIN" },
    });

    cookieAdminA = await iniciarSesion(adminAEmail);
    cookieAdminB = await iniciarSesion(adminBEmail);
  });

  afterAll(async () => {
    await prismaRaw.plataformaPantalla.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("GET de una plataforma recién creada devuelve la plantilla vacía", async () => {
    const creada = await peticion("POST", "/plataformas", cookieAdminA, {
      nombre: `Sin plantilla ${randomUUID()}`,
      capacidadPantallas: 4,
      usaPerfilPin: true,
    });
    const { status, cuerpo } = await peticion("GET", `/plataformas/${creada.cuerpo.plataforma.id}/pantallas`, cookieAdminA);
    expect(status).toBe(200);
    expect(cuerpo.capacidadPantallas).toBe(0);
    expect(cuerpo.pantallas).toEqual([]);
  });

  it("PUT define la plantilla con perfil y pin, y el GET posterior la devuelve descifrada", async () => {
    const creada = await peticion("POST", "/plataformas", cookieAdminA, {
      nombre: `Con perfil y pin ${randomUUID()}`,
      capacidadPantallas: 4,
      usaPerfilPin: true,
    });
    const id = creada.cuerpo.plataforma.id;

    const puesta = await peticion("PUT", `/plataformas/${id}/pantallas`, cookieAdminA, {
      pantallas: [
        { perfil: "A", pin: "1234" },
        { perfil: "B", pin: "5678" },
        { perfil: "C", pin: "9012" },
      ],
    });
    expect(puesta.status).toBe(200);
    expect(puesta.cuerpo.capacidadPantallas).toBe(3);
    expect(puesta.cuerpo.pantallas).toEqual([
      { numero: 1, perfil: "A", pin: "1234" },
      { numero: 2, perfil: "B", pin: "5678" },
      { numero: 3, perfil: "C", pin: "9012" },
    ]);

    const obtenida = await peticion("GET", `/plataformas/${id}/pantallas`, cookieAdminA);
    expect(obtenida.cuerpo).toEqual(puesta.cuerpo);

    const plataforma = await prismaRaw.plataforma.findUniqueOrThrow({ where: { id } });
    expect(plataforma.capacidadPantallas).toBe(3);
  });

  it("si la plataforma no usa perfil/pin, se ignoran aunque lleguen en el body", async () => {
    const creada = await peticion("POST", "/plataformas", cookieAdminA, {
      nombre: `Sin perfil/pin ${randomUUID()}`,
      capacidadPantallas: 4,
      usaPerfilPin: false,
    });
    const id = creada.cuerpo.plataforma.id;

    const puesta = await peticion("PUT", `/plataformas/${id}/pantallas`, cookieAdminA, {
      pantallas: [{ perfil: "A", pin: "1234" }],
    });
    expect(puesta.status).toBe(200);
    expect(puesta.cuerpo.pantallas).toEqual([{ numero: 1, perfil: null, pin: null }]);
  });

  it("bajar la cantidad de filas borra solo las de la plantilla que sobran", async () => {
    const creada = await peticion("POST", "/plataformas", cookieAdminA, {
      nombre: `Baja de plantilla ${randomUUID()}`,
      capacidadPantallas: 4,
      usaPerfilPin: true,
    });
    const id = creada.cuerpo.plataforma.id;

    await peticion("PUT", `/plataformas/${id}/pantallas`, cookieAdminA, {
      pantallas: [{ perfil: "A", pin: "1111" }, { perfil: "B", pin: "2222" }, { perfil: "C", pin: "3333" }],
    });
    const bajada = await peticion("PUT", `/plataformas/${id}/pantallas`, cookieAdminA, {
      pantallas: [{ perfil: "A", pin: "1111" }],
    });
    expect(bajada.status).toBe(200);
    expect(bajada.cuerpo.pantallas).toEqual([{ numero: 1, perfil: "A", pin: "1111" }]);

    const filas = await prismaRaw.plataformaPantalla.findMany({ where: { plataformaId: id } });
    expect(filas).toHaveLength(1);
  });

  it("GET y PUT de una plataforma inexistente devuelven 404, no 500", async () => {
    const idInexistente = "cm00000000000000000000000";
    const get = await peticion("GET", `/plataformas/${idInexistente}/pantallas`, cookieAdminA);
    expect(get.status).toBe(404);
    expect(get.cuerpo.error.codigo).toBe("PLATAFORMA_NO_ENCONTRADA");

    const put = await peticion("PUT", `/plataformas/${idInexistente}/pantallas`, cookieAdminA, {
      pantallas: [{ perfil: "A", pin: "1234" }],
    });
    expect(put.status).toBe(404);
    expect(put.cuerpo.error.codigo).toBe("PLATAFORMA_NO_ENCONTRADA");
  });

  it("aislamiento entre empresas: el admin de la empresa B no puede ver ni editar la plantilla de una plataforma de A", async () => {
    const creada = await peticion("POST", "/plataformas", cookieAdminA, {
      nombre: `Solo de A ${randomUUID()}`,
      capacidadPantallas: 4,
      usaPerfilPin: true,
    });
    const id = creada.cuerpo.plataforma.id;

    const get = await peticion("GET", `/plataformas/${id}/pantallas`, cookieAdminB);
    expect(get.status).toBe(404);

    const put = await peticion("PUT", `/plataformas/${id}/pantallas`, cookieAdminB, {
      pantallas: [{ perfil: "A", pin: "1234" }],
    });
    expect(put.status).toBe(404);
  });
});
