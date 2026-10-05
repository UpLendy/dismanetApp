import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Prisma } from "../generated/prisma/client.ts";
// prismaRaw en este archivo: excepción explícita — esta prueba verifica un
// CHECK a nivel de base de datos (no de aplicación), así que necesita poder
// intentar insertar filas inválidas sin que prismaParaEmpresa las rechace
// antes de llegar a Postgres.
import { prismaRaw } from "./prisma.ts";

// Precio.plataformaId y Precio.paqueteId son ambos nullable en el esquema de
// Prisma porque Prisma no expresa CHECK arbitrarios. La migración
// 20260929173926_check_precio_plataforma_xor_paquete agrega el CHECK real a
// nivel de Postgres: exactamente uno de los dos debe estar presente. Esta
// prueba confirma que el CHECK sigue vigente en la base, no solo que existe
// el archivo de migración.
describe("Precio — CHECK (plataformaId IS NULL) <> (paqueteId IS NULL)", () => {
  let empresaId: string;
  let duracionId: string;
  let tipoClienteId: string;
  let plataformaId: string;
  let paqueteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa check precio (precio-check.test)", prefijoCodigo: "PCK" },
    });
    empresaId = empresa.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (precio-check.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Normal (precio-check.test)" },
    });
    tipoClienteId = tipoCliente.id;

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (precio-check.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const paquete = await prismaRaw.paquete.create({
      data: { empresaId, nombre: "Básico (precio-check.test)" },
    });
    paqueteId = paquete.id;
  });

  afterAll(async () => {
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.paquete.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("una fila sin plataformaId NI paqueteId es rechazada por el CHECK de la base", async () => {
    let error: unknown;
    try {
      await prismaRaw.precio.create({
        data: { empresaId, duracionId, tipoClienteId, precioVenta: "1000", costo: "0" },
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const err = error as Prisma.PrismaClientKnownRequestError;
    const meta = err.meta as { driverAdapterError?: { cause?: { code?: string } } } | undefined;
    expect(meta?.driverAdapterError?.cause?.code).toBe("23514");
    expect(err.message).toContain("precio_plataforma_xor_paquete");
  });

  it("una fila con plataformaId Y paqueteId a la vez es rechazada por el CHECK de la base", async () => {
    let error: unknown;
    try {
      await prismaRaw.precio.create({
        data: { empresaId, plataformaId, paqueteId, duracionId, tipoClienteId, precioVenta: "1000", costo: "0" },
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const err = error as Prisma.PrismaClientKnownRequestError;
    const meta = err.meta as { driverAdapterError?: { cause?: { code?: string } } } | undefined;
    expect(meta?.driverAdapterError?.cause?.code).toBe("23514");
    expect(err.message).toContain("precio_plataforma_xor_paquete");
  });

  it("una fila con exactamente plataformaId (y paqueteId null) sí se crea", async () => {
    const precio = await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "1000", costo: "0" },
    });
    expect(precio.plataformaId).toBe(plataformaId);
    expect(precio.paqueteId).toBeNull();
  });
});
