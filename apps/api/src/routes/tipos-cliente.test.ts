import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita, igual que empresas.test.ts
// — arma la fixture (empresas/admins de partida) fuera de cualquier contexto
// de empresa autenticado.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { tiposCliente } from "./tipos-cliente.ts";

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
  const respuesta = await tiposCliente.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

describe("Tipos de cliente — catálogo (g)", () => {
  let empresaId: string;
  let adminEmail: string;
  let cookieAdmin: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa tipos-cliente (tipos-cliente.test)", prefijoCodigo: "TPC" },
    });
    empresaId = empresa.id;
    idsEmpresas.push(empresaId);

    adminEmail = `admin-tipos-cliente-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminEmail);
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });

    cookieAdmin = await iniciarSesion(adminEmail);
  });

  afterAll(async () => {
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("g) dos creaciones simultáneas del mismo tipo de cliente devuelven una creación y un error de negocio, no un 500", async () => {
    const nombre = `Mayorista ${randomUUID()}`;

    const [primera, segunda] = await Promise.all([
      peticion("POST", "/tipos-cliente", cookieAdmin, { nombre }),
      peticion("POST", "/tipos-cliente", cookieAdmin, { nombre }),
    ]);

    const estados = [primera.status, segunda.status].sort();
    expect(estados).toEqual([201, 409]);

    const fallida = primera.status === 409 ? primera : segunda;
    expect(fallida.cuerpo.error.codigo).toBe("NOMBRE_EN_USO");

    const lista = await peticion("GET", "/tipos-cliente", cookieAdmin);
    const coincidencias = lista.cuerpo.tiposCliente.filter((t: { nombre: string }) => t.nombre === nombre);
    expect(coincidencias.length).toBe(1);
  });
});
