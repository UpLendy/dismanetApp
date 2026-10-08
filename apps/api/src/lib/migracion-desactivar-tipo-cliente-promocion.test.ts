// Prueba de la migración de datos 20261007175656_desactivar_tipo_cliente_promocion.
// Ejecuta el mismo UPDATE de la migración directamente (no vía CLI de Prisma) para
// verificar que es idempotente y que no falla en una empresa sin ese TipoCliente.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { prismaRaw } from "./prisma.ts";

async function correrMigracion() {
  await prismaRaw.$executeRaw`UPDATE "TipoCliente" SET activo = false WHERE nombre = 'Promoción' AND activo = true`;
}

describe("Migración de datos — desactivar TipoCliente Promoción", () => {
  let empresaConPromoId: string;
  let empresaSinPromoId: string;
  let tipoClientePromoId: string;
  let tipoClienteOtroId: string;

  beforeAll(async () => {
    const empresaConPromo = await prismaRaw.empresa.create({
      data: { nombre: "Empresa con tipo Promoción (migracion.test)", prefijoCodigo: "MGP" },
    });
    empresaConPromoId = empresaConPromo.id;

    const empresaSinPromo = await prismaRaw.empresa.create({
      data: { nombre: "Empresa sin tipo Promoción (migracion.test)", prefijoCodigo: "MGS" },
    });
    empresaSinPromoId = empresaSinPromo.id;

    const tipoPromo = await prismaRaw.tipoCliente.create({
      data: { empresaId: empresaConPromoId, nombre: "Promoción", activo: true },
    });
    tipoClientePromoId = tipoPromo.id;

    const tipoOtro = await prismaRaw.tipoCliente.create({
      data: { empresaId: empresaSinPromoId, nombre: "Regular", activo: true },
    });
    tipoClienteOtroId = tipoOtro.id;
  });

  afterAll(async () => {
    await prismaRaw.tipoCliente.deleteMany({
      where: { empresaId: { in: [empresaConPromoId, empresaSinPromoId] } },
    });
    await prismaRaw.empresa.deleteMany({
      where: { id: { in: [empresaConPromoId, empresaSinPromoId] } },
    });
  });

  it("desactiva el TipoCliente 'Promoción' donde existe y sigue activo", async () => {
    await correrMigracion();

    const tipo = await prismaRaw.tipoCliente.findUniqueOrThrow({ where: { id: tipoClientePromoId } });
    expect(tipo.activo).toBe(false);
  });

  it("corre dos veces sin fallar y sin cambiar nada en la segunda corrida", async () => {
    await correrMigracion();
    await correrMigracion();

    const tipo = await prismaRaw.tipoCliente.findUniqueOrThrow({ where: { id: tipoClientePromoId } });
    expect(tipo.activo).toBe(false);
  });

  it("no falla en una empresa que nunca tuvo el TipoCliente 'Promoción'", async () => {
    await correrMigracion();

    const tipo = await prismaRaw.tipoCliente.findUniqueOrThrow({ where: { id: tipoClienteOtroId } });
    expect(tipo.activo).toBe(true);
    expect(tipo.nombre).toBe("Regular");
  });
});
