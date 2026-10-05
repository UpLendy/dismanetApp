import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import argon2 from "argon2";
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";

const CONTRASENA_VALIDA = "Clave#Segura123";

async function login(email: string, password: string) {
  const respuesta = await auth.handle(
    new Request("http://local/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  const cuerpo = (await respuesta.json()) as { error?: { codigo: string; mensaje: string } };
  return { status: respuesta.status, cuerpo };
}

describe("POST /auth/login", () => {
  let empresaActivaId: string;
  let empresaInactivaId: string;
  let emailUsuarioActivo: string;
  let emailUsuarioInactivo: string;
  let emailUsuarioEnEmpresaInactiva: string;

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA_VALIDA, { type: argon2.argon2id });

    const empresaActiva = await prismaRaw.empresa.create({
      data: { nombre: "Empresa activa (auth.test)", prefijoCodigo: "EAT", activa: true },
    });
    empresaActivaId = empresaActiva.id;

    const empresaInactiva = await prismaRaw.empresa.create({
      data: { nombre: "Empresa inactiva (auth.test)", prefijoCodigo: "EIT", activa: false },
    });
    empresaInactivaId = empresaInactiva.id;

    emailUsuarioActivo = `activo-${Date.now()}@test.local`;
    await prismaRaw.usuario.create({
      data: {
        empresaId: empresaActivaId,
        email: emailUsuarioActivo,
        passwordHash: hash,
        nombre: "Usuario activo",
        rol: "VENDEDOR",
        activo: true,
      },
    });

    emailUsuarioInactivo = `inactivo-${Date.now()}@test.local`;
    await prismaRaw.usuario.create({
      data: {
        empresaId: empresaActivaId,
        email: emailUsuarioInactivo,
        passwordHash: hash,
        nombre: "Usuario inactivo",
        rol: "VENDEDOR",
        activo: false,
      },
    });

    emailUsuarioEnEmpresaInactiva = `en-empresa-inactiva-${Date.now()}@test.local`;
    await prismaRaw.usuario.create({
      data: {
        empresaId: empresaInactivaId,
        email: emailUsuarioEnEmpresaInactiva,
        passwordHash: hash,
        nombre: "Usuario en empresa inactiva",
        rol: "VENDEDOR",
        activo: true,
      },
    });
  });

  afterAll(async () => {
    await prismaRaw.usuario.deleteMany({ where: { empresaId: { in: [empresaActivaId, empresaInactivaId] } } });
    await prismaRaw.empresa.delete({ where: { id: empresaActivaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaInactivaId } });
  });

  it("usuario activo, empresa activa, contraseña correcta: 200", async () => {
    const { status, cuerpo } = await login(emailUsuarioActivo, CONTRASENA_VALIDA);
    expect(status).toBe(200);
    expect(cuerpo.error).toBeUndefined();
  });

  it("usuario inactivo: rechazado (no 200), aunque la contraseña sea correcta", async () => {
    const { status, cuerpo } = await login(emailUsuarioInactivo, CONTRASENA_VALIDA);
    expect(status).not.toBe(200);
    expect(cuerpo.error?.codigo).toBe("USUARIO_INACTIVO");
  });

  it("empresa inactiva: rechazado, aunque el usuario esté activo y la contraseña sea correcta", async () => {
    const { status, cuerpo } = await login(emailUsuarioEnEmpresaInactiva, CONTRASENA_VALIDA);
    expect(status).not.toBe(200);
    expect(cuerpo.error?.codigo).toBe("EMPRESA_INACTIVA");
  });

  it("contraseña incorrecta: rechazado con mensaje genérico", async () => {
    const { status, cuerpo } = await login(emailUsuarioActivo, "contraseña-equivocada");
    expect(status).toBe(401);
    expect(cuerpo.error?.codigo).toBe("CREDENCIALES_INVALIDAS");
  });

  it("correo que no existe: mismo status y mismo mensaje genérico que una contraseña incorrecta (no revela si el correo está registrado)", async () => {
    const conCorreoInexistente = await login("no-existe-en-el-sistema@test.local", CONTRASENA_VALIDA);
    const conContrasenaIncorrecta = await login(emailUsuarioActivo, "contraseña-equivocada");

    expect(conCorreoInexistente.status).toBe(conContrasenaIncorrecta.status);
    expect(conCorreoInexistente.cuerpo.error?.codigo).toBe(conContrasenaIncorrecta.cuerpo.error?.codigo);
    expect(conCorreoInexistente.cuerpo.error?.mensaje).toBe(conContrasenaIncorrecta.cuerpo.error?.mensaje);
  });
});
