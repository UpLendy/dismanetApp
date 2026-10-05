import { afterAll, beforeAll, describe, expect, it } from "bun:test";
// prismaRaw en este archivo: arma la fixture (dos empresas, cada una con su
// plataforma/cuenta/pantallas) directamente, fuera de cualquier contexto de
// empresa autenticado — mismo patrón que paquetes.test.ts.
import { prismaRaw } from "./prisma.ts";
import { tomarPantallasDisponibles } from "./bloqueo-pantallas.ts";

describe("tomarPantallasDisponibles (R2) — nunca toma una pantalla de otra empresa", () => {
  let empresaAId: string;
  let empresaBId: string;
  let plataformaAId: string;
  let plataformaBId: string;
  let pantallasAIds: string[];
  let pantallasBIds: string[];

  beforeAll(async () => {
    const empresaA = await prismaRaw.empresa.create({
      data: { nombre: "Empresa bloqueo A (bloqueo-pantallas.test)", prefijoCodigo: "BQA" },
    });
    empresaAId = empresaA.id;

    const empresaB = await prismaRaw.empresa.create({
      data: { nombre: "Empresa bloqueo B (bloqueo-pantallas.test)", prefijoCodigo: "BQB" },
    });
    empresaBId = empresaB.id;

    const plataformaA = await prismaRaw.plataforma.create({
      data: { empresaId: empresaAId, nombre: "Netflix A", capacidadPantallas: 4, usaPerfilPin: false },
    });
    plataformaAId = plataformaA.id;

    const plataformaB = await prismaRaw.plataforma.create({
      data: { empresaId: empresaBId, nombre: "Netflix B", capacidadPantallas: 4, usaPerfilPin: false },
    });
    plataformaBId = plataformaB.id;

    const cuentaA = await prismaRaw.cuenta.create({
      data: {
        empresaId: empresaAId,
        plataformaId: plataformaAId,
        correo: "cuenta-a@bloqueo-pantallas.test",
        password: "irrelevante-cifrado-a",
        capacidadPantallas: 4,
      },
    });

    const cuentaB = await prismaRaw.cuenta.create({
      data: {
        empresaId: empresaBId,
        plataformaId: plataformaBId,
        correo: "cuenta-b@bloqueo-pantallas.test",
        password: "irrelevante-cifrado-b",
        capacidadPantallas: 4,
      },
    });

    const pantallasA = await Promise.all(
      [1, 2, 3, 4].map((numero) =>
        prismaRaw.pantalla.create({
          data: { empresaId: empresaAId, cuentaId: cuentaA.id, numero },
        }),
      ),
    );
    pantallasAIds = pantallasA.map((p) => p.id);

    const pantallasB = await Promise.all(
      [1, 2, 3, 4].map((numero) =>
        prismaRaw.pantalla.create({
          data: { empresaId: empresaBId, cuentaId: cuentaB.id, numero },
        }),
      ),
    );
    pantallasBIds = pantallasB.map((p) => p.id);
  });

  afterAll(async () => {
    await prismaRaw.pantalla.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: [empresaAId, empresaBId] } } });
  });

  it("con empresaId y plataformaId de A, devuelve solo pantallas de A", async () => {
    const tomadas = await prismaRaw.$transaction((tx) => tomarPantallasDisponibles(tx, empresaAId, plataformaAId, 10));

    expect(tomadas.length).toBe(4);
    for (const pantalla of tomadas) {
      expect(pantallasAIds).toContain(pantalla.id);
      expect(pantallasBIds).not.toContain(pantalla.id);
    }
  });

  it("si el empresaId es A pero el plataformaId pertenece a B (caller corrupto aguas arriba), no devuelve nada — el filtro de empresaId no depende de que plataformaId ya venga bien filtrado", async () => {
    const tomadas = await prismaRaw.$transaction((tx) => tomarPantallasDisponibles(tx, empresaAId, plataformaBId, 10));

    expect(tomadas.length).toBe(0);
  });

  it("si el empresaId es B pero el plataformaId pertenece a A, no devuelve nada", async () => {
    const tomadas = await prismaRaw.$transaction((tx) => tomarPantallasDisponibles(tx, empresaBId, plataformaAId, 10));

    expect(tomadas.length).toBe(0);
  });

  it("transacciones concurrentes de A y B, pidiendo todo el inventario de su propia plataforma, nunca se cruzan", async () => {
    const [tomadasA, tomadasB] = await Promise.all([
      prismaRaw.$transaction((tx) => tomarPantallasDisponibles(tx, empresaAId, plataformaAId, 10)),
      prismaRaw.$transaction((tx) => tomarPantallasDisponibles(tx, empresaBId, plataformaBId, 10)),
    ]);

    expect(tomadasA.length).toBe(4);
    expect(tomadasB.length).toBe(4);

    const idsA = new Set(tomadasA.map((p) => p.id));
    const idsB = new Set(tomadasB.map((p) => p.id));
    for (const id of idsA) expect(idsB.has(id)).toBe(false);
    for (const id of idsB) expect(idsA.has(id)).toBe(false);
  });

  it("con cantidad mayor al inventario libre, devuelve como máximo lo que hay (nunca inventa filas)", async () => {
    const tomadas = await prismaRaw.$transaction((tx) => tomarPantallasDisponibles(tx, empresaAId, plataformaAId, 999));

    expect(tomadas.length).toBe(4);
  });

  it("con cantidad 0, no bloquea nada y devuelve arreglo vacío", async () => {
    const tomadas = await prismaRaw.$transaction((tx) => tomarPantallasDisponibles(tx, empresaAId, plataformaAId, 0));

    expect(tomadas).toEqual([]);
  });
});
