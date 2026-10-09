// Prueba de la migración de datos 20261009164941_rol_migrar_empleados_sin_saldo.
// Ejecuta el mismo UPDATE de la migración directamente (no vía CLI de Prisma)
// para verificar que divide VENDEDOR en VENDEDOR/EMPLEADO correctamente, que
// es idempotente, y que no toca usuarios que no corresponden.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";

import { prismaRaw } from "./prisma.ts";

async function correrMigracion() {
  await prismaRaw.$executeRaw`UPDATE "Usuario" SET rol = 'EMPLEADO' WHERE rol = 'VENDEDOR' AND "usaSaldo" = false`;
}

describe("Migración de datos — dividir VENDEDOR en VENDEDOR/EMPLEADO", () => {
  let empresaId: string;
  let vendedorSinSaldoId: string;
  let vendedorConSaldoId: string;
  let adminId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa migración rol (migracion.test)", prefijoCodigo: "MGR" },
    });
    empresaId = empresa.id;

    const hash = await argon2.hash("clave-no-usada", { type: argon2.argon2id });

    // Antes de esta migración, un VENDEDOR con usaSaldo=false era en la
    // práctica un empleado: debe pasar a EMPLEADO.
    const vendedorSinSaldo = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `sin-saldo-${randomUUID()}@migracion.test`,
        passwordHash: hash,
        nombre: "Sin saldo",
        rol: "VENDEDOR",
        usaSaldo: false,
      },
    });
    vendedorSinSaldoId = vendedorSinSaldo.id;

    // Un VENDEDOR que ya usaba saldo sigue siendo un revendedor: no se toca.
    const vendedorConSaldo = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `con-saldo-${randomUUID()}@migracion.test`,
        passwordHash: hash,
        nombre: "Con saldo",
        rol: "VENDEDOR",
        usaSaldo: true,
      },
    });
    vendedorConSaldoId = vendedorConSaldo.id;

    // Un ADMIN nunca debe migrar a EMPLEADO, sin importar la columna
    // usaSaldo (que para un ADMIN no tiene significado alguno).
    const admin = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `admin-${randomUUID()}@migracion.test`,
        passwordHash: hash,
        nombre: "Admin",
        rol: "ADMIN",
        usaSaldo: false,
      },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prismaRaw.usuario.deleteMany({
      where: { id: { in: [vendedorSinSaldoId, vendedorConSaldoId, adminId] } },
    });
    await prismaRaw.empresa.deleteMany({ where: { id: empresaId } });
  });

  it("migra a EMPLEADO solo al VENDEDOR con usaSaldo=false", async () => {
    await correrMigracion();

    const migrado = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorSinSaldoId } });
    expect(migrado.rol).toBe("EMPLEADO");
  });

  it("no toca al VENDEDOR que ya usaba saldo", async () => {
    await correrMigracion();

    const sinTocar = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorConSaldoId } });
    expect(sinTocar.rol).toBe("VENDEDOR");
  });

  it("no toca a un ADMIN, sin importar usaSaldo", async () => {
    await correrMigracion();

    const sinTocar = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: adminId } });
    expect(sinTocar.rol).toBe("ADMIN");
  });

  it("corre dos veces sin fallar y sin cambiar nada en la segunda corrida", async () => {
    await correrMigracion();
    await correrMigracion();

    const migrado = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorSinSaldoId } });
    expect(migrado.rol).toBe("EMPLEADO");
  });
});
