// Prueba de la migración de datos de src/lib/migrar-cargos-default.ts
// (los cinco cargos por defecto, para empresas que ya existían antes de
// F6.1). Parte 4 del encargo F6.1: "el script de los cinco cargos corrido
// dos veces no duplica nada".
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { CARGOS_POR_DEFECTO } from "./cargos-default.ts";
import { migrarCargosDefaultDeEmpresa } from "./migrar-cargos-default.ts";
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";

describe("migrarCargosDefaultDeEmpresa", () => {
  let empresaId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa migración cargos (test)", prefijoCodigo: "MCG" },
    });
    empresaId = empresa.id;
  });

  afterAll(async () => {
    await prismaRaw.cargo.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("crea los cinco cargos por defecto la primera vez", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const reporte = await migrarCargosDefaultDeEmpresa(cliente);

    expect(reporte.creados.sort()).toEqual([...CARGOS_POR_DEFECTO].sort());
    expect(reporte.yaExistian).toEqual([]);

    const filas = await prismaRaw.cargo.findMany({ where: { empresaId } });
    expect(filas.length).toBe(CARGOS_POR_DEFECTO.length);
  });

  it("corrida dos veces no duplica nada: la segunda vez no crea ninguno", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const reporte = await migrarCargosDefaultDeEmpresa(cliente);

    expect(reporte.creados).toEqual([]);
    expect(reporte.yaExistian.sort()).toEqual([...CARGOS_POR_DEFECTO].sort());

    const filas = await prismaRaw.cargo.findMany({ where: { empresaId } });
    expect(filas.length).toBe(CARGOS_POR_DEFECTO.length);
  });

  it("si el admin ya creó uno a mano, no lo duplica y crea los otros cuatro", async () => {
    const otraEmpresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa migración cargos parcial (test)", prefijoCodigo: "MCP" },
    });

    try {
      await prismaRaw.cargo.create({ data: { empresaId: otraEmpresa.id, nombre: "Gerencia" } });

      const cliente = prismaParaEmpresa(otraEmpresa.id);
      const reporte = await migrarCargosDefaultDeEmpresa(cliente);

      expect(reporte.yaExistian).toEqual(["Gerencia"]);
      expect(reporte.creados.sort()).toEqual(
        CARGOS_POR_DEFECTO.filter((nombre) => nombre !== "Gerencia").sort(),
      );

      const filas = await prismaRaw.cargo.findMany({ where: { empresaId: otraEmpresa.id } });
      expect(filas.length).toBe(CARGOS_POR_DEFECTO.length);
    } finally {
      await prismaRaw.cargo.deleteMany({ where: { empresaId: otraEmpresa.id } });
      await prismaRaw.empresa.delete({ where: { id: otraEmpresa.id } });
    }
  });
});
