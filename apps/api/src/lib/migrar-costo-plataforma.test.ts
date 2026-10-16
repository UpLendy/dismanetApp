// Prueba de la migración de datos de src/lib/migrar-costo-plataforma.ts
// (CostoPlataforma a partir del mayor Precio.costo por tipo de cliente).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { migrarCostoPlataformaDeEmpresa } from "./migrar-costo-plataforma.ts";
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";

describe("migrarCostoPlataformaDeEmpresa", () => {
  let empresaId: string;
  let plataformaConCostoId: string;
  let plataformaSinCostoId: string;
  let plataformaYaMigradaId: string;
  let duracionId: string;
  let tipoClienteAId: string;
  let tipoClienteBId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa migración costo (test)", prefijoCodigo: "MCT" },
    });
    empresaId = empresa.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoClienteA = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Normal (test)" } });
    tipoClienteAId = tipoClienteA.id;
    const tipoClienteB = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Reseller (test)" } });
    tipoClienteBId = tipoClienteB.id;

    const plataformaConCosto = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (test)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaConCostoId = plataformaConCosto.id;
    // Dos Precio para la misma plataforma+duración, costos distintos por
    // tipo de cliente — debe quedarse con el MAYOR (6000, no 5000).
    await prismaRaw.precio.create({
      data: {
        empresaId,
        plataformaId: plataformaConCostoId,
        duracionId,
        tipoClienteId: tipoClienteAId,
        precioVenta: "15000",
        costo: "5000",
      },
    });
    await prismaRaw.precio.create({
      data: {
        empresaId,
        plataformaId: plataformaConCostoId,
        duracionId,
        tipoClienteId: tipoClienteBId,
        precioVenta: "14000",
        costo: "6000",
      },
    });

    const plataformaSinCosto = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney (test, sin costo)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaSinCostoId = plataformaSinCosto.id;
    await prismaRaw.precio.create({
      data: {
        empresaId,
        plataformaId: plataformaSinCostoId,
        duracionId,
        tipoClienteId: tipoClienteAId,
        precioVenta: "10000",
        costo: "0",
      },
    });

    const plataformaYaMigrada = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Spotify (test, ya migrada)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaYaMigradaId = plataformaYaMigrada.id;
    await prismaRaw.precio.create({
      data: {
        empresaId,
        plataformaId: plataformaYaMigradaId,
        duracionId,
        tipoClienteId: tipoClienteAId,
        precioVenta: "8000",
        costo: "3000",
      },
    });
    // Ya tiene CostoPlataforma cargado a mano con otro valor — la migración
    // NUNCA debe sobrescribirlo.
    await prismaRaw.costoPlataforma.create({
      data: { empresaId, plataformaId: plataformaYaMigradaId, duracionId, costo: "999" },
    });
  });

  afterAll(async () => {
    const plataformaIds = [plataformaConCostoId, plataformaSinCostoId, plataformaYaMigradaId];
    await prismaRaw.costoPlataforma.deleteMany({ where: { plataformaId: { in: plataformaIds } } });
    await prismaRaw.precio.deleteMany({ where: { plataformaId: { in: plataformaIds } } });
    await prismaRaw.plataforma.deleteMany({ where: { id: { in: plataformaIds } } });
    await prismaRaw.tipoCliente.deleteMany({ where: { id: { in: [tipoClienteAId, tipoClienteBId] } } });
    await prismaRaw.duracion.deleteMany({ where: { id: duracionId } });
    await prismaRaw.empresa.deleteMany({ where: { id: empresaId } });
  });

  it("toma el mayor costo entre los tipos de cliente", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    await migrarCostoPlataformaDeEmpresa(cliente);

    const costo = await cliente.costoPlataforma.findFirstOrThrow({
      where: { plataformaId: plataformaConCostoId, duracionId },
    });
    expect(costo.costo.toString()).toBe("6000");
  });

  it("reporta sin costo el par que nunca tuvo un Precio.costo mayor a cero", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const reporte = await migrarCostoPlataformaDeEmpresa(cliente);

    const faltante = reporte.paresSinCosto.find((p) => p.plataformaId === plataformaSinCostoId);
    expect(faltante).toBeDefined();
    expect(faltante?.duracionId).toBe(duracionId);
  });

  it("nunca sobrescribe un CostoPlataforma ya existente", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    await migrarCostoPlataformaDeEmpresa(cliente);

    const costo = await cliente.costoPlataforma.findFirstOrThrow({
      where: { plataformaId: plataformaYaMigradaId, duracionId },
    });
    expect(costo.costo.toString()).toBe("999");
  });

  it("corre dos veces sin cambiar nada la segunda vez", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    await migrarCostoPlataformaDeEmpresa(cliente);
    const primerConteo = await cliente.costoPlataforma.count({
      where: { plataformaId: { in: [plataformaConCostoId, plataformaSinCostoId, plataformaYaMigradaId] } },
    });

    await migrarCostoPlataformaDeEmpresa(cliente);
    const segundoConteo = await cliente.costoPlataforma.count({
      where: { plataformaId: { in: [plataformaConCostoId, plataformaSinCostoId, plataformaYaMigradaId] } },
    });

    expect(segundoConteo).toBe(primerConteo);
  });
});
