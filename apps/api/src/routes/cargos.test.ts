import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita, igual que tipos-cliente.test.ts
// — arma la fixture (empresas/admins de partida) fuera de cualquier contexto
// de empresa autenticado.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { cargos } from "./cargos.ts";
import { usuarios } from "./usuarios.ts";

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

async function peticionCargos(metodo: string, ruta: string, cookie: string, cuerpo?: unknown) {
  const respuesta = await cargos.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

async function peticionUsuarios(metodo: string, ruta: string, cookie: string, cuerpo?: unknown) {
  const respuesta = await usuarios.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

describe("Cargos — catálogo y asignación (F6.1)", () => {
  let empresaAId: string;
  let empresaBId: string;
  let cookieAdminA: string;
  let cookieAdminB: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresaA = await prismaRaw.empresa.create({
      data: { nombre: "Empresa cargos A (cargos.test)", prefijoCodigo: "CGA" },
    });
    empresaAId = empresaA.id;
    idsEmpresas.push(empresaAId);

    const empresaB = await prismaRaw.empresa.create({
      data: { nombre: "Empresa cargos B (cargos.test)", prefijoCodigo: "CGB" },
    });
    empresaBId = empresaB.id;
    idsEmpresas.push(empresaBId);

    const adminAEmail = `admin-cargos-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminAEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: adminAEmail, passwordHash: hash, nombre: "Admin A", rol: "ADMIN" },
    });
    cookieAdminA = await iniciarSesion(adminAEmail);

    const adminBEmail = `admin-cargos-b-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminBEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaBId, email: adminBEmail, passwordHash: hash, nombre: "Admin B", rol: "ADMIN" },
    });
    cookieAdminB = await iniciarSesion(adminBEmail);
  });

  afterAll(async () => {
    await prismaRaw.usuario.updateMany({
      where: { empresaId: { in: idsEmpresas } },
      data: { cargoId: null },
    });
    await prismaRaw.cargo.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("R1: un cargo creado en la empresa A nunca aparece en el listado de la empresa B", async () => {
    const nombre = `Cargo aislado ${randomUUID()}`;
    const creado = await peticionCargos("POST", "/cargos", cookieAdminA, { nombre });
    expect(creado.status).toBe(201);

    const listadoB = await peticionCargos("GET", "/cargos", cookieAdminB);
    expect(listadoB.cuerpo.cargos.some((c: { nombre: string }) => c.nombre === nombre)).toBe(false);

    const listadoA = await peticionCargos("GET", "/cargos", cookieAdminA);
    expect(listadoA.cuerpo.cargos.some((c: { nombre: string }) => c.nombre === nombre)).toBe(true);
  });

  it("R1: asignarle a un usuario de la empresa B un cargoId de la empresa A falla con 404 CARGO_INVALIDO", async () => {
    const cargoDeA = await peticionCargos("POST", "/cargos", cookieAdminA, {
      nombre: `Cargo de A ${randomUUID()}`,
    });
    expect(cargoDeA.status).toBe(201);
    const cargoIdDeA = cargoDeA.cuerpo.cargo.id;

    const creadoEnB = await peticionUsuarios("POST", "/usuarios", cookieAdminB, {
      nombre: "Empleado B",
      email: `empleado-cargos-b-${randomUUID()}@test.local`,
      password: CONTRASENA,
      rol: "EMPLEADO",
      cargoId: cargoIdDeA,
    });
    expect(creadoEnB.status).toBe(404);
    expect(creadoEnB.cuerpo.error.codigo).toBe("CARGO_INVALIDO");

    // Tampoco por la ruta de edición (PATCH /:id/cargo), sobre un usuario
    // que ya existe en B sin cargo.
    const usuarioB = await peticionUsuarios("POST", "/usuarios", cookieAdminB, {
      nombre: "Empleado B sin cargo",
      email: `empleado-cargos-b-sin-cargo-${randomUUID()}@test.local`,
      password: CONTRASENA,
      rol: "EMPLEADO",
    });
    expect(usuarioB.status).toBe(201);
    expect(usuarioB.cuerpo.usuario.cargo).toBeNull();

    const edicion = await peticionUsuarios(
      "PATCH",
      `/usuarios/${usuarioB.cuerpo.usuario.id}/cargo`,
      cookieAdminB,
      { cargoId: cargoIdDeA },
    );
    expect(edicion.status).toBe(404);
    expect(edicion.cuerpo.error.codigo).toBe("CARGO_INVALIDO");
  });

  it("nombre duplicado en la misma empresa responde 409; el mismo nombre en dos empresas distintas es válido", async () => {
    const nombre = `Soporte ${randomUUID()}`;

    const primeraVezA = await peticionCargos("POST", "/cargos", cookieAdminA, { nombre });
    expect(primeraVezA.status).toBe(201);

    const repetidoEnA = await peticionCargos("POST", "/cargos", cookieAdminA, { nombre });
    expect(repetidoEnA.status).toBe(409);
    expect(repetidoEnA.cuerpo.error.codigo).toBe("NOMBRE_EN_USO");

    const mismoNombreEnB = await peticionCargos("POST", "/cargos", cookieAdminB, { nombre });
    expect(mismoNombreEnB.status).toBe(201);
  });

  it("desactivar un cargo no desasigna a los usuarios que ya lo tienen", async () => {
    const cargo = await peticionCargos("POST", "/cargos", cookieAdminA, {
      nombre: `Coordinación ${randomUUID()}`,
    });
    expect(cargo.status).toBe(201);
    const cargoId = cargo.cuerpo.cargo.id;

    const usuario = await peticionUsuarios("POST", "/usuarios", cookieAdminA, {
      nombre: "Coordinador de prueba",
      email: `coordinador-${randomUUID()}@test.local`,
      password: CONTRASENA,
      rol: "EMPLEADO",
      cargoId,
    });
    expect(usuario.status).toBe(201);
    expect(usuario.cuerpo.usuario.cargo).toEqual({ id: cargoId, nombre: cargo.cuerpo.cargo.nombre });

    const desactivado = await peticionCargos("PATCH", `/cargos/${cargoId}/desactivar`, cookieAdminA);
    expect(desactivado.status).toBe(200);
    expect(desactivado.cuerpo.cargo.activo).toBe(false);

    const listado = await peticionUsuarios("GET", "/usuarios", cookieAdminA);
    const fila = listado.cuerpo.usuarios.find((u: { id: string }) => u.id === usuario.cuerpo.usuario.id);
    expect(fila.cargo).toEqual({ id: cargoId, nombre: cargo.cuerpo.cargo.nombre });
  });

  it("un usuario sin cargo (null) se crea, se edita y se lista sin problema", async () => {
    const usuario = await peticionUsuarios("POST", "/usuarios", cookieAdminA, {
      nombre: "Sin cargo",
      email: `sin-cargo-${randomUUID()}@test.local`,
      password: CONTRASENA,
      rol: "EMPLEADO",
    });
    expect(usuario.status).toBe(201);
    expect(usuario.cuerpo.usuario.cargo).toBeNull();

    const edicion = await peticionUsuarios("PATCH", `/usuarios/${usuario.cuerpo.usuario.id}/cargo`, cookieAdminA, {
      cargoId: null,
    });
    expect(edicion.status).toBe(200);
    expect(edicion.cuerpo.usuario.cargo).toBeNull();

    const listado = await peticionUsuarios("GET", "/usuarios", cookieAdminA);
    const fila = listado.cuerpo.usuarios.find((u: { id: string }) => u.id === usuario.cuerpo.usuario.id);
    expect(fila.cargo).toBeNull();
  });
});
