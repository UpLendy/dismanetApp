import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
// prismaRaw en este archivo: arma la fixture directamente, fuera de
// cualquier contexto de empresa autenticado — mismo patrón que
// paquetes.test.ts.
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { plataformasParaGrid } from "./pantallas.ts";

describe("plataformasParaGrid (/vender paso 2, modo UNIDAD) — nunca oculta, solo deshabilita (R5)", () => {
  let empresaId: string;
  let plataformaId: string;
  let cuentaId: string;
  let vendedorId: string;
  let tipoClienteId: string;
  let duracionId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa plataformas-grid (pantallas.test)", prefijoCodigo: "PFD" },
    });
    empresaId = empresa.id;

    const plataforma = await prismaRaw.plataforma.create({
      data: {
        empresaId,
        nombre: "Netflix (pantallas.test)",
        condiciones: "1 pantalla. Solo TV",
        capacidadPantallas: 1,
        usaPerfilPin: false,
        logoUrl: "/logos/netflix.svg",
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
        email: `vendedor-plataformas-grid-${randomUUID()}@test.local`,
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

  it("con precio activo e inventario libre, aparece con condiciones, logo, conteo de libres y tienePrecio", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const grid = await plataformasParaGrid(cliente);

    const fila = grid.find((p) => p.id === plataformaId);
    expect(fila).toBeDefined();
    expect(fila?.condiciones).toBe("1 pantalla. Solo TV");
    expect(fila?.logoUrl).toBe("/logos/netflix.svg");
    expect(fila?.pantallasLibres).toBe(1);
    expect(fila?.tienePrecio).toBe(true);
  });

  it("desactivar el único precio de la plataforma la deja SIN precio, pero sigue apareciendo (no se oculta)", async () => {
    await prismaRaw.precio.updateMany({ where: { empresaId, plataformaId }, data: { activo: false } });

    const cliente = prismaParaEmpresa(empresaId);
    const grid = await plataformasParaGrid(cliente);
    const fila = grid.find((p) => p.id === plataformaId);

    expect(fila).toBeDefined();
    expect(fila?.tienePrecio).toBe(false);
    expect(fila?.pantallasLibres).toBe(1);

    await prismaRaw.precio.updateMany({ where: { empresaId, plataformaId }, data: { activo: true } });
  });

  it("con la única pantalla ocupada por una venta vigente no anulada, sigue apareciendo con pantallasLibres 0 (no se oculta)", async () => {
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
    const grid = await plataformasParaGrid(cliente);
    const fila = grid.find((p) => p.id === plataformaId);

    expect(fila).toBeDefined();
    expect(fila?.pantallasLibres).toBe(0);
    expect(fila?.tienePrecio).toBe(true);

    await prismaRaw.venta.update({ where: { id: venta.id }, data: { anulada: true } });
  });

  it("una plataforma sin logoUrl configurado devuelve logoUrl null, no una cadena vacía ni un error", async () => {
    const sinLogo = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Sin logo (pantallas.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });

    const cliente = prismaParaEmpresa(empresaId);
    const grid = await plataformasParaGrid(cliente);
    const fila = grid.find((p) => p.id === sinLogo.id);

    expect(fila).toBeDefined();
    expect(fila?.logoUrl).toBeNull();
    expect(fila?.tienePrecio).toBe(false);

    await prismaRaw.plataforma.delete({ where: { id: sinLogo.id } });
  });
});
