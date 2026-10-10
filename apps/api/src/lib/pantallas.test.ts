import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
// prismaRaw en este archivo: arma la fixture directamente, fuera de
// cualquier contexto de empresa autenticado — mismo patrón que
// paquetes.test.ts.
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { plataformasDisponibles } from "./pantallas.ts";

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
