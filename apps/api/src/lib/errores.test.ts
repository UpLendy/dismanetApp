import { afterAll, describe, expect, it } from "bun:test";
// prismaRaw en este archivo: excepción explícita — la prueba necesita
// provocar una violación real de restricción única contra la base de datos
// con el driver actual (@prisma/adapter-pg), no simular a mano la forma del
// error. Si @prisma/adapter-pg cambia de forma, o si el proyecto migra al
// motor binario/WASM, esta prueba debe fallar para que restriccionViolada()
// se actualice en consecuencia (ver CLAUDE.md).
import { prismaRaw } from "./prisma.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { restriccionViolada } from "./errores.ts";

describe("a) restriccionViolada() identifica por nombre una violación real contra la BD", () => {
  const prefijoCodigo = "ERR";
  const idsEmpresas: string[] = [];

  afterAll(async () => {
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  it("P2002 real de Empresa.prefijoCodigo se identifica como 'prefijoCodigo'", async () => {
    const primera = await prismaRaw.empresa.create({
      data: { nombre: "Empresa original (errores.test)", prefijoCodigo },
    });
    idsEmpresas.push(primera.id);

    let errorCapturado: unknown;
    try {
      await prismaRaw.empresa.create({
        data: { nombre: "Empresa duplicada (errores.test)", prefijoCodigo },
      });
    } catch (error) {
      errorCapturado = error;
    }

    expect(errorCapturado).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const error = errorCapturado as Prisma.PrismaClientKnownRequestError;
    expect(error.code).toBe("P2002");

    const objetivo = restriccionViolada(error);
    expect(objetivo).toContain("prefijoCodigo");
  });
});
