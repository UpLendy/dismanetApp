import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: arma la fixture (empresas, usuarios) fuera de
// cualquier contexto de empresa autenticado, igual que cargos.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { festivos } from "./festivos.ts";
import { festivosColombia } from "../lib/festivos.ts";

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

// En algunos años dos festivos Emiliani caen en la misma fecha (p. ej. San
// Pedro y San Pablo / Sagrado Corazón en 2025, ambos el lunes 30 de junio —
// ver festivos.test.ts). /festivos/generar cuenta `total` sin deduplicar
// (calculados.length), pero solo puede CREAR una fila por fecha — la
// segunda colisiona contra el índice único y se descarta. Por eso el
// `creados` esperado de una generación limpia es la cuenta de fechas
// ÚNICAS, no `festivosColombia(anio).length`.
function contarFechasUnicas(anio: number): number {
  return new Set(festivosColombia(anio).map((f) => f.fecha.getTime())).size;
}

async function peticionFestivos(metodo: string, ruta: string, cookie: string, cuerpo?: unknown) {
  const respuesta = await festivos.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

describe("Festivos — generación colombiana y administración manual (F6.2)", () => {
  let empresaAId: string;
  let cookieAdminA: string;
  let empresaBId: string;
  let cookieAdminB: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresaA = await prismaRaw.empresa.create({
      data: { nombre: "Empresa festivos A (festivos.test)", prefijoCodigo: "FEA" },
    });
    empresaAId = empresaA.id;
    idsEmpresas.push(empresaAId);
    const adminAEmail = `admin-festivos-a-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminAEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: adminAEmail, passwordHash: hash, nombre: "Admin A", rol: "ADMIN" },
    });
    cookieAdminA = await iniciarSesion(adminAEmail);

    const empresaB = await prismaRaw.empresa.create({
      data: { nombre: "Empresa festivos B (festivos.test)", prefijoCodigo: "FEB" },
    });
    empresaBId = empresaB.id;
    idsEmpresas.push(empresaBId);
    const adminBEmail = `admin-festivos-b-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminBEmail);
    await prismaRaw.usuario.create({
      data: { empresaId: empresaBId, email: adminBEmail, passwordHash: hash, nombre: "Admin B", rol: "ADMIN" },
    });
    cookieAdminB = await iniciarSesion(adminBEmail);
  });

  afterAll(async () => {
    await prismaRaw.festivo.deleteMany({ where: { empresaId: { in: idsEmpresas } } });
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("POST /festivos/generar es idempotente: la segunda llamada para el mismo año no duplica nada", async () => {
    const totalBruto = festivosColombia(2027).length;
    const totalUnico = contarFechasUnicas(2027);

    const primera = await peticionFestivos("POST", "/festivos/generar", cookieAdminA, { anio: 2027 });
    expect(primera.status).toBe(200);
    expect(primera.cuerpo.creados).toBe(totalUnico);
    expect(primera.cuerpo.total).toBe(totalBruto);

    const segunda = await peticionFestivos("POST", "/festivos/generar", cookieAdminA, { anio: 2027 });
    expect(segunda.status).toBe(200);
    expect(segunda.cuerpo.creados).toBe(0);
    expect(segunda.cuerpo.total).toBe(totalBruto);

    const listado = await peticionFestivos("GET", "/festivos?anio=2027", cookieAdminA);
    expect(listado.cuerpo.festivos.length).toBe(totalUnico);
  });

  it("POST /festivos/generar nunca pisa un festivo que el ADMIN creó o editó a mano (generado: false)", async () => {
    // Año Nuevo de 2028 ya existe, pero con un nombre editado a mano — no es
    // un festivo "generado" (generado: false).
    const manual = await peticionFestivos("POST", "/festivos", cookieAdminA, {
      fecha: "2028-01-01",
      nombre: "Año Nuevo (editado a mano)",
    });
    expect(manual.status).toBe(201);
    expect(manual.cuerpo.festivo.generado).toBe(false);

    const generar = await peticionFestivos("POST", "/festivos/generar", cookieAdminA, { anio: 2028 });
    expect(generar.status).toBe(200);
    // Año Nuevo ya existía (como fecha, sin importar el flag) — no se
    // vuelve a crear, así que falta exactamente una fecha única de las
    // calculadas.
    expect(generar.cuerpo.creados).toBe(contarFechasUnicas(2028) - 1);

    const listado = await peticionFestivos("GET", "/festivos?anio=2028", cookieAdminA);
    const anioNuevo = listado.cuerpo.festivos.find((f: { fecha: string }) => f.fecha.startsWith("2028-01-01"));
    expect(anioNuevo.nombre).toBe("Año Nuevo (editado a mano)");
    expect(anioNuevo.generado).toBe(false);
  });

  it("POST /festivos con una fecha ya usada responde 409 FESTIVO_EN_USO", async () => {
    const primero = await peticionFestivos("POST", "/festivos", cookieAdminA, { fecha: "2029-06-15", nombre: "Festivo local" });
    expect(primero.status).toBe(201);
    const repetido = await peticionFestivos("POST", "/festivos", cookieAdminA, { fecha: "2029-06-15", nombre: "Otro nombre" });
    expect(repetido.status).toBe(409);
    expect(repetido.cuerpo.error.codigo).toBe("FESTIVO_EN_USO");
  });

  it("DELETE /festivos/:id de un festivo inexistente responde 404 FESTIVO_NO_ENCONTRADO", async () => {
    const respuesta = await peticionFestivos("DELETE", "/festivos/no-existe", cookieAdminA);
    expect(respuesta.status).toBe(404);
    expect(respuesta.cuerpo.error.codigo).toBe("FESTIVO_NO_ENCONTRADO");
  });

  it("R1: generar o crear festivos en la empresa A nunca aparece en el listado de la empresa B", async () => {
    await peticionFestivos("POST", "/festivos/generar", cookieAdminA, { anio: 2030 });
    await peticionFestivos("POST", "/festivos", cookieAdminA, { fecha: "2030-03-03", nombre: "Festivo solo de A" });

    const listadoB = await peticionFestivos("GET", "/festivos?anio=2030", cookieAdminB);
    expect(listadoB.cuerpo.festivos.length).toBe(0);

    // Generar el mismo año en B produce el conjunto completo igual, sin que
    // lo de A interfiera ni cuente como ya existente.
    const generarEnB = await peticionFestivos("POST", "/festivos/generar", cookieAdminB, { anio: 2030 });
    expect(generarEnB.cuerpo.creados).toBe(contarFechasUnicas(2030));
  });
});
