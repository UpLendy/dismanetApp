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
    const llenar = await putUnidades([{ duracionId, tipoClienteId, precioVenta: "10000" }]);
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
    const rellenar = await putUnidades([{ duracionId, tipoClienteId, precioVenta: "11000" }]);
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

  it("el costo se pide una sola vez por duración (CostoPlataforma), no por celda de tipoCliente — punto 6", async () => {
    const guardar = await precios.handle(
      new Request("http://local/precios/unidades/costo", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: cookieAdmin },
        body: JSON.stringify({ plataformaId, duracionId, costo: "7000" }),
      }),
    );
    expect(guardar.status).toBe(200);
    expect(((await guardar.json()) as { costo: string }).costo).toBe("7000");

    const respuesta = await precios.handle(
      new Request(`http://local/precios/unidades?plataformaId=${plataformaId}`, { headers: { cookie: cookieAdmin } }),
    );
    const cuerpo = (await respuesta.json()) as {
      costos: { duracionId: string; costo: string }[];
    };
    expect(cuerpo.costos.find((c) => c.duracionId === duracionId)?.costo).toBe("7000");
    // otraDuracionId nunca tuvo costo registrado: sigue en cero.
    expect(cuerpo.costos.find((c) => c.duracionId === otraDuracionId)?.costo).toBe("0");

    await prismaRaw.costoPlataforma.deleteMany({ where: { empresaId, plataformaId, duracionId } });
  });

  it("avisoCostoCero cuenta combinaciones plataforma+duración EN USO (con precio activo) sin costo registrado", async () => {
    // duracionId ya tiene un precio activo (test "e" lo dejó lleno) pero sin
    // CostoPlataforma: cuenta en el aviso. otraDuracionId nunca tuvo precio
    // activo: no cuenta, aunque también le falte el costo.
    const respuesta = await precios.handle(
      new Request(`http://local/precios/unidades?plataformaId=${plataformaId}`, { headers: { cookie: cookieAdmin } }),
    );
    const cuerpo = (await respuesta.json()) as { avisoCostoCero: { cantidad: number } };
    expect(cuerpo.avisoCostoCero.cantidad).toBe(1);

    await prismaRaw.costoPlataforma.create({ data: { empresaId, plataformaId, duracionId, costo: "7000" } });
    const trasRegistrar = await precios.handle(
      new Request(`http://local/precios/unidades?plataformaId=${plataformaId}`, { headers: { cookie: cookieAdmin } }),
    );
    expect(((await trasRegistrar.json()) as { avisoCostoCero: { cantidad: number } }).avisoCostoCero.cantidad).toBe(0);

    await prismaRaw.costoPlataforma.deleteMany({ where: { empresaId, plataformaId, duracionId } });
  });
});

describe("Precios — matriz de Paquetes (costo calculado, no manual)", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let paqueteId: string;
  let netflixId: string;
  let disneyId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa precios-paquetes (precios.test)", prefijoCodigo: "PRQ" },
    });
    empresaId = empresa.id;

    const adminEmail = `admin-precios-paquetes-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });
    cookieAdmin = await iniciarSesion(adminEmail);

    const netflix = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (precios-paquetes.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    netflixId = netflix.id;

    const disney = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ (precios-paquetes.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    disneyId = disney.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (precios-paquetes.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Normal (precios-paquetes.test)" },
    });
    tipoClienteId = tipoCliente.id;

    const paquete = await prismaRaw.paquete.create({
      data: { empresaId, nombre: "Básico 1 (precios-paquetes.test)" },
    });
    paqueteId = paquete.id;

    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId, plataformaId: netflixId, cantidadPantallas: 1 },
    });
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId, plataformaId: disneyId, cantidadPantallas: 1 },
    });

    await prismaRaw.costoPlataforma.create({
      data: { empresaId, plataformaId: netflixId, duracionId, costo: "4000" },
    });
    // Disney+ no tiene CostoPlataforma registrado a propósito: deja el
    // paquete con costo incompleto.

    await prismaRaw.precio.create({
      data: { empresaId, paqueteId, duracionId, tipoClienteId, precioVenta: "20000", costo: "0" },
    });
  });

  afterAll(async () => {
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.costoPlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquetePlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquete.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  async function getPaquetes() {
    const respuesta = await precios.handle(
      new Request(`http://local/precios/paquetes?paqueteId=${paqueteId}`, { headers: { cookie: cookieAdmin } }),
    );
    return (await respuesta.json()) as {
      celdas: {
        duracionId: string;
        tipoClienteId: string;
        costoCalculado: string | null;
        detalle: { plataformaId: string; costoUnitario: string | null; subtotal: string | null }[];
      }[];
      avisoCostoCero: { cantidad: number };
    };
  }

  it("el campo de costo manual desapareció: PUT no lo acepta y GET nunca lo devuelve", async () => {
    const respuesta = await getPaquetes();
    const celda = respuesta.celdas.find((c) => c.duracionId === duracionId && c.tipoClienteId === tipoClienteId);
    expect(celda).toBeDefined();
    expect(celda).not.toHaveProperty("costo");
  });

  it("costoCalculado es null mientras falte el costo de un componente, con el desglose señalando cuál", async () => {
    const { celdas, avisoCostoCero } = await getPaquetes();
    const celda = celdas.find((c) => c.duracionId === duracionId && c.tipoClienteId === tipoClienteId);
    expect(celda?.costoCalculado).toBeNull();

    const netflix = celda?.detalle.find((d) => d.plataformaId === netflixId);
    expect(netflix?.costoUnitario).toBe("4000");
    const disney = celda?.detalle.find((d) => d.plataformaId === disneyId);
    expect(disney?.costoUnitario).toBeNull();

    // Un renglón de duración incompleto cuenta una sola vez en el aviso,
    // sin importar cuántos tipos de cliente tenga la matriz.
    expect(avisoCostoCero.cantidad).toBe(1);
  });

  it("al completar el costo del componente faltante, costoCalculado se calcula y el aviso baja a cero", async () => {
    await prismaRaw.costoPlataforma.create({
      data: { empresaId, plataformaId: disneyId, duracionId, costo: "2000" },
    });

    const { celdas, avisoCostoCero } = await getPaquetes();
    const celda = celdas.find((c) => c.duracionId === duracionId && c.tipoClienteId === tipoClienteId);
    // 4000 (Netflix) + 2000 (Disney+) = 6000.
    expect(celda?.costoCalculado).toBe("6000");
    expect(avisoCostoCero.cantidad).toBe(0);

    await prismaRaw.costoPlataforma.deleteMany({ where: { empresaId, plataformaId: disneyId, duracionId } });
  });
});
