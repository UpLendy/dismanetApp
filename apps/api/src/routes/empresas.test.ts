import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita, igual que auth.test.ts —
// arma la fixture (empresa/admin de partida) y verifica al final que no
// quedó ninguna empresa huérfana, algo que un cliente restringido a una sola
// empresa por R1 no puede consultar.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { empresas } from "./empresas.ts";
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
  const respuesta = await empresas.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

describe("b) Aislamiento tras crear una empresa (decisión D2)", () => {
  let empresaAId: string;
  let adminAEmail: string;
  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresaA = await prismaRaw.empresa.create({
      data: { nombre: "Empresa creadora A (empresas.test)", prefijoCodigo: "CRA" },
    });
    empresaAId = empresaA.id;
    idsEmpresas.push(empresaAId);

    adminAEmail = `admin-creador-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminAEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: adminAEmail, passwordHash: hash, nombre: "Admin creador", rol: "ADMIN" },
    });
  });

  afterAll(async () => {
    await prismaRaw.usuario.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("un ADMIN de la empresa A crea la empresa B y NO conserva acceso a ella", async () => {
    const cookieAdminA = await iniciarSesion(adminAEmail);

    const nuevoAdminEmail = `admin-empresa-b-${randomUUID()}@test.local`;
    const { status, cuerpo } = await peticion("POST", "/empresas", cookieAdminA, {
      nombre: "Empresa creada B (empresas.test)",
      prefijoCodigo: "CRB",
      adminNombre: "Admin de B",
      adminEmail: nuevoAdminEmail,
      adminPassword: CONTRASENA,
    });

    expect(status).toBe(201);
    const empresaBId: string = cuerpo.empresa.id;
    idsEmpresas.push(empresaBId);
    emailsUsuarios.push(nuevoAdminEmail);

    // La prueba real de D2: el ADMIN de A, TODAVÍA autenticado con la misma
    // sesión que acaba de crear B, consulta GET /usuarios (protegido por R1
    // vía prismaParaEmpresa(contexto.empresaId)). Su empresaId sigue siendo
    // A, así que la lista debe contener SOLO usuarios de A — cero rastro
    // del admin recién creado en B.
    const respuestaUsuarios = await usuarios.handle(
      new Request("http://local/usuarios", { headers: { cookie: cookieAdminA } }),
    );
    const cuerpoUsuarios = (await respuestaUsuarios.json()) as { usuarios: Array<{ email: string }> };
    const correosVisibles = cuerpoUsuarios.usuarios.map((u) => u.email);
    expect(correosVisibles).toContain(adminAEmail);
    expect(correosVisibles).not.toContain(nuevoAdminEmail);

    // Confirmación (con el cliente sin restringir, como oráculo de prueba)
    // de que B sí quedó creada con exactamente su propio admin.
    const usuariosDeB = await prismaRaw.usuario.findMany({ where: { empresaId: empresaBId } });
    expect(usuariosDeB).toHaveLength(1);
    expect(usuariosDeB[0]?.email).toBe(nuevoAdminEmail);

    // El contexto de sesión del creador sigue apuntando a la empresa A: su
    // JWT lleva empresaId = A (fijado al hacer login), sin importar qué
    // empresa acabe de crear.
    const yo = await auth.handle(
      new Request("http://local/auth/yo", { headers: { cookie: cookieAdminA } }),
    );
    const cuerpoYo = (await yo.json()) as { empresaActiva: { id: string } | null };
    expect(cuerpoYo.empresaActiva?.id).toBe(empresaAId);
    expect(cuerpoYo.empresaActiva?.id).not.toBe(empresaBId);

    // creadaPorUsuarioId queda registrado solo para trazabilidad — no
    // otorga acceso (D2).
    const empresaBEnBd = await prismaRaw.empresa.findUniqueOrThrow({ where: { id: empresaBId } });
    const adminA = await prismaRaw.usuario.findUniqueOrThrow({ where: { email: adminAEmail } });
    expect(empresaBEnBd.creadaPorUsuarioId).toBe(adminA.id);
  });
});

describe("e) La creación de empresa es atómica", () => {
  let correoAdminExistente: string;
  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });
    const empresaExistente = await prismaRaw.empresa.create({
      data: { nombre: "Empresa con correo ya usado (empresas.test)", prefijoCodigo: "TXR" },
    });
    idsEmpresas.push(empresaExistente.id);

    correoAdminExistente = `correo-duplicado-${randomUUID()}@test.local`;
    emailsUsuarios.push(correoAdminExistente);
    await prismaRaw.usuario.create({
      data: {
        empresaId: empresaExistente.id,
        email: correoAdminExistente,
        passwordHash: hash,
        nombre: "Admin ya existente",
        rol: "ADMIN",
      },
    });
  });

  afterAll(async () => {
    await prismaRaw.usuario.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("si falla la creación del primer ADMIN (correo duplicado), no queda ninguna empresa huérfana", async () => {
    const prefijoIntento = "TXB";

    const cookieAdmin = await iniciarSesion(correoAdminExistente);
    const { status, cuerpo } = await peticion("POST", "/empresas", cookieAdmin, {
      nombre: "Empresa que debe revertirse (empresas.test)",
      prefijoCodigo: prefijoIntento,
      adminNombre: "Admin con correo repetido",
      adminEmail: correoAdminExistente, // ya existe: dispara P2002 dentro de la transacción
      adminPassword: CONTRASENA,
    });

    expect(status).toBe(409);
    expect(cuerpo.error.codigo).toBe("CORREO_EN_USO");

    const empresaHuerfana = await prismaRaw.empresa.findUnique({ where: { prefijoCodigo: prefijoIntento } });
    expect(empresaHuerfana).toBeNull();
  });
});
