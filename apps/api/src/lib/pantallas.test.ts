import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
// prismaRaw en este archivo: arma la fixture directamente, fuera de
// cualquier contexto de empresa autenticado — mismo patrón que
// paquetes.test.ts.
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { plataformasDisponibles, estadoDesde, contarPantallasPorPlataforma } from "./pantallas.ts";

// ---------------------------------------------------------------------------
// F4.12 — estadoDesde es el único hogar de R5 en TypeScript, pura y sin base
// de datos: las cuatro filas de la tabla de derivación (CLAUDE.md R5 /
// PROMPT-F4.12-Y-F4.13-RENDIMIENTO.md), probadas directamente contra la
// función, sin pasar por fixtures de Prisma.
// ---------------------------------------------------------------------------
describe("estadoDesde (R5, función pura)", () => {
  const ahora = new Date("2026-06-15T12:00:00Z");

  it("ultimoVencimiento null ⇒ LIBRE (nunca vendida)", () => {
    expect(estadoDesde(null, null, ahora)).toBe("LIBRE");
    // liberadaEn no importa si nunca hubo un VentaDetalle.
    expect(estadoDesde(new Date(ahora.getTime() - 1000), null, ahora)).toBe("LIBRE");
  });

  it("ultimoVencimiento > ahora ⇒ OCUPADA, sin importar liberadaEn", () => {
    const futuro = new Date(ahora.getTime() + 1000);
    expect(estadoDesde(null, futuro, ahora)).toBe("OCUPADA");
    expect(estadoDesde(futuro, futuro, ahora)).toBe("OCUPADA");
  });

  it("ultimoVencimiento <= ahora y liberadaEn null ⇒ POR_REINICIAR (venció, nadie reinició la cuenta)", () => {
    const vencida = new Date(ahora.getTime() - 1000);
    expect(estadoDesde(null, vencida, ahora)).toBe("POR_REINICIAR");
  });

  it("ultimoVencimiento <= ahora y liberadaEn ANTERIOR al vencimiento ⇒ POR_REINICIAR (se revendió tras un reinicio y volvió a vencer, sin un segundo reinicio desde entonces)", () => {
    const vencimiento = new Date(ahora.getTime() - 1000);
    const liberadaAntes = new Date(vencimiento.getTime() - 5000);
    expect(estadoDesde(liberadaAntes, vencimiento, ahora)).toBe("POR_REINICIAR");
  });

  it("ultimoVencimiento <= ahora y liberadaEn POSTERIOR al vencimiento ⇒ LIBRE (reinicio real)", () => {
    const vencimiento = new Date(ahora.getTime() - 5000);
    const liberadaDespues = new Date(vencimiento.getTime() + 1000);
    expect(estadoDesde(liberadaDespues, vencimiento, ahora)).toBe("LIBRE");
  });

  it("liberadaEn exactamente igual al vencimiento ⇒ LIBRE (la comparación es estrictamente mayor, no ≥)", () => {
    const vencimiento = new Date(ahora.getTime() - 1000);
    expect(estadoDesde(vencimiento, vencimiento, ahora)).toBe("LIBRE");
  });
});

// ---------------------------------------------------------------------------
// F4.12 — contarPantallasPorPlataforma reemplaza los 2N viajes a la base
// (uno por plataforma) por dos consultas para TODAS las plataformas juntas.
// La prueba de abajo usa varias plataformas a propósito: si alguien
// reintrodujera un `await` dentro de un `map` sobre plataformas, el conteo
// de consultas crecería con el número de plataformas y la prueba fallaría.
// ---------------------------------------------------------------------------
describe("contarPantallasPorPlataforma (F4.12) — dos consultas para todas las plataformas", () => {
  let empresaId: string;
  const plataformaIds: string[] = [];

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa contar-por-plataforma (pantallas.test)", prefijoCodigo: "CPP" },
    });
    empresaId = empresa.id;

    for (let i = 0; i < 4; i++) {
      const plataforma = await prismaRaw.plataforma.create({
        data: {
          empresaId,
          nombre: `Plataforma ${i} (pantallas.test contar-por-plataforma)`,
          capacidadPantallas: 1,
          usaPerfilPin: false,
        },
      });
      plataformaIds.push(plataforma.id);
      for (let j = 0; j < 3; j++) {
        const cuenta = await prismaRaw.cuenta.create({
          data: {
            empresaId,
            plataformaId: plataforma.id,
            correo: `cpp-${i}-${j}@test.local`,
            password: "cifrado",
            capacidadPantallas: 1,
          },
        });
        await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 1 } });
      }
    }
  });

  afterAll(async () => {
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("hace exactamente dos consultas para las 4 plataformas juntas, y cuenta bien cada una", async () => {
    let consultas = 0;
    const clienteContado = prismaRaw.$extends({
      query: {
        $allModels: {
          async $allOperations({ query, args }) {
            consultas++;
            return query(args);
          },
        },
      },
    });
    const cliente = prismaParaEmpresa(empresaId, clienteContado as unknown as typeof prismaRaw);

    const conteos = await contarPantallasPorPlataforma(cliente, plataformaIds);

    expect(consultas).toBe(2);
    for (const id of plataformaIds) {
      expect(conteos.get(id)).toEqual({ libres: 3, porReiniciar: 0, ocupadas: 0 });
    }
  });
});

describe("plataformasDisponibles (entrega 8, modo UNIDAD) — precio activo + inventario libre (R5)", () => {
  let empresaId: string;
  let plataformaId: string;
  let cuentaId: string;
  let vendedorId: string;
  let tipoClienteId: string;
  let duracionId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa plataformas-disponibles (pantallas.test)", prefijoCodigo: "PFD" },
    });
    empresaId = empresa.id;

    const plataforma = await prismaRaw.plataforma.create({
      data: {
        empresaId,
        nombre: "Netflix (pantallas.test)",
        condiciones: "1 pantalla. Solo TV",
        capacidadPantallas: 1,
        usaPerfilPin: false,
      },
    });
    plataformaId = plataforma.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (pantallas.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Nuevo (pantallas.test)" },
    });
    tipoClienteId = tipoCliente.id;

    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-plataformas-disponibles-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Vendedor",
        rol: "VENDEDOR",
      },
    });
    vendedorId = vendedor.id;

    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "cuenta-pfd@test.local", password: "cifrado", capacidadPantallas: 1 },
    });
    cuentaId = cuenta.id;
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId, numero: 1 } });

    await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "15000", costo: "7000" },
    });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("con precio activo e inventario libre, la plataforma aparece con sus condiciones y el conteo de libres", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const disponibles = await plataformasDisponibles(cliente, duracionId, tipoClienteId);

    const fila = disponibles.find((p) => p.id === plataformaId);
    expect(fila).toBeDefined();
    expect(fila?.condiciones).toBe("1 pantalla. Solo TV");
    expect(fila?.pantallasLibres).toBe(1);
  });

  it("sin precio activo para la duración/tipo de cliente consultados, la plataforma no aparece aunque haya inventario", async () => {
    const otraDuracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "14 días (sin precio, pantallas.test)", cantidad: 14, unidad: "DIAS" },
    });

    const cliente = prismaParaEmpresa(empresaId);
    const disponibles = await plataformasDisponibles(cliente, otraDuracion.id, tipoClienteId);
    expect(disponibles.map((p) => p.id)).not.toContain(plataformaId);

    await prismaRaw.duracion.delete({ where: { id: otraDuracion.id } });
  });

  it("con la única pantalla ocupada por una venta vigente no anulada, la plataforma deja de estar disponible", async () => {
    const pantalla = await prismaRaw.pantalla.findFirstOrThrow({ where: { empresaId, cuentaId } });

    const venta = await prismaRaw.venta.create({
      data: {
        empresaId,
        vendedorId,
        codigoCompra: `PFD-${randomUUID()}`,
        tipoVenta: "UNIDAD",
        plataformaId,
        duracionId,
        tipoClienteId,
        nombreItem: "Netflix",
        nombreDuracion: "30 días",
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        nombreTipoCliente: "Nuevo",
        precioVenta: "15000",
        precioSugerido: "15000",
        costo: "7000",
        utilidad: "8000",
        fechaVencimientoMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        mensajeGenerado: "irrelevante",
      },
    });

    await prismaRaw.ventaDetalle.create({
      data: {
        empresaId,
        ventaId: venta.id,
        pantallaId: pantalla.id,
        cuentaId,
        plataformaId,
        nombrePlataforma: "Netflix",
        correoCuenta: "cuenta-pfd@test.local",
        passwordCuenta: "cifrado",
        duracionId,
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const cliente = prismaParaEmpresa(empresaId);
    const disponibles = await plataformasDisponibles(cliente, duracionId, tipoClienteId);
    expect(disponibles.map((p) => p.id)).not.toContain(plataformaId);

    await prismaRaw.venta.update({ where: { id: venta.id }, data: { anulada: true } });
  });

  it("desactivar el precio de la plataforma la saca de disponibles aunque el inventario siga libre", async () => {
    await prismaRaw.precio.updateMany({ where: { empresaId, plataformaId }, data: { activo: false } });

    const cliente = prismaParaEmpresa(empresaId);
    const disponibles = await plataformasDisponibles(cliente, duracionId, tipoClienteId);
    expect(disponibles.map((p) => p.id)).not.toContain(plataformaId);

    await prismaRaw.precio.updateMany({ where: { empresaId, plataformaId }, data: { activo: true } });
  });
});
