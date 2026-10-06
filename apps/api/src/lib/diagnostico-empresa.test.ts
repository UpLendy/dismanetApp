import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
// prismaRaw en este archivo: excepción explícita — arma la fixture (empresa,
// catálogo, cuentas y pantallas) fuera de cualquier contexto de empresa
// autenticado, igual que paquetes.test.ts/duraciones.test.ts.
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { cifrar } from "./cifrado.ts";
import { diagnosticoDeEmpresa } from "./diagnostico-empresa.ts";

describe("diagnosticoDeEmpresa", () => {
  let empresaId: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;
  let cuentaId: string;
  let pantallaId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa diagnóstico (diagnostico-empresa.test)", prefijoCodigo: "DGX" },
    });
    empresaId = empresa.id;

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (DGX)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (DGX)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (DGX)" } });
    tipoClienteId = tipoCliente.id;

    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "dgx@diagnostico.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    cuentaId = cuenta.id;

    const pantalla = await prismaRaw.pantalla.create({ data: { empresaId, cuentaId, numero: 1 } });
    pantallaId = pantalla.id;
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.paqueteDuracionPlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquetePlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquete.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("empresa recién creada, sin nada configurado: todos los conteos en cero y puedeVender falso", async () => {
    const diagnostico = await diagnosticoDeEmpresa(prismaParaEmpresa(empresaId));
    expect(diagnostico.plantillas).toEqual({ existeUnidad: false, existePaquete: false });
    expect(diagnostico.preciosActivos).toBe(0);
    expect(diagnostico.puedeVender).toBe(false);
    // El catálogo base sí existe (plataforma, duración, tipoCliente, cuenta, pantalla).
    expect(diagnostico.plataformasActivas).toBe(1);
    expect(diagnostico.duracionesActivas).toBe(1);
    expect(diagnostico.tiposClienteActivos).toBe(1);
    expect(diagnostico.cuentasActivas).toBe(1);
    expect(diagnostico.pantallasActivas).toBe(1);
    expect(diagnostico.pantallasLibres).toBe(1);
  });

  it("con precio activo y pantalla libre: puedeVender es verdadero (UNIDAD)", async () => {
    const precio = await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "15000", costo: "8000" },
    });

    const diagnostico = await diagnosticoDeEmpresa(prismaParaEmpresa(empresaId));
    expect(diagnostico.preciosActivos).toBe(1);
    expect(diagnostico.preciosConCostoCero).toBe(0);
    expect(diagnostico.puedeVender).toBe(true);

    await prismaRaw.precio.delete({ where: { id: precio.id } });
  });

  it("cuenta un precio activo con costo en cero por separado", async () => {
    const precioGratis = await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "15000", costo: "0" },
    });

    const diagnostico = await diagnosticoDeEmpresa(prismaParaEmpresa(empresaId));
    expect(diagnostico.preciosActivos).toBe(1);
    expect(diagnostico.preciosConCostoCero).toBe(1);
    // Con costo 0 el precio sigue activo y la pantalla sigue libre: sigue
    // siendo técnicamente vendible, aunque el costo en cero merezca aviso
    // aparte (ver pantalla de precios).
    expect(diagnostico.puedeVender).toBe(true);

    await prismaRaw.precio.delete({ where: { id: precioGratis.id } });
  });

  it("si la única pantalla está ocupada (venta vigente, no anulada): puedeVender es falso", async () => {
    const precio = await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "15000", costo: "8000" },
    });
    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: `vendedor-dgx-${randomUUID()}@test.local`, passwordHash: "x", nombre: "V", rol: "VENDEDOR" },
    });
    const venta = await prismaRaw.venta.create({
      data: {
        empresaId,
        vendedorId: vendedor.id,
        codigoCompra: `DGX${randomUUID().slice(0, 6)}`,
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
        costo: "8000",
        utilidad: "7000",
        fechaVencimientoMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        mensajeGenerado: "venta de prueba diagnóstico",
      },
    });
    await prismaRaw.ventaDetalle.create({
      data: {
        empresaId,
        ventaId: venta.id,
        pantallaId,
        cuentaId,
        plataformaId,
        nombrePlataforma: "Netflix",
        correoCuenta: "dgx@diagnostico.test",
        passwordCuenta: cifrar("clave"),
        duracionId,
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const diagnostico = await diagnosticoDeEmpresa(prismaParaEmpresa(empresaId));
    expect(diagnostico.pantallasLibres).toBe(0);
    expect(diagnostico.puedeVender).toBe(false);

    await prismaRaw.ventaDetalle.deleteMany({ where: { ventaId: venta.id } });
    await prismaRaw.venta.delete({ where: { id: venta.id } });
    await prismaRaw.usuario.delete({ where: { id: vendedor.id } });
    await prismaRaw.precio.delete({ where: { id: precio.id } });
  });

  it("plantillas: refleja UNIDAD y PAQUETE por separado", async () => {
    const plantillaUnidad = await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "UNIDAD", contenido: "Código {{codigoCompra}}" },
    });

    let diagnostico = await diagnosticoDeEmpresa(prismaParaEmpresa(empresaId));
    expect(diagnostico.plantillas).toEqual({ existeUnidad: true, existePaquete: false });

    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "PAQUETE", contenido: "Código {{codigoCompra}}" },
    });

    diagnostico = await diagnosticoDeEmpresa(prismaParaEmpresa(empresaId));
    expect(diagnostico.plantillas).toEqual({ existeUnidad: true, existePaquete: true });

    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
  });

  it("paquete con inventario insuficiente en un componente: puedeVender falso; al completarlo, verdadero", async () => {
    const disney = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ (DGX)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    const cuentaDisney = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: disney.id, correo: "disney@dgx.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    // Sin pantallas para Disney+ todavía: el componente no tiene inventario.

    const paquete = await prismaRaw.paquete.create({ data: { empresaId, nombre: "Combo (DGX)" } });
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId: paquete.id, plataformaId, cantidadPantallas: 1 },
    });
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId: paquete.id, plataformaId: disney.id, cantidadPantallas: 1 },
    });
    const precioPaquete = await prismaRaw.precio.create({
      data: { empresaId, paqueteId: paquete.id, duracionId, tipoClienteId, precioVenta: "20000", costo: "10000" },
    });

    let diagnostico = await diagnosticoDeEmpresa(prismaParaEmpresa(empresaId));
    expect(diagnostico.puedeVender).toBe(false);

    // Se agrega la pantalla de Disney+ que faltaba: ahora el paquete completo sí es vendible.
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaDisney.id, numero: 1 } });

    diagnostico = await diagnosticoDeEmpresa(prismaParaEmpresa(empresaId));
    expect(diagnostico.puedeVender).toBe(true);
    expect(diagnostico.paquetesActivos).toBe(1);

    await prismaRaw.precio.delete({ where: { id: precioPaquete.id } });
    await prismaRaw.paquetePlataforma.deleteMany({ where: { paqueteId: paquete.id } });
    await prismaRaw.paquete.delete({ where: { id: paquete.id } });
    await prismaRaw.pantalla.deleteMany({ where: { cuentaId: cuentaDisney.id } });
    await prismaRaw.cuenta.delete({ where: { id: cuentaDisney.id } });
    await prismaRaw.plataforma.delete({ where: { id: disney.id } });
  });
});
