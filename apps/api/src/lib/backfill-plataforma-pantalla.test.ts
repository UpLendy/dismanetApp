// Prueba de la migración de datos de src/lib/backfill-plataforma-pantalla.ts
// (PlataformaPantalla inicial a partir de las cuentas existentes).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { backfillPlataformaPantallaDeEmpresa } from "./backfill-plataforma-pantalla.ts";
import { cifrar, descifrar } from "./cifrado.ts";
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";

describe("backfillPlataformaPantallaDeEmpresa", () => {
  let empresaId: string;
  let plataformaConCuentasId: string;
  let plataformaSinCuentasId: string;
  let plataformaYaConfiguradaId: string;
  let cuentaChicaId: string;
  let cuentaGrandeId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa backfill plantilla (test)", prefijoCodigo: "BKF" },
    });
    empresaId = empresa.id;

    // Fixtures con prismaRaw + empresaId explícito (igual que
    // migracion-rol-empleado.test.ts): es setup, no código de negocio, así
    // que no pasa por prismaParaEmpresa.
    const plataformaConCuentas = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (test)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaConCuentasId = plataformaConCuentas.id;

    const plataformaSinCuentas = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney (test, sin cuentas)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaSinCuentasId = plataformaSinCuentas.id;

    const plataformaYaConfigurada = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Spotify (test, ya configurada)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaYaConfiguradaId = plataformaYaConfigurada.id;
    // Plantilla ya existente a mano: el backfill NUNCA debe tocarla.
    await prismaRaw.plataformaPantalla.create({
      data: { empresaId, plataformaId: plataformaYaConfiguradaId, numero: 1, perfil: null, pin: null },
    });

    // Cuenta chica: 1 pantalla.
    const cuentaChica = await prismaRaw.cuenta.create({
      data: {
        empresaId,
        plataformaId: plataformaConCuentasId,
        correo: "chica@test.local",
        password: cifrar("clave-chica"),
        capacidadPantallas: 1,
        notas: null,
      },
    });
    cuentaChicaId = cuentaChica.id;
    await prismaRaw.pantalla.create({
      data: { empresaId, cuentaId: cuentaChicaId, numero: 1, perfil: "A", pin: cifrar("1111") },
    });

    // Cuenta grande: 3 pantallas — es la que debe quedar como plantilla.
    const cuentaGrande = await prismaRaw.cuenta.create({
      data: {
        empresaId,
        plataformaId: plataformaConCuentasId,
        correo: "grande@test.local",
        password: cifrar("clave-grande"),
        capacidadPantallas: 3,
        notas: null,
      },
    });
    cuentaGrandeId = cuentaGrande.id;
    await prismaRaw.pantalla.create({
      data: { empresaId, cuentaId: cuentaGrandeId, numero: 1, perfil: "A", pin: cifrar("2222") },
    });
    await prismaRaw.pantalla.create({
      data: { empresaId, cuentaId: cuentaGrandeId, numero: 2, perfil: "B", pin: cifrar("3333") },
    });
    await prismaRaw.pantalla.create({
      data: { empresaId, cuentaId: cuentaGrandeId, numero: 3, perfil: "C", pin: cifrar("4444") },
    });
  });

  afterAll(async () => {
    await prismaRaw.pantalla.deleteMany({ where: { cuentaId: { in: [cuentaChicaId, cuentaGrandeId] } } });
    await prismaRaw.cuenta.deleteMany({ where: { id: { in: [cuentaChicaId, cuentaGrandeId] } } });
    await prismaRaw.plataformaPantalla.deleteMany({
      where: { plataformaId: { in: [plataformaConCuentasId, plataformaSinCuentasId, plataformaYaConfiguradaId] } },
    });
    await prismaRaw.plataforma.deleteMany({
      where: { id: { in: [plataformaConCuentasId, plataformaSinCuentasId, plataformaYaConfiguradaId] } },
    });
    await prismaRaw.empresa.deleteMany({ where: { id: empresaId } });
  });

  it("copia la plantilla de la cuenta con más pantallas", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    await backfillPlataformaPantallaDeEmpresa(cliente);

    const plantilla = await cliente.plataformaPantalla.findMany({
      where: { plataformaId: plataformaConCuentasId },
      orderBy: { numero: "asc" },
    });
    expect(plantilla).toHaveLength(3);
    expect(plantilla.map((p) => p.numero)).toEqual([1, 2, 3]);
    expect(plantilla.map((p) => p.perfil)).toEqual(["A", "B", "C"]);
    expect(plantilla.map((p) => descifrar(p.pin!))).toEqual(["2222", "3333", "4444"]);

    const plataforma = await cliente.plataforma.findUniqueOrThrow({ where: { id: plataformaConCuentasId } });
    expect(plataforma.capacidadPantallas).toBe(3);
  });

  it("deja sin plantilla la plataforma sin cuentas", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    await backfillPlataformaPantallaDeEmpresa(cliente);

    const plantilla = await cliente.plataformaPantalla.findMany({ where: { plataformaId: plataformaSinCuentasId } });
    expect(plantilla).toHaveLength(0);
  });

  it("no toca una plantilla ya configurada a mano", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    await backfillPlataformaPantallaDeEmpresa(cliente);

    const plantilla = await cliente.plataformaPantalla.findMany({ where: { plataformaId: plataformaYaConfiguradaId } });
    expect(plantilla).toHaveLength(1);
    expect(plantilla[0]!.perfil).toBeNull();
  });

  it("no modifica ninguna Pantalla existente", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    await backfillPlataformaPantallaDeEmpresa(cliente);

    const pantallasGrande = await cliente.pantalla.findMany({
      where: { cuentaId: cuentaGrandeId },
      orderBy: { numero: "asc" },
    });
    expect(pantallasGrande).toHaveLength(3);
    expect(pantallasGrande.map((p) => descifrar(p.pin!))).toEqual(["2222", "3333", "4444"]);

    const pantallasChica = await cliente.pantalla.findMany({ where: { cuentaId: cuentaChicaId } });
    expect(pantallasChica).toHaveLength(1);
  });

  it("corre dos veces sin fallar y sin duplicar la plantilla", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    await backfillPlataformaPantallaDeEmpresa(cliente);
    await backfillPlataformaPantallaDeEmpresa(cliente);

    const plantilla = await cliente.plataformaPantalla.findMany({ where: { plataformaId: plataformaConCuentasId } });
    expect(plantilla).toHaveLength(3);
  });

  it("reporta plataformas con/sin plantilla y las cuentas divergentes", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const reporte = await backfillPlataformaPantallaDeEmpresa(cliente);

    // 2 con plantilla (la que tenía cuentas + la ya configurada), 1 sin ella.
    expect(reporte.plataformasConPlantilla).toBe(2);
    expect(reporte.plataformasSinPlantilla).toBe(1);

    // La cuenta chica (1 pantalla) diverge de su plataforma, que quedó en 3.
    const divergenciaChica = reporte.cuentasDivergentes.find((d) => d.cuentaId === cuentaChicaId);
    expect(divergenciaChica).toBeDefined();
    expect(divergenciaChica?.pantallasCuenta).toBe(1);
    expect(divergenciaChica?.pantallasPlantilla).toBe(3);

    // La cuenta grande coincide exactamente con su plataforma: no diverge.
    expect(reporte.cuentasDivergentes.find((d) => d.cuentaId === cuentaGrandeId)).toBeUndefined();
  });
});
