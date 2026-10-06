import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: arma la fixture (empresa y usuarios de prueba)
// fuera de cualquier contexto de empresa autenticado — mismo patrón que
// auth.test.ts/usuarios.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { perfil } from "./perfil.ts";

const CONTRASENA = "Clave#Segura123";

async function login(email: string): Promise<string> {
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
  const respuesta = await perfil.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return {
    status: respuesta.status,
    cuerpo: texto ? JSON.parse(texto) : null,
    setCookie: respuesta.headers.get("set-cookie"),
  };
}

describe("Perfil propio (/perfil)", () => {
  const emailsCreados: string[] = [];
  let vendedorAId: string;
  let vendedorAEmail: string;
  let vendedorBEmail: string;
  let empresaId: string;

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa perfil (perfil.test)", prefijoCodigo: "PRF" },
    });
    empresaId = empresa.id;

    vendedorAEmail = `vendedor-a-${randomUUID()}@test.local`;
    emailsCreados.push(vendedorAEmail);
    const vendedorA = await prismaRaw.usuario.create({
      data: { empresaId, email: vendedorAEmail, passwordHash: hash, nombre: "Vendedor A", rol: "VENDEDOR" },
    });
    vendedorAId = vendedorA.id;

    vendedorBEmail = `vendedor-b-${randomUUID()}@test.local`;
    emailsCreados.push(vendedorBEmail);
    await prismaRaw.usuario.create({
      data: { empresaId, email: vendedorBEmail, passwordHash: hash, nombre: "Vendedor B", rol: "VENDEDOR" },
    });
  });

  afterAll(async () => {
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("GET /perfil devuelve la propia identidad, PUT /perfil actualiza nombre y correo", async () => {
    const cookie = await login(vendedorAEmail);

    const lectura = await peticion("GET", "/perfil", cookie);
    expect(lectura.status).toBe(200);
    expect(lectura.cuerpo.usuario.email).toBe(vendedorAEmail);
    expect(lectura.cuerpo.usuario.rol).toBe("VENDEDOR");

    const nuevoEmail = `vendedor-a-renombrado-${randomUUID()}@test.local`;
    emailsCreados.push(nuevoEmail);
    const actualizacion = await peticion("PUT", "/perfil", cookie, { nombre: "Vendedor A renombrado", email: nuevoEmail });
    expect(actualizacion.status).toBe(200);
    expect(actualizacion.cuerpo.usuario.nombre).toBe("Vendedor A renombrado");
    expect(actualizacion.cuerpo.usuario.email).toBe(nuevoEmail);

    // Revertir el correo para no romper otras pruebas que inician sesión con el original.
    await prismaRaw.usuario.update({ where: { id: vendedorAId }, data: { email: vendedorAEmail, nombre: "Vendedor A" } });
  });

  it("PUT /perfil no permite cambiarse el propio rol (el campo ni siquiera existe en el body)", async () => {
    const cookie = await login(vendedorAEmail);

    const actualizacion = await peticion("PUT", "/perfil", cookie, {
      nombre: "Vendedor A",
      email: vendedorAEmail,
      rol: "ADMIN",
    });
    expect(actualizacion.status).toBe(200);
    expect(actualizacion.cuerpo.usuario.rol).toBe("VENDEDOR");

    const enBase = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorAId } });
    expect(enBase.rol).toBe("VENDEDOR");
  });

  it("PUT /perfil con un correo ya en uso da error de negocio 409, no 500", async () => {
    const cookie = await login(vendedorAEmail);

    const choque = await peticion("PUT", "/perfil", cookie, { nombre: "Vendedor A", email: vendedorBEmail });
    expect(choque.status).toBe(409);
    expect(choque.cuerpo.error.codigo).toBe("CORREO_EN_USO");

    // El correo de A no debió cambiar.
    const enBase = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorAId } });
    expect(enBase.email).toBe(vendedorAEmail);
  });

  it("un VENDEDOR solo toca su propia fila: cambiar su perfil no afecta al de otro usuario", async () => {
    const cookieA = await login(vendedorAEmail);
    await peticion("PUT", "/perfil", cookieA, { nombre: "Vendedor A modificado", email: vendedorAEmail });

    const b = await prismaRaw.usuario.findUniqueOrThrow({ where: { email: vendedorBEmail } });
    expect(b.nombre).toBe("Vendedor B");

    await prismaRaw.usuario.update({ where: { id: vendedorAId }, data: { nombre: "Vendedor A" } });
  });

  it("PUT /perfil/contrasena con la contraseña actual correcta funciona", async () => {
    const cookie = await login(vendedorAEmail);
    const nuevaContrasena = "ClaveNueva#456";

    const cambio = await peticion("PUT", "/perfil/contrasena", cookie, {
      passwordActual: CONTRASENA,
      passwordNueva: nuevaContrasena,
    });
    expect(cambio.status).toBe(200);
    expect(cambio.cuerpo.ok).toBe(true);

    // Revertir para no romper las pruebas siguientes de este archivo, con la
    // cookie NUEVA que vino en la respuesta del cambio (la sesión actual
    // sigue viva con el password nuevo).
    const cookieNueva = cambio.setCookie!.split(";")[0];
    const revertir = await peticion("PUT", "/perfil/contrasena", cookieNueva, {
      passwordActual: nuevaContrasena,
      passwordNueva: CONTRASENA,
    });
    expect(revertir.status).toBe(200);
  });

  it("PUT /perfil/contrasena con la contraseña actual incorrecta devuelve error, sin cambiar nada", async () => {
    const cookie = await login(vendedorAEmail);

    const cambio = await peticion("PUT", "/perfil/contrasena", cookie, {
      passwordActual: "esta-no-es-la-actual",
      passwordNueva: "OtraClave#789",
    });
    expect(cambio.status).toBe(401);
    expect(cambio.cuerpo.error.codigo).toBe("CONTRASENA_ACTUAL_INCORRECTA");

    // La contraseña original sigue funcionando.
    const siguenFuncionando = await login(vendedorAEmail);
    expect(siguenFuncionando).toBeTruthy();
  });

  it("al cambiar la contraseña se invalidan las demás sesiones, pero la actual sigue viva", async () => {
    const cookieSesion1 = await login(vendedorAEmail);
    const cookieSesion2 = await login(vendedorAEmail);
    const nuevaContrasena = "ClaveRotada#321";

    // Sesión 2 cambia la contraseña.
    const cambio = await peticion("PUT", "/perfil/contrasena", cookieSesion2, {
      passwordActual: CONTRASENA,
      passwordNueva: nuevaContrasena,
    });
    expect(cambio.status).toBe(200);
    const cookieSesion2Renovada = cambio.setCookie!.split(";")[0];

    // Sesión 1 (que nunca se renovó) queda invalidada.
    const conSesion1 = await peticion("GET", "/perfil", cookieSesion1);
    expect(conSesion1.status).toBe(401);

    // Sesión 2, con la cookie renovada que trajo la respuesta, sigue viva.
    const conSesion2 = await peticion("GET", "/perfil", cookieSesion2Renovada);
    expect(conSesion2.status).toBe(200);

    // Revertir para no afectar otras pruebas.
    await peticion("PUT", "/perfil/contrasena", cookieSesion2Renovada, {
      passwordActual: nuevaContrasena,
      passwordNueva: CONTRASENA,
    });
  });
});
