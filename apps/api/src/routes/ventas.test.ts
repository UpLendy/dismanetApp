import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita — arma la fixture fuera de
// cualquier contexto de empresa autenticado, igual que cuentas.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { cifrar } from "../lib/cifrado.ts";
import { auth } from "./auth.ts";
import { ventas } from "./ventas.ts";

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

describe("Rutas de ventas (venta rápida)", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let cookieVendedor: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa ventas-ruta (ventas.test)", prefijoCodigo: "VTR" },
    });
    empresaId = empresa.id;

    const adminEmail = `admin-ventas-ruta-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });
    cookieAdmin = await iniciarSesion(adminEmail);

    const vendedorEmail = `empleado-ventas-ruta-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: vendedorEmail, passwordHash: hash, nombre: "Empleado", rol: "EMPLEADO" },
    });
    cookieVendedor = await iniciarSesion(vendedorEmail);

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (ventas-ruta.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "netflix@ventas-ruta.test", password: cifrar("clave"), capacidadPantallas: 2 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 1 } });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 2 } });

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (ventas-ruta.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (ventas-ruta.test)" } });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "15000", costo: "8000" },
    });

    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "UNIDAD", contenido: "Código {{codigoCompra}} - {{correo}} - {{clave}}" },
    });
    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "PAQUETE", contenido: "Código {{codigoCompra}} - {{paquete}}\n{{listaCuentas}}" },
    });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  async function get(ruta: string, cookie: string) {
    return ventas.handle(new Request(`http://local${ruta}`, { headers: { cookie } }));
  }

  async function post(body: unknown, cookie: string) {
    return ventas.handle(
      new Request("http://local/ventas", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  it("un EMPLEADO ve la plataforma en el selector /ventas/plataformas con precio pero sin costo", async () => {
    const respuesta = await get(`/ventas/plataformas?duracionId=${duracionId}&tipoClienteId=${tipoClienteId}`, cookieVendedor);
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as { plataformas: Array<{ id: string; precioVenta: string }> };
    const fila = cuerpo.plataformas.find((p) => p.id === plataformaId);
    expect(fila).toBeDefined();
    expect(fila?.precioVenta).toBe("15000");
    expect(JSON.stringify(fila)).not.toContain("costo");
  });

  it("R4: un EMPLEADO que vende UNIDAD recibe el mensaje pero NUNCA costo/utilidad; un ADMIN sí los recibe", async () => {
    const respuestaVendedor = await post(
      { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId },
      cookieVendedor,
    );
    expect(respuestaVendedor.status).toBe(201);
    const cuerpoVendedor = (await respuestaVendedor.json()) as { venta: Record<string, unknown> };
    expect(cuerpoVendedor.venta.mensajeGenerado).toBeString();
    expect(cuerpoVendedor.venta.costo).toBeUndefined();
    expect(cuerpoVendedor.venta.utilidad).toBeUndefined();

    const respuestaAdmin = await post(
      { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId },
      cookieAdmin,
    );
    expect(respuestaAdmin.status).toBe(201);
    const cuerpoAdmin = (await respuestaAdmin.json()) as { venta: { costo: string; utilidad: string } };
    expect(cuerpoAdmin.venta.costo).toBe("8000");
    expect(cuerpoAdmin.venta.utilidad).toBe("7000");
  });

  it("sin pantallas libres (ambas ya vendidas por las dos pruebas anteriores), responde 409 INVENTARIO_INSUFICIENTE", async () => {
    const respuesta = await post({ tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }, cookieVendedor);
    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe("INVENTARIO_INSUFICIENTE");
  });

  it("precio inexistente para la combinación responde 409 ITEM_NO_DISPONIBLE, no 500", async () => {
    const otraDuracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "14 días sin precio (ventas-ruta.test)", cantidad: 14, unidad: "DIAS" },
    });

    const respuesta = await post(
      { tipoVenta: "UNIDAD", plataformaId, duracionId: otraDuracion.id, tipoClienteId },
      cookieVendedor,
    );
    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe("ITEM_NO_DISPONIBLE");

    await prismaRaw.duracion.delete({ where: { id: otraDuracion.id } });
  });
});

// ---------------------------------------------------------------------------
// Saldo — pruebas a nivel de ruta, porque la lógica de DEVOLUCION vive
// inline en el handler PATCH /:id/anular (no hay una función de lib/
// reutilizable para llamar directamente, a diferencia de realizarVenta). Las
// pruebas de concurrencia/deadlock/rollback que SÍ pueden ejercer
// realizarVenta directamente viven en lib/ventas-saldo.test.ts.
//
// Los distintos it() de este describe comparten estado (el saldo del mismo
// vendedor va avanzando de una prueba a la siguiente, igual que el
// inventario compartido del describe de arriba) — el comentario de cada
// prueba deja explícito el saldo esperado en cada paso.
// ---------------------------------------------------------------------------

describe("Rutas de ventas (Saldo) — mensaje de saldo insuficiente y devolución al anular", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let cookieVendedor: string;
  let vendedorId: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;

  const SALDO_INICIAL = "30000";

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa ventas-saldo-ruta (ventas.test)", prefijoCodigo: "VSR" },
    });
    empresaId = empresa.id;

    const adminEmail = `admin-ventas-saldo-ruta-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });
    cookieAdmin = await iniciarSesion(adminEmail);

    const vendedorEmail = `vendedor-ventas-saldo-ruta-${randomUUID()}@test.local`;
    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: vendedorEmail,
        passwordHash: hash,
        nombre: "Revendedor",
        rol: "VENDEDOR",
        usaSaldo: true,
        saldo: SALDO_INICIAL,
      },
    });
    vendedorId = vendedor.id;
    cookieVendedor = await iniciarSesion(vendedorEmail);

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (ventas-saldo-ruta.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const cuenta = await prismaRaw.cuenta.create({
      data: {
        empresaId,
        plataformaId,
        correo: "netflix@ventas-saldo-ruta.test",
        password: cifrar("clave"),
        capacidadPantallas: 3,
      },
    });
    await Promise.all(
      [1, 2, 3].map((numero) => prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero } })),
    );

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (ventas-saldo-ruta.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Nuevo (ventas-saldo-ruta.test)" },
    });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "10000", costo: "4000" },
    });

    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "UNIDAD", contenido: "Código {{codigoCompra}} - {{correo}} - {{clave}}" },
    });
  });

  afterAll(async () => {
    await prismaRaw.movimientoSaldo.deleteMany({ where: { empresaId } });
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  async function post(body: unknown, cookie: string) {
    return ventas.handle(
      new Request("http://local/ventas", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  async function anular(id: string, cookie: string) {
    return ventas.handle(new Request(`http://local/ventas/${id}/anular`, { method: "PATCH", headers: { cookie } }));
  }

  it("409 SALDO_INSUFICIENTE: el mensaje dice cuánto cuesta, cuánto tiene y cuánto le falta — no un 'saldo insuficiente' sin números", async () => {
    // Deja el saldo deliberadamente por debajo del precio (10000), con un
    // sobrante (7000) que no coincide con el propio saldo (3000) para que
    // la prueba no pueda confundir un número con otro por coincidencia.
    await prismaRaw.usuario.update({ where: { id: vendedorId }, data: { saldo: "3000" } });

    const respuesta = await post({ tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }, cookieVendedor);
    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string; mensaje: string } };
    expect(cuerpo.error.codigo).toBe("SALDO_INSUFICIENTE");
    expect(cuerpo.error.mensaje).toContain("10000"); // cuánto cuesta
    expect(cuerpo.error.mensaje).toContain("3000"); // cuánto tiene
    expect(cuerpo.error.mensaje).toContain("7000"); // cuánto le falta

    // Nada se escribió: ni venta, ni movimiento, ni cambio de saldo.
    const usuarioTrasRechazo = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorId } });
    expect(new Prisma.Decimal(usuarioTrasRechazo.saldo).equals(3000)).toBe(true);
    const movimientosTrasRechazo = await prismaRaw.movimientoSaldo.findMany({ where: { usuarioId: vendedorId } });
    expect(movimientosTrasRechazo).toHaveLength(0);

    await prismaRaw.usuario.update({ where: { id: vendedorId }, data: { saldo: SALDO_INICIAL } });
  });

  it("doble anulación concurrente (misma venta, dos peticiones PATCH en paralelo reales): devuelve el saldo exactamente una vez, nunca dos", async () => {
    // Saldo al entrar: 30000. Vende una unidad (10000) -> 20000.
    const respuestaVenta = await post({ tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }, cookieVendedor);
    expect(respuestaVenta.status).toBe(201);
    const cuerpoVenta = (await respuestaVenta.json()) as { venta: { id: string } };
    const ventaId = cuerpoVenta.venta.id;

    const usuarioTrasVenta = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorId } });
    expect(new Prisma.Decimal(usuarioTrasVenta.saldo).equals(20000)).toBe(true);

    // Dos PATCH /:id/anular EN PARALELO sobre la MISMA venta — cada uno es
    // su propia petición HTTP contra la app real, cada una abre su propia
    // transacción de Postgres (Promise.all, no llamadas secuenciales
    // disfrazadas). El bloqueo de la fila de Usuario (ver CLAUDE.md,
    // lib/bloqueo-usuario.ts) serializa las dos: la primera en obtener el
    // lock devuelve el saldo y marca `anulada`; la segunda, al obtener el
    // lock después, relee la venta y la ve ya anulada.
    const [r1, r2] = await Promise.all([anular(ventaId, cookieAdmin), anular(ventaId, cookieAdmin)]);
    const estados = [r1.status, r2.status].sort((a, b) => a - b);
    expect(estados).toEqual([200, 409]);

    const usuarioTrasAnular = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorId } });
    // Devuelto UNA sola vez: saldo vuelve a 30000, nunca a 40000.
    expect(new Prisma.Decimal(usuarioTrasAnular.saldo).equals(30000)).toBe(true);

    const movimientosDeEstaVenta = await prismaRaw.movimientoSaldo.findMany({
      where: { ventaId },
      orderBy: { createdAt: "asc" },
    });
    expect(movimientosDeEstaVenta).toHaveLength(2); // 1 CONSUMO + 1 DEVOLUCION, nunca 2 DEVOLUCION
    expect(movimientosDeEstaVenta[0]?.tipo).toBe("CONSUMO");
    expect(movimientosDeEstaVenta[1]?.tipo).toBe("DEVOLUCION");
    expect(new Prisma.Decimal(movimientosDeEstaVenta[1]!.monto).equals(10000)).toBe(true);
  });

  it("cuadre de ledger a través de venta + anulación: dos ventas más, anular solo una, saldo final == saldo inicial + suma de TODOS los movimientos del vendedor", async () => {
    // Saldo al entrar: 30000 (restaurado al final de la prueba anterior).
    const respuestaA = await post({ tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }, cookieVendedor);
    expect(respuestaA.status).toBe(201);
    const ventaAId = ((await respuestaA.json()) as { venta: { id: string } }).venta.id;

    const respuestaB = await post({ tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }, cookieVendedor);
    expect(respuestaB.status).toBe(201);

    // 30000 - 10000 - 10000 = 10000.
    const usuarioTrasDosVentas = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorId } });
    expect(new Prisma.Decimal(usuarioTrasDosVentas.saldo).equals(10000)).toBe(true);

    // Anula solo la primera de las dos: 10000 + 10000 (devolución) = 20000.
    const respuestaAnular = await anular(ventaAId, cookieAdmin);
    expect(respuestaAnular.status).toBe(200);

    const usuarioFinal = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorId } });
    expect(new Prisma.Decimal(usuarioFinal.saldo).equals(20000)).toBe(true);

    // Cuadre de ledger (CLAUDE.md R3 — un movimiento nunca se reescribe):
    // el saldo vigente de la fila tiene que ser exactamente el saldo con el
    // que arrancó este describe más la suma firmada de absolutamente todos
    // los movimientos de este vendedor, incluidos los de la prueba
    // anterior (doble anulación) — no solo los de esta prueba.
    const todosLosMovimientos = await prismaRaw.movimientoSaldo.findMany({
      where: { usuarioId: vendedorId },
      orderBy: { createdAt: "asc" },
    });
    expect(todosLosMovimientos).toHaveLength(5); // CONSUMO+DEVOLUCION (prueba anterior) + CONSUMO+CONSUMO+DEVOLUCION (esta)

    const sumaMovimientos = todosLosMovimientos.reduce((acc, m) => acc.plus(m.monto), new Prisma.Decimal(0));
    expect(new Prisma.Decimal(SALDO_INICIAL).plus(sumaMovimientos).equals(usuarioFinal.saldo)).toBe(true);

    // El saldoResultante del ÚLTIMO movimiento (por orden cronológico) es
    // exactamente el saldo vigente de la fila: la auditoría y el valor en
    // vivo nunca pueden desincronizarse.
    const ultimo = todosLosMovimientos[todosLosMovimientos.length - 1]!;
    expect(new Prisma.Decimal(ultimo.saldoResultante).equals(usuarioFinal.saldo)).toBe(true);
  });
});
