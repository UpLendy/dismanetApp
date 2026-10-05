import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita — arma la fixture (empresa,
// usuarios, plataformas, venta de prueba) fuera de cualquier contexto de
// empresa autenticado, igual que en catalogo-permisos.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { auth } from "./auth.ts";
import { cuentas } from "./cuentas.ts";
import { disponibilidad } from "./disponibilidad.ts";

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

describe("Cuentas, pantallas, perfiles y pines", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let cookieVendedor: string;
  let plataformaConPerfilId: string;
  let plataformaSinPerfilId: string;

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa cuentas (cuentas.test)", prefijoCodigo: "CTA" },
    });
    empresaId = empresa.id;

    const adminEmail = `admin-cuentas-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });
    cookieAdmin = await iniciarSesion(adminEmail);

    const vendedorEmail = `vendedor-cuentas-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: vendedorEmail, passwordHash: hash, nombre: "Vendedor", rol: "VENDEDOR" },
    });
    cookieVendedor = await iniciarSesion(vendedorEmail);

    const plataformaConPerfil = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (cuentas.test)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaConPerfilId = plataformaConPerfil.id;

    const plataformaSinPerfil = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "YouTube Premium (cuentas.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaSinPerfilId = plataformaSinPerfil.id;
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  async function post(ruta: string, body: unknown, cookie: string = cookieAdmin) {
    return cuentas.handle(
      new Request(`http://local${ruta}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  async function patch(ruta: string, body: unknown, cookie: string = cookieAdmin) {
    return cuentas.handle(
      new Request(`http://local${ruta}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  async function get(ruta: string, cookie: string = cookieAdmin) {
    return cuentas.handle(new Request(`http://local${ruta}`, { headers: { cookie } }));
  }

  it("(a) crear una cuenta en una plataforma con usaPerfilPin genera N pantallas con perfiles A, B, C... y PINes de 4 dígitos distintos", async () => {
    const respuesta = await post("/cuentas", {
      plataformaId: plataformaConPerfilId,
      correo: `cuenta-perfil-${randomUUID()}@cuentas.test`,
      password: "Secreto#1",
      capacidadPantallas: 4,
    });
    expect(respuesta.status).toBe(201);
    const { cuenta } = (await respuesta.json()) as { cuenta: { id: string } };

    const credenciales = await get(`/cuentas/${cuenta.id}/credenciales`);
    const { pantallas } = (await credenciales.json()) as {
      pantallas: { numero: number; pin: string | null }[];
    };

    const detalle = await get(`/cuentas/${cuenta.id}`);
    const { pantallas: pantallasDetalle } = (await detalle.json()) as {
      pantallas: { numero: number; perfil: string | null }[];
    };

    expect(pantallasDetalle.map((p) => p.perfil).sort()).toEqual(["A", "B", "C", "D"]);
    expect(pantallas).toHaveLength(4);
    for (const p of pantallas) {
      expect(p.pin).toMatch(/^[0-9]{4}$/);
    }
    expect(new Set(pantallas.map((p) => p.pin)).size).toBe(4);
  });

  it("(b) crear una cuenta en una plataforma sin perfiles deja perfil y pin en null", async () => {
    const respuesta = await post("/cuentas", {
      plataformaId: plataformaSinPerfilId,
      correo: `cuenta-sin-perfil-${randomUUID()}@cuentas.test`,
      password: "Secreto#2",
      capacidadPantallas: 2,
    });
    expect(respuesta.status).toBe(201);
    const { cuenta } = (await respuesta.json()) as { cuenta: { id: string } };

    const detalle = await get(`/cuentas/${cuenta.id}`);
    const { pantallas } = (await detalle.json()) as { pantallas: { perfil: string | null }[] };
    expect(pantallas.every((p) => p.perfil === null)).toBe(true);

    const credenciales = await get(`/cuentas/${cuenta.id}/credenciales`);
    const { pantallas: pantallasCredenciales } = (await credenciales.json()) as {
      pantallas: { pin: string | null }[];
    };
    expect(pantallasCredenciales.every((p) => p.pin === null)).toBe(true);
  });

  it("(c) password y pin quedan cifrados en la BD y se recuperan correctamente", async () => {
    const correo = `cuenta-cifrado-${randomUUID()}@cuentas.test`;
    const respuesta = await post("/cuentas", {
      plataformaId: plataformaConPerfilId,
      correo,
      password: "Secreto#Cifrado3",
      capacidadPantallas: 1,
    });
    const { cuenta } = (await respuesta.json()) as { cuenta: { id: string } };

    const filaCruda = await prismaRaw.cuenta.findUnique({ where: { id: cuenta.id } });
    expect(filaCruda?.password).not.toBe("Secreto#Cifrado3");

    const pantallaCruda = await prismaRaw.pantalla.findFirst({ where: { cuentaId: cuenta.id } });
    expect(pantallaCruda?.pin).not.toBeNull();
    expect(pantallaCruda?.pin).not.toMatch(/^[0-9]{4}$/);

    const credenciales = await get(`/cuentas/${cuenta.id}/credenciales`);
    const { password, pantallas } = (await credenciales.json()) as {
      password: string;
      pantallas: { pin: string | null }[];
    };
    expect(password).toBe("Secreto#Cifrado3");
    expect(pantallas[0]?.pin).toMatch(/^[0-9]{4}$/);
  });

  it("(d) subir la capacidad genera solo las pantallas faltantes, sin tocar las existentes ni reiniciar la numeración", async () => {
    const respuesta = await post("/cuentas", {
      plataformaId: plataformaConPerfilId,
      correo: `cuenta-subir-${randomUUID()}@cuentas.test`,
      password: "Secreto#4",
      capacidadPantallas: 2,
    });
    const { cuenta } = (await respuesta.json()) as { cuenta: { id: string } };

    const antes = await get(`/cuentas/${cuenta.id}`);
    const { pantallas: pantallasAntes } = (await antes.json()) as { pantallas: { id: string; numero: number }[] };
    const idsOriginales = new Map(pantallasAntes.map((p) => [p.numero, p.id]));

    const subir = await patch(`/cuentas/${cuenta.id}`, { capacidadPantallas: 4 });
    expect(subir.status).toBe(200);

    const despues = await get(`/cuentas/${cuenta.id}`);
    const { pantallas: pantallasDespues } = (await despues.json()) as {
      pantallas: { id: string; numero: number; activa: boolean }[];
    };

    expect(pantallasDespues.map((p) => p.numero).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(pantallasDespues.every((p) => p.activa)).toBe(true);
    // Las dos originales no se tocan: mismo id que antes.
    for (const p of pantallasDespues.filter((p) => p.numero <= 2)) {
      expect(idsOriginales.has(p.numero)).toBe(true);
      expect(p.id).toBe(idsOriginales.get(p.numero) as string);
    }
  });

  it("(e) bajar la capacidad con una pantalla ocupada se rechaza; con todas libres funciona", async () => {
    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (cuentas.test)", cantidad: 30, unidad: "DIAS" },
    });
    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Normal (cuentas.test)" },
    });
    const vendedor = await prismaRaw.usuario.findFirstOrThrow({ where: { empresaId, rol: "VENDEDOR" } });

    const respuesta = await post("/cuentas", {
      plataformaId: plataformaConPerfilId,
      correo: `cuenta-bajar-${randomUUID()}@cuentas.test`,
      password: "Secreto#5",
      capacidadPantallas: 3,
    });
    const { cuenta } = (await respuesta.json()) as { cuenta: { id: string } };

    const detalle = await get(`/cuentas/${cuenta.id}`);
    const { pantallas } = (await detalle.json()) as { pantallas: { id: string; numero: number }[] };
    const pantalla3 = pantallas.find((p) => p.numero === 3)!;

    const venta = await prismaRaw.venta.create({
      data: {
        empresaId,
        vendedorId: vendedor.id,
        codigoCompra: `CTA-${randomUUID()}`,
        tipoVenta: "UNIDAD",
        plataformaId: plataformaConPerfilId,
        duracionId: duracion.id,
        tipoClienteId: tipoCliente.id,
        nombreItem: "Netflix",
        nombreDuracion: duracion.nombre,
        cantidadDuracion: duracion.cantidad,
        unidadDuracion: duracion.unidad,
        nombreTipoCliente: tipoCliente.nombre,
        precioVenta: "10000",
        costo: "5000",
        utilidad: "5000",
        fechaVencimientoMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        mensajeGenerado: "mensaje de prueba",
      },
    });
    await prismaRaw.ventaDetalle.create({
      data: {
        empresaId,
        ventaId: venta.id,
        pantallaId: pantalla3.id,
        cuentaId: cuenta.id,
        plataformaId: plataformaConPerfilId,
        nombrePlataforma: "Netflix",
        correoCuenta: "correo@cuenta.test",
        passwordCuenta: "cifrado",
        duracionId: duracion.id,
        cantidadDuracion: duracion.cantidad,
        unidadDuracion: duracion.unidad,
        fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const bajarConOcupada = await patch(`/cuentas/${cuenta.id}`, { capacidadPantallas: 1 });
    expect(bajarConOcupada.status).toBe(400);
    const cuerpoError = (await bajarConOcupada.json()) as { error: { codigo: string; mensaje: string } };
    expect(cuerpoError.error.codigo).toBe("PANTALLAS_OCUPADAS");
    expect(cuerpoError.error.mensaje).toContain("#3");

    // Libera la pantalla ocupada y reintenta: ahora todas están libres.
    await prismaRaw.venta.update({ where: { id: venta.id }, data: { anulada: true } });

    const bajarConTodasLibres = await patch(`/cuentas/${cuenta.id}`, { capacidadPantallas: 1 });
    expect(bajarConTodasLibres.status).toBe(200);

    const detalleFinal = await get(`/cuentas/${cuenta.id}`);
    const { pantallas: pantallasFinal } = (await detalleFinal.json()) as {
      pantallas: { numero: number; activa: boolean }[];
    };
    expect(pantallasFinal.find((p) => p.numero === 1)?.activa).toBe(true);
    expect(pantallasFinal.find((p) => p.numero === 2)?.activa).toBe(false);
    expect(pantallasFinal.find((p) => p.numero === 3)?.activa).toBe(false);
  });

  it("(f) un VENDEDOR obtiene 403 en todos los endpoints de cuentas, y disponibilidad no expone ningún campo de credenciales", async () => {
    const respuestaListado = await get("/cuentas", cookieVendedor);
    expect(respuestaListado.status).toBe(403);

    const respuestaCrear = await post(
      "/cuentas",
      { plataformaId: plataformaConPerfilId, correo: "x@x.com", password: "x", capacidadPantallas: 1 },
      cookieVendedor,
    );
    expect(respuestaCrear.status).toBe(403);

    const respuestaDisponibilidad = await disponibilidad.handle(
      new Request("http://local/disponibilidad", { headers: { cookie: cookieVendedor } }),
    );
    expect(respuestaDisponibilidad.status).toBe(200);
    const cuerpo = (await respuestaDisponibilidad.json()) as { disponibilidad: Record<string, unknown>[] };
    for (const fila of cuerpo.disponibilidad) {
      expect(Object.keys(fila).sort()).toEqual(["libres", "nombre", "plataformaId", "total"]);
    }
  });

  it("(g) ningún listado de cuentas incluye password ni pin en la respuesta", async () => {
    const respuesta = await get("/cuentas");
    const texto = await respuesta.text();
    expect(texto).not.toContain("password");
    expect(texto).not.toContain("pin");

    const detalle = await get(`/cuentas?plataformaId=${plataformaConPerfilId}`);
    const textoDetalle = await detalle.text();
    expect(textoDetalle).not.toContain("password");
    expect(textoDetalle).not.toContain('"pin"');
  });
});
