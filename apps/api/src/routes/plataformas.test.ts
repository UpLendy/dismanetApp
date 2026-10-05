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
