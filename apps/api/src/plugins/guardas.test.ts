import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { prismaRaw } from "../lib/prisma.ts";
import { Rol } from "../generated/prisma/client.ts";
import { jwtSesion, NOMBRE_COOKIE_SESION, type PayloadJwt } from "./contexto.ts";
import { requiereAutenticacion, requiereRol } from "./guardas.ts";

// App auxiliar solo para firmar tokens de prueba con el mismo plugin/secreto
// que usa el API real (jwtSesion) — no reimplementa la firma a mano.
const firmador = new Elysia().use(jwtSesion).post("/firmar", async ({ jwt, body }) => jwt.sign(body as never));

async function token(payload: PayloadJwt): Promise<string> {
  const respuesta = await firmador.handle(
    new Request("http://local/firmar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  return respuesta.text();
}

const appAutenticado = new Elysia().use(requiereAutenticacion).get("/ruta", () => ({ ok: true }));
const appAdmin = new Elysia().use(requiereRol(Rol.ADMIN)).get("/ruta", () => ({ ok: true }));
const appSuperAdmin = new Elysia().use(requiereRol(Rol.SUPER_ADMIN)).get("/ruta", () => ({ ok: true }));

function peticionCon(tok?: string) {
  return new Request("http://local/ruta", {
    headers: tok ? { cookie: `${NOMBRE_COOKIE_SESION}=${tok}` } : {},
  });
}

describe("R4 — guardas de rol", () => {
  let empresaId: string;
  let vendedorId: string;
  let adminId: string;
  let superAdminId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({ data: { nombre: "Empresa guardas", prefijoCodigo: "GRD" } });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: `vendedor-guardas-${Date.now()}@test.local`, passwordHash: "x", nombre: "V", rol: "VENDEDOR" },
    });
    vendedorId = vendedor.id;

    const admin = await prismaRaw.usuario.create({
      data: { empresaId, email: `admin-guardas-${Date.now()}@test.local`, passwordHash: "x", nombre: "A", rol: "ADMIN" },
    });
    adminId = admin.id;

    // empresaId nulo: así es el registro real de un SUPER_ADMIN (ver
    // schema.prisma). contexto.ts ahora busca el usuario por id en cada
    // petición (para comparar versionSesion), así que el id del token debe
    // existir de verdad en la base — un id inventado ya no basta.
    const superAdmin = await prismaRaw.usuario.create({
      data: {
        empresaId: null,
        email: `super-admin-guardas-${Date.now()}@test.local`,
        passwordHash: "x",
        nombre: "S",
        rol: "SUPER_ADMIN",
      },
    });
    superAdminId = superAdmin.id;
  });

  afterAll(async () => {
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.delete({ where: { id: superAdminId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("sin cookie de sesión: 401 en una ruta que solo exige autenticación", async () => {
    const respuesta = await appAutenticado.handle(peticionCon());
    expect(respuesta.status).toBe(401);
  });

  it("con sesión válida: 200 en una ruta que solo exige autenticación", async () => {
    const tok = await token({ usuarioId: vendedorId, rol: Rol.VENDEDOR, empresaId, versionSesion: 1 });
    const respuesta = await appAutenticado.handle(peticionCon(tok));
    expect(respuesta.status).toBe(200);
  });

  it("VENDEDOR: 403 en una ruta que exige ADMIN", async () => {
    const tok = await token({ usuarioId: vendedorId, rol: Rol.VENDEDOR, empresaId, versionSesion: 1 });
    const respuesta = await appAdmin.handle(peticionCon(tok));
    expect(respuesta.status).toBe(403);
  });

  it("VENDEDOR: 403 en una ruta que exige SUPER_ADMIN", async () => {
    const tok = await token({ usuarioId: vendedorId, rol: Rol.VENDEDOR, empresaId, versionSesion: 1 });
    const respuesta = await appSuperAdmin.handle(peticionCon(tok));
    expect(respuesta.status).toBe(403);
  });

  it("ADMIN: 403 en una ruta que exige SUPER_ADMIN", async () => {
    const tok = await token({ usuarioId: adminId, rol: Rol.ADMIN, empresaId, versionSesion: 1 });
    const respuesta = await appSuperAdmin.handle(peticionCon(tok));
    expect(respuesta.status).toBe(403);
  });

  it("ADMIN: 200 en una ruta que exige ADMIN (no bloquea al rol que sí califica)", async () => {
    const tok = await token({ usuarioId: adminId, rol: Rol.ADMIN, empresaId, versionSesion: 1 });
    const respuesta = await appAdmin.handle(peticionCon(tok));
    expect(respuesta.status).toBe(200);
  });

  it("SUPER_ADMIN: 200 en rutas que exigen ADMIN o SUPER_ADMIN (jerarquía, no lista cerrada)", async () => {
    const tok = await token({ usuarioId: superAdminId, rol: Rol.SUPER_ADMIN, empresaId: null, versionSesion: 1 });

    const comoAdmin = await appAdmin.handle(peticionCon(tok));
    expect(comoAdmin.status).toBe(200);

    const comoSuperAdmin = await appSuperAdmin.handle(peticionCon(tok));
    expect(comoSuperAdmin.status).toBe(200);
  });
});
