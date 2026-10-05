import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita, igual que auth.test.ts —
// arma la fixture (empresas y usuarios de prueba) fuera de cualquier
// contexto de empresa autenticado, que es justo lo que no puede hacer un
// cliente ya restringido por R1.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
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

async function peticion(metodo: string, ruta: string, cookie: string, cuerpo?: unknown) {
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

describe("Reglas de negocio de /usuarios (c, d, f)", () => {
  let empresaUnAdminId: string;
  let adminUnicoId: string;
  let adminUnicoEmail: string;
  let cookieSuperAdmin: string;

  let empresaDosAdminsId: string;
  let adminAEmail: string;
  let adminBId: string;
  let adminBEmail: string;

  let empresaEscaladaId: string;
  let adminEscaladaEmail: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];
  let emailSuperAdmin: string;

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    // SUPER_ADMIN: actúa DENTRO de "empresa un admin" vía la cookie
    // empresa_activa, sin ser él mismo el objetivo — así ULTIMO_ADMIN se
    // prueba sin confundirse con AUTO_MODIFICACION (que exige que el
    // objetivo sea el propio usuario autenticado).
    emailSuperAdmin = `superadmin-${randomUUID()}@test.local`;
    emailsUsuarios.push(emailSuperAdmin);
    await prismaRaw.usuario.create({
      data: { email: emailSuperAdmin, passwordHash: hash, nombre: "Super admin (usuarios.test)", rol: "SUPER_ADMIN" },
    });

    const empresaUnAdmin = await prismaRaw.empresa.create({
      data: { nombre: "Empresa un admin (usuarios.test)", prefijoCodigo: "UAD" },
    });
    empresaUnAdminId = empresaUnAdmin.id;
    idsEmpresas.push(empresaUnAdminId);

    adminUnicoEmail = `admin-unico-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminUnicoEmail);
    const adminUnico = await prismaRaw.usuario.create({
      data: { empresaId: empresaUnAdminId, email: adminUnicoEmail, passwordHash: hash, nombre: "Admin único", rol: "ADMIN" },
    });
    adminUnicoId = adminUnico.id;

    const empresaDosAdmins = await prismaRaw.empresa.create({
      data: { nombre: "Empresa dos admins (usuarios.test)", prefijoCodigo: "DAD" },
    });
    empresaDosAdminsId = empresaDosAdmins.id;
    idsEmpresas.push(empresaDosAdminsId);

    adminAEmail = `admin-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminAEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaDosAdminsId, email: adminAEmail, passwordHash: hash, nombre: "Admin A", rol: "ADMIN" },
    });

    adminBEmail = `admin-b-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminBEmail);
    const adminB = await prismaRaw.usuario.create({
      data: { empresaId: empresaDosAdminsId, email: adminBEmail, passwordHash: hash, nombre: "Admin B", rol: "ADMIN" },
    });
    adminBId = adminB.id;

    const empresaEscalada = await prismaRaw.empresa.create({
      data: { nombre: "Empresa escalada de rol (usuarios.test)", prefijoCodigo: "ESC" },
    });
    empresaEscaladaId = empresaEscalada.id;
    idsEmpresas.push(empresaEscaladaId);

    adminEscaladaEmail = `admin-escalada-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminEscaladaEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaEscaladaId, email: adminEscaladaEmail, passwordHash: hash, nombre: "Admin escalada", rol: "ADMIN" },
    });

    const cookieBase = await iniciarSesion(emailSuperAdmin);
    cookieSuperAdmin = `${cookieBase}; empresa_activa=${empresaUnAdminId}`;
  });

  afterAll(async () => {
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  describe("c) protección del último ADMIN activo", () => {
    it("un único ADMIN activo: desactivarlo falla con ULTIMO_ADMIN", async () => {
      const { status, cuerpo } = await peticion("PATCH", `/usuarios/${adminUnicoId}/desactivar`, cookieSuperAdmin);
      expect(status).toBe(409);
      expect(cuerpo.error.codigo).toBe("ULTIMO_ADMIN");
    });

    it("un único ADMIN activo: cambiarle el rol a VENDEDOR falla con ULTIMO_ADMIN", async () => {
      const { status, cuerpo } = await peticion("PATCH", `/usuarios/${adminUnicoId}/rol`, cookieSuperAdmin, {
        rol: "VENDEDOR",
      });
      expect(status).toBe(409);
      expect(cuerpo.error.codigo).toBe("ULTIMO_ADMIN");
    });

    it("dos ADMIN activos: desactivar uno de ellos sí funciona", async () => {
      const cookieAdminA = await iniciarSesion(adminAEmail);
      const { status, cuerpo } = await peticion("PATCH", `/usuarios/${adminBId}/desactivar`, cookieAdminA);
      expect(status).toBe(200);
      expect(cuerpo.usuario.activo).toBe(false);

      // Se revierte para no afectar otras pruebas de este describe.
      await prismaRaw.usuario.update({ where: { id: adminBId }, data: { activo: true } });
    });

    it("dos ADMIN activos: cambiarle el rol a VENDEDOR a uno de ellos sí funciona", async () => {
      const cookieAdminA = await iniciarSesion(adminAEmail);
      const { status, cuerpo } = await peticion("PATCH", `/usuarios/${adminBId}/rol`, cookieAdminA, {
        rol: "VENDEDOR",
      });
      expect(status).toBe(200);
      expect(cuerpo.usuario.rol).toBe("VENDEDOR");

      // Se revierte para no afectar otras pruebas de este describe.
      await prismaRaw.usuario.update({ where: { id: adminBId }, data: { rol: "ADMIN" } });
    });
  });

  describe("d) un usuario no puede modificarse a sí mismo", () => {
    it("un ADMIN no puede desactivarse a sí mismo", async () => {
      const cookieAdminA = await iniciarSesion(adminAEmail);
      const admin = await prismaRaw.usuario.findUniqueOrThrow({ where: { email: adminAEmail } });
      const { status, cuerpo } = await peticion("PATCH", `/usuarios/${admin.id}/desactivar`, cookieAdminA);
      expect(status).toBe(403);
      expect(cuerpo.error.codigo).toBe("AUTO_MODIFICACION");
    });

    it("un ADMIN no puede cambiar su propio rol", async () => {
      const cookieAdminA = await iniciarSesion(adminAEmail);
      const admin = await prismaRaw.usuario.findUniqueOrThrow({ where: { email: adminAEmail } });
      const { status, cuerpo } = await peticion("PATCH", `/usuarios/${admin.id}/rol`, cookieAdminA, {
        rol: "VENDEDOR",
      });
      expect(status).toBe(403);
      expect(cuerpo.error.codigo).toBe("AUTO_MODIFICACION");
    });
  });

  describe("f) un ADMIN no puede otorgar el rol SUPER_ADMIN", () => {
    it("POST /usuarios con rol SUPER_ADMIN: 403", async () => {
      const cookieAdmin = await iniciarSesion(adminEscaladaEmail);
      const correoNuevo = `intento-superadmin-${randomUUID()}@test.local`;
      const { status, cuerpo } = await peticion("POST", "/usuarios", cookieAdmin, {
        nombre: "Intento de escalada",
        email: correoNuevo,
        password: CONTRASENA,
        rol: "SUPER_ADMIN",
      });
      expect(status).toBe(403);
      expect(cuerpo.error.codigo).toBe("ROL_NO_PERMITIDO");

      const creado = await prismaRaw.usuario.findUnique({ where: { email: correoNuevo } });
      expect(creado).toBeNull();
    });

    it("PATCH /usuarios/:id/rol con rol SUPER_ADMIN: 403", async () => {
      const cookieAdmin = await iniciarSesion(adminEscaladaEmail);
      const objetivoEmail = `objetivo-escalada-${randomUUID()}@test.local`;
      emailsUsuarios.push(objetivoEmail);
      const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });
      const objetivo = await prismaRaw.usuario.create({
        data: { empresaId: empresaEscaladaId, email: objetivoEmail, passwordHash: hash, nombre: "Objetivo", rol: "VENDEDOR" },
      });

      const { status, cuerpo } = await peticion("PATCH", `/usuarios/${objetivo.id}/rol`, cookieAdmin, {
        rol: "SUPER_ADMIN",
      });
      expect(status).toBe(403);
      expect(cuerpo.error.codigo).toBe("ROL_NO_PERMITIDO");

      const sinCambios = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: objetivo.id } });
      expect(sinCambios.rol).toBe("VENDEDOR");
    });
  });
});
