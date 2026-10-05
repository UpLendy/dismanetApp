import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
// prismaRaw en este archivo: excepción explícita — arma la fixture (empresa,
// duraciones, plataformas, paquete, cuentas y pantallas) directamente, fuera
// de cualquier contexto de empresa autenticado, igual que duraciones.test.ts.
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { costoComponentesPaquete, paquetesDisponibles, resolverComposicionDePaquete } from "./paquetes.ts";

describe("resolverComposicionDePaquete (a) — caso construido: Netflix con excepción, Disney+ sin excepción", () => {
  let empresaId: string;
  let paqueteId: string;
  let netflixId: string;
  let disneyId: string;
  let duracion14Id: string;
  let duracion28Id: string;
  let duracion30Id: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa paquetes-servicio (paquetes.test)", prefijoCodigo: "PQS" },
    });
    empresaId = empresa.id;

    const netflix = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (paquetes.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    netflixId = netflix.id;

    const disney = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ Premium (paquetes.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    disneyId = disney.id;

    const d14 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "14 días (paquetes.test)", cantidad: 14, unidad: "DIAS" },
    });
    duracion14Id = d14.id;

    const d28 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "28 días (paquetes.test)", cantidad: 28, unidad: "DIAS" },
    });
    duracion28Id = d28.id;

    const d30 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (paquetes.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracion30Id = d30.id;

    const paquete = await prismaRaw.paquete.create({
      data: { empresaId, nombre: "Básico 1 (paquetes.test)" },
    });
    paqueteId = paquete.id;

    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId, plataformaId: netflixId, cantidadPantallas: 1 },
    });
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId, plataformaId: disneyId, cantidadPantallas: 1 },
    });

    // La excepción real de DISMANET: vendido a 30 días, Netflix entrega 28.
    // Disney+ no tiene fila: hereda la duración vendida (30).
    await prismaRaw.paqueteDuracionPlataforma.create({
      data: {
        empresaId,
        paqueteId,
        duracionVendidaId: duracion30Id,
        plataformaId: netflixId,
        duracionRealId: duracion28Id,
      },
    });
  });

  afterAll(async () => {
    await prismaRaw.paqueteDuracionPlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquetePlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquete.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("a 30 días: Netflix resuelve a 28 días, Disney+ Premium resuelve a 30 días", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const composicion = await resolverComposicionDePaquete(cliente, paqueteId, duracion30Id);

    const netflix = composicion.find((c) => c.plataformaId === netflixId);
    const disney = composicion.find((c) => c.plataformaId === disneyId);

    expect(netflix).toBeDefined();
    expect(netflix?.duracionId).toBe(duracion28Id);
    expect(netflix?.cantidadDuracion).toBe(28);
    expect(netflix?.unidadDuracion).toBe("DIAS");

    expect(disney).toBeDefined();
    expect(disney?.duracionId).toBe(duracion30Id);
    expect(disney?.cantidadDuracion).toBe(30);
  });

  it("a 14 días: no hay excepción registrada, Netflix y Disney+ Premium resuelven ambos a 14 días", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const composicion = await resolverComposicionDePaquete(cliente, paqueteId, duracion14Id);

    const netflix = composicion.find((c) => c.plataformaId === netflixId);
    const disney = composicion.find((c) => c.plataformaId === disneyId);

    expect(netflix?.duracionId).toBe(duracion14Id);
    expect(netflix?.cantidadDuracion).toBe(14);
    expect(disney?.duracionId).toBe(duracion14Id);
    expect(disney?.cantidadDuracion).toBe(14);
  });
});

describe("resolverComposicionDePaquete (b) — las cinco excepciones del seed de DISMANET", () => {
  it("Básico 1, Básico 2, Básico 3, Especial 1 y Bacano vendidos a 30 días: Netflix resuelve a 28 días", async () => {
    const empresa = await prismaRaw.empresa.findFirstOrThrow({ where: { nombre: "DISMANET" } });
    const cliente = prismaParaEmpresa(empresa.id);

    const duracion30 = await prismaRaw.duracion.findFirstOrThrow({
      where: { empresaId: empresa.id, nombre: "30 días" },
    });
    const netflix = await prismaRaw.plataforma.findFirstOrThrow({
      where: { empresaId: empresa.id, nombre: "Netflix" },
    });

    const nombresConExcepcion = ["Básico 1", "Básico 2", "Básico 3", "Especial 1", "Bacano"];

    for (const nombrePaquete of nombresConExcepcion) {
      const paquete = await prismaRaw.paquete.findFirstOrThrow({
        where: { empresaId: empresa.id, nombre: nombrePaquete },
      });
      const composicion = await resolverComposicionDePaquete(cliente, paquete.id, duracion30.id);
      const componenteNetflix = composicion.find((c) => c.plataformaId === netflix.id);

      expect(componenteNetflix).toBeDefined();
      expect(componenteNetflix?.cantidadDuracion).toBe(28);
      expect(componenteNetflix?.unidadDuracion).toBe("DIAS");
    }
  });

  it("Ya 1 vendido a 30 días no tiene excepción registrada: todas sus plataformas resuelven a 30 días", async () => {
    const empresa = await prismaRaw.empresa.findFirstOrThrow({ where: { nombre: "DISMANET" } });
    const cliente = prismaParaEmpresa(empresa.id);
    const duracion30 = await prismaRaw.duracion.findFirstOrThrow({
      where: { empresaId: empresa.id, nombre: "30 días" },
    });
    const ya1 = await prismaRaw.paquete.findFirstOrThrow({ where: { empresaId: empresa.id, nombre: "Ya 1" } });

    const composicion = await resolverComposicionDePaquete(cliente, ya1.id, duracion30.id);
    expect(composicion.length).toBeGreaterThan(0);
    for (const componente of composicion) {
      expect(componente.duracionId).toBe(duracion30.id);
      expect(componente.cantidadDuracion).toBe(30);
    }
  });
});

describe("paquetesDisponibles — disponibilidad por inventario (R5)", () => {
  let empresaId: string;
  let paqueteId: string;
  let plataformaId: string;
  let cuentaId: string;
  let vendedorId: string;
  let tipoClienteId: string;
  let duracionId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa paquetes-disponibles (paquetes.test)", prefijoCodigo: "PQD" },
    });
    empresaId = empresa.id;

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (paquetes-disponibles.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (paquetes-disponibles.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Nuevo (paquetes-disponibles.test)" },
    });
    tipoClienteId = tipoCliente.id;

    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-paquetes-disponibles-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Vendedor",
        rol: "VENDEDOR",
      },
    });
    vendedorId = vendedor.id;

    const paquete = await prismaRaw.paquete.create({
      data: { empresaId, nombre: "Paquete disponibilidad (paquetes.test)" },
    });
    paqueteId = paquete.id;
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId, plataformaId, cantidadPantallas: 1 },
    });

    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "cuenta-disp@test.local", password: "cifrado", capacidadPantallas: 1 },
    });
    cuentaId = cuenta.id;
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId, numero: 1 } });

    await prismaRaw.precio.create({
      data: { empresaId, paqueteId, duracionId, tipoClienteId, precioVenta: "20000", costo: "10000" },
    });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.paquetePlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquete.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("con la única pantalla libre, el paquete aparece disponible", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const disponibles = await paquetesDisponibles(cliente, duracionId, tipoClienteId);
    expect(disponibles.map((p) => p.id)).toContain(paqueteId);
  });

  it("con la única pantalla ocupada por una venta vigente no anulada, el paquete deja de estar disponible", async () => {
    const venta = await prismaRaw.venta.create({
      data: {
        empresaId,
        vendedorId,
        codigoCompra: `PQD-${randomUUID()}`,
        tipoVenta: "PAQUETE",
        paqueteId,
        duracionId,
        tipoClienteId,
        nombreItem: "Paquete disponibilidad",
        nombreDuracion: "30 días",
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        nombreTipoCliente: "Nuevo",
        precioVenta: "20000",
        costo: "10000",
        utilidad: "10000",
        fechaVencimientoMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        mensajeGenerado: "Mensaje de prueba (paquetes.test)",
      },
    });

    const pantalla = await prismaRaw.pantalla.findFirstOrThrow({ where: { cuentaId } });
    await prismaRaw.ventaDetalle.create({
      data: {
        empresaId,
        ventaId: venta.id,
        pantallaId: pantalla.id,
        cuentaId,
        plataformaId,
        nombrePlataforma: "Netflix",
        correoCuenta: "cuenta-disp@test.local",
        passwordCuenta: "cifrado",
        duracionId,
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const cliente = prismaParaEmpresa(empresaId);
    const disponibles = await paquetesDisponibles(cliente, duracionId, tipoClienteId);
    expect(disponibles.map((p) => p.id)).not.toContain(paqueteId);
  });

  it("con inventario libre pero sin precio activo para la duración/tipo de cliente consultados, el paquete no aparece", async () => {
    // Libera la pantalla que ocupó la prueba anterior: estas dos pruebas
    // solo quieren aislar el efecto del precio, no el de R5.
    await prismaRaw.venta.updateMany({ where: { empresaId }, data: { anulada: true } });

    const otraDuracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "14 días (sin precio, paquetes.test)", cantidad: 14, unidad: "DIAS" },
    });

    const cliente = prismaParaEmpresa(empresaId);
    const disponibles = await paquetesDisponibles(cliente, otraDuracion.id, tipoClienteId);
    expect(disponibles.map((p) => p.id)).not.toContain(paqueteId);

    await prismaRaw.duracion.delete({ where: { id: otraDuracion.id } });
  });

  it("desactivar el precio del paquete lo saca de disponibles aunque el inventario siga libre", async () => {
    await prismaRaw.precio.updateMany({ where: { empresaId, paqueteId }, data: { activo: false } });

    const cliente = prismaParaEmpresa(empresaId);
    const disponibles = await paquetesDisponibles(cliente, duracionId, tipoClienteId);
    expect(disponibles.map((p) => p.id)).not.toContain(paqueteId);

    await prismaRaw.precio.updateMany({ where: { empresaId, paqueteId }, data: { activo: true } });
  });
});

describe("costoComponentesPaquete (f) — usa el costo de cada componente en SU duración real", () => {
  let empresaId: string;
  let paqueteId: string;
  let netflixId: string;
  let disneyId: string;
  let duracion28Id: string;
  let duracion30Id: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa costo-componentes (paquetes.test)", prefijoCodigo: "CSC" },
    });
    empresaId = empresa.id;

    const netflix = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (costo-componentes.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    netflixId = netflix.id;

    const disney = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ Premium (costo-componentes.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    disneyId = disney.id;

    const d28 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "28 días (costo-componentes.test)", cantidad: 28, unidad: "DIAS" },
    });
    duracion28Id = d28.id;

    const d30 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (costo-componentes.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracion30Id = d30.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Normal (costo-componentes.test)" },
    });
    tipoClienteId = tipoCliente.id;

    const paquete = await prismaRaw.paquete.create({
      data: { empresaId, nombre: "Básico 1 (costo-componentes.test)" },
    });
    paqueteId = paquete.id;

    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId, plataformaId: netflixId, cantidadPantallas: 1 },
    });
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId, plataformaId: disneyId, cantidadPantallas: 1 },
    });

    // Vendido a 30 días, Netflix entrega 28 (igual que el caso real de
    // DISMANET). Disney+ hereda los 30 días vendidos, sin excepción.
    await prismaRaw.paqueteDuracionPlataforma.create({
      data: {
        empresaId,
        paqueteId,
        duracionVendidaId: duracion30Id,
        plataformaId: netflixId,
        duracionRealId: duracion28Id,
      },
    });

    // Costos deliberadamente distintos entre 28 y 30 días para que la prueba
    // falle si costoComponentesPaquete usara la duración vendida (30) en vez
    // de la duración real resuelta (28) para Netflix.
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: netflixId, duracionId: duracion28Id, tipoClienteId, precioVenta: "15000", costo: "10000" },
    });
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: netflixId, duracionId: duracion30Id, tipoClienteId, precioVenta: "16000", costo: "99999" },
    });
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: disneyId, duracionId: duracion30Id, tipoClienteId, precioVenta: "12000", costo: "5000" },
    });
  });

  afterAll(async () => {
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.paqueteDuracionPlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquetePlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquete.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("Básico 1 vendido a 30 días suma el costo de Netflix a 28 días (10000), no a 30 días (99999)", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const { suma, faltantes } = await costoComponentesPaquete(cliente, paqueteId, duracion30Id, tipoClienteId);

    expect(faltantes).toEqual([]);
    expect(suma).not.toBeNull();
    // 10000 (Netflix a 28 días) + 5000 (Disney+ a 30 días) = 15000.
    expect(suma?.toString()).toBe("15000");
  });

  it("si falta el precio activo de un componente, suma es null y faltantes nombra la plataforma", async () => {
    await prismaRaw.precio.updateMany({
      where: { empresaId, plataformaId: disneyId, duracionId: duracion30Id },
      data: { activo: false },
    });

    const cliente = prismaParaEmpresa(empresaId);
    const { suma, faltantes } = await costoComponentesPaquete(cliente, paqueteId, duracion30Id, tipoClienteId);

    expect(suma).toBeNull();
    expect(faltantes).toContain("Disney+ Premium (costo-componentes.test)");

    await prismaRaw.precio.updateMany({
      where: { empresaId, plataformaId: disneyId, duracionId: duracion30Id },
      data: { activo: true },
    });
  });
});
