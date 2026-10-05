import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita — arma la fixture (empresa,
// admin, plataforma, duración, tipo de cliente) fuera de cualquier contexto
// de empresa autenticado, igual que en catalogo-permisos.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { precios } from "./precios.ts";

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

describe("Precios — matriz de Unidades (e, g)", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let plataformaId: string;
  let duracionId: string;
  let otraDuracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa precios (precios.test)", prefijoCodigo: "PRC" },
    });
    empresaId = empresa.id;

    const adminEmail = `admin-precios-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });
    cookieAdmin = await iniciarSesion(adminEmail);

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (precios.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (precios.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const otraDuracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "14 días (precios.test)", cantidad: 14, unidad: "DIAS" },
    });
    otraDuracionId = otraDuracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Normal (precios.test)" },
    });
    tipoClienteId = tipoCliente.id;
  });

  afterAll(async () => {
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  async function getUnidades() {
    const respuesta = await precios.handle(
      new Request(`http://local/precios/unidades?plataformaId=${plataformaId}`, {
        headers: { cookie: cookieAdmin },
      }),
    );
    return (await respuesta.json()) as {
      celdas: { duracionId: string; tipoClienteId: string }[];
    };
  }

  async function putUnidades(celdas: unknown[]) {
    return precios.handle(
      new Request("http://local/precios/unidades", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: cookieAdmin },
        body: JSON.stringify({ plataformaId, celdas }),
      }),
    );
  }

  it("(g) una combinación sin precio activo no aparece en las celdas devueltas", async () => {
    const { celdas } = await getUnidades();
    expect(celdas.find((c) => c.duracionId === duracionId && c.tipoClienteId === tipoClienteId)).toBeUndefined();
  });

  it("(e) llenar una celda la agrega; limpiarla la quita sin borrar la fila; rellenarla la reactiva sin violar la restricción única", async () => {
    // Llenar.
    const llenar = await putUnidades([{ duracionId, tipoClienteId, precioVenta: "10000", costo: "5000" }]);
    expect(llenar.status).toBe(200);

    let { celdas } = await getUnidades();
    expect(celdas.find((c) => c.duracionId === duracionId && c.tipoClienteId === tipoClienteId)).toBeDefined();

    const filaOriginal = await prismaRaw.precio.findFirst({ where: { empresaId, plataformaId, duracionId, tipoClienteId } });
    expect(filaOriginal).not.toBeNull();
    expect(filaOriginal?.activo).toBe(true);

    // Limpiar: desaparece de las celdas activas, pero la fila sigue existiendo.
    const limpiar = await putUnidades([{ duracionId, tipoClienteId, limpiar: true }]);
    expect(limpiar.status).toBe(200);

    ({ celdas } = await getUnidades());
    expect(celdas.find((c) => c.duracionId === duracionId && c.tipoClienteId === tipoClienteId)).toBeUndefined();

    const filaTrasLimpiar = await prismaRaw.precio.findFirst({ where: { empresaId, plataformaId, duracionId, tipoClienteId } });
    expect(filaTrasLimpiar).not.toBeNull();
    expect(filaTrasLimpiar?.id).toBe(filaOriginal!.id);
    expect(filaTrasLimpiar?.activo).toBe(false);

    // Rellenar: reactiva la MISMA fila (misma id), no crea una segunda —
    // si violara la restricción única, este PUT fallaría con 500 en vez de 200.
    const rellenar = await putUnidades([{ duracionId, tipoClienteId, precioVenta: "11000", costo: "6000" }]);
    expect(rellenar.status).toBe(200);

    ({ celdas } = await getUnidades());
    expect(celdas.find((c) => c.duracionId === duracionId && c.tipoClienteId === tipoClienteId)).toBeDefined();

    const filasFinales = await prismaRaw.precio.findMany({ where: { empresaId, plataformaId, duracionId, tipoClienteId } });
    expect(filasFinales).toHaveLength(1);
    expect(filasFinales[0]?.id).toBe(filaOriginal!.id);
    expect(filasFinales[0]?.activo).toBe(true);
  });

  it("(g) una segunda combinación nunca llenada tampoco aparece, aunque la plataforma ya tenga otras celdas activas", async () => {
    const { celdas } = await getUnidades();
    expect(celdas.find((c) => c.duracionId === otraDuracionId && c.tipoClienteId === tipoClienteId)).toBeUndefined();
  });
});
