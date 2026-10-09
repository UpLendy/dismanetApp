import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { prismaRaw } from "./prisma.ts";
import {
  prismaParaEmpresa,
  MODELOS_CON_EMPRESA_ID,
  METODOS_CON_WHERE,
  METODOS_CON_DATA_MUCHOS,
  OPERACIONES_DE_UN_SOLO_REGISTRO,
  OPERACIONES_BLOQUEADAS,
  PROPIEDADES_NO_OPERACION,
} from "./prisma-empresa.ts";

// prismaRaw en este archivo: excepción explícita, igual que seed y login.
// Verificar el aislamiento (R1) exige poder crear y leer filas de AMBAS
// empresas a la vez para armar la fixture y confirmar que prismaParaEmpresa
// nunca deja escapar una fila ajena; un cliente ya restringido a una empresa
// no podría montar ese escenario.

interface FixtureEmpresa {
  empresaId: string;
  usuarioId: string;
  plataformaId: string;
  plataformaPantallaId: string;
  duracionId: string;
  duracionRealId: string;
  tipoClienteId: string;
  paqueteId: string;
  paquetePlataformaId: string;
  paqueteDuracionPlataformaId: string;
  precioId: string;
  cuentaId: string;
  pantallaId: string;
  ventaId: string;
  ventaDetalleId: string;
  plantillaMensajeId: string;
  movimientoSaldoId: string;
  garantiaId: string;
}

// Nombre de la propiedad del cliente de Prisma para un modelo del esquema:
// "PaquetePlataforma" -> "paquetePlataforma" (convención estándar de Prisma).
function propiedadCliente(modelo: string): string {
  return modelo.charAt(0).toLowerCase() + modelo.slice(1);
}

// Clave del id correspondiente dentro de FixtureEmpresa, siguiendo la misma
// convención: "PaquetePlataforma" -> "paquetePlataformaId".
function claveId(modelo: string): keyof FixtureEmpresa {
  return `${propiedadCliente(modelo)}Id` as keyof FixtureEmpresa;
}

async function crearEmpresaCompleta(nombre: string, prefijo: string): Promise<FixtureEmpresa> {
  const empresa = await prismaRaw.empresa.create({
    data: { nombre, prefijoCodigo: prefijo },
  });

  const usuario = await prismaRaw.usuario.create({
    data: {
      empresaId: empresa.id,
      email: `vendedor-${randomUUID()}@test.local`,
      passwordHash: "hash-de-prueba",
      nombre: `Vendedor ${nombre}`,
      rol: "VENDEDOR",
    },
  });

  const plataforma = await prismaRaw.plataforma.create({
    data: { empresaId: empresa.id, nombre: `Plataforma ${nombre}`, capacidadPantallas: 4 },
  });

  const plataformaPantalla = await prismaRaw.plataformaPantalla.create({
    data: { empresaId: empresa.id, plataformaId: plataforma.id, numero: 1, perfil: "A", pin: "cifrado-de-prueba" },
  });

  const duracionVendida = await prismaRaw.duracion.create({
    data: { empresaId: empresa.id, nombre: "30 días", cantidad: 30, unidad: "DIAS" },
  });

  const duracionReal = await prismaRaw.duracion.create({
    data: { empresaId: empresa.id, nombre: "28 días", cantidad: 28, unidad: "DIAS" },
  });

  const tipoCliente = await prismaRaw.tipoCliente.create({
    data: { empresaId: empresa.id, nombre: `Tipo cliente ${nombre}` },
  });

  const paquete = await prismaRaw.paquete.create({
    data: { empresaId: empresa.id, nombre: `Paquete ${nombre}` },
  });

  const paquetePlataforma = await prismaRaw.paquetePlataforma.create({
    data: { empresaId: empresa.id, paqueteId: paquete.id, plataformaId: plataforma.id, cantidadPantallas: 1 },
  });

  const paqueteDuracionPlataforma = await prismaRaw.paqueteDuracionPlataforma.create({
    data: {
      empresaId: empresa.id,
      paqueteId: paquete.id,
      duracionVendidaId: duracionVendida.id,
      plataformaId: plataforma.id,
      duracionRealId: duracionReal.id,
    },
  });

  const precio = await prismaRaw.precio.create({
    data: {
      empresaId: empresa.id,
      plataformaId: plataforma.id,
      duracionId: duracionVendida.id,
      tipoClienteId: tipoCliente.id,
      precioVenta: "10000",
      costo: "5000",
    },
  });

  const cuenta = await prismaRaw.cuenta.create({
    data: {
      empresaId: empresa.id,
      plataformaId: plataforma.id,
      correo: `cuenta-${randomUUID()}@test.local`,
      password: "cifrado-de-prueba",
      capacidadPantallas: 4,
    },
  });

  const pantalla = await prismaRaw.pantalla.create({
    data: { empresaId: empresa.id, cuentaId: cuenta.id, numero: 1 },
  });

  const venta = await prismaRaw.venta.create({
    data: {
      empresaId: empresa.id,
      vendedorId: usuario.id,
      codigoCompra: `${prefijo}-${randomUUID().slice(0, 8)}`,
      tipoVenta: "UNIDAD",
      plataformaId: plataforma.id,
      duracionId: duracionVendida.id,
      tipoClienteId: tipoCliente.id,
      nombreItem: plataforma.nombre,
      nombreDuracion: duracionVendida.nombre,
      cantidadDuracion: 30,
      unidadDuracion: "DIAS",
      nombreTipoCliente: tipoCliente.nombre,
      precioVenta: "10000",
      costo: "5000",
      utilidad: "5000",
      fechaVencimientoMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      mensajeGenerado: "Mensaje de prueba",
    },
  });

  const ventaDetalle = await prismaRaw.ventaDetalle.create({
    data: {
      empresaId: empresa.id,
      ventaId: venta.id,
      pantallaId: pantalla.id,
      cuentaId: cuenta.id,
      plataformaId: plataforma.id,
      nombrePlataforma: plataforma.nombre,
      correoCuenta: cuenta.correo,
      passwordCuenta: cuenta.password,
      duracionId: duracionVendida.id,
      cantidadDuracion: 30,
      unidadDuracion: "DIAS",
      fechaVencimiento: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
    },
  });

  // Segundo VentaDetalle, solo para servir de "reemplazo" de la Garantia de
  // prueba — Garantia exige dos VentaDetalle distintos (original/reemplazo),
  // cada uno con restricción única propia.
  const ventaDetalleReemplazo = await prismaRaw.ventaDetalle.create({
    data: {
      empresaId: empresa.id,
      ventaId: venta.id,
      pantallaId: pantalla.id,
      cuentaId: cuenta.id,
      plataformaId: plataforma.id,
      nombrePlataforma: plataforma.nombre,
      correoCuenta: cuenta.correo,
      passwordCuenta: cuenta.password,
      duracionId: duracionVendida.id,
      cantidadDuracion: 30,
      unidadDuracion: "DIAS",
      fechaVencimiento: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
    },
  });

  const garantia = await prismaRaw.garantia.create({
    data: {
      empresaId: empresa.id,
      ventaDetalleOriginalId: ventaDetalle.id,
      ventaDetalleReemplazoId: ventaDetalleReemplazo.id,
      costoAsumido: "0",
      mensajeGenerado: "Mensaje de garantía de prueba",
      creadoPorId: usuario.id,
    },
  });

  const plantillaMensaje = await prismaRaw.plantillaMensaje.create({
    data: { empresaId: empresa.id, tipo: "UNIDAD", contenido: "Plantilla de prueba" },
  });

  const movimientoSaldo = await prismaRaw.movimientoSaldo.create({
    data: {
      empresaId: empresa.id,
      usuarioId: usuario.id,
      tipo: "CONSUMO",
      monto: "-10000",
      saldoResultante: "0",
      ventaId: venta.id,
      creadoPorId: usuario.id,
    },
  });

  return {
    empresaId: empresa.id,
    usuarioId: usuario.id,
    plataformaId: plataforma.id,
    plataformaPantallaId: plataformaPantalla.id,
    duracionId: duracionVendida.id,
    duracionRealId: duracionReal.id,
    tipoClienteId: tipoCliente.id,
    paqueteId: paquete.id,
    paquetePlataformaId: paquetePlataforma.id,
    paqueteDuracionPlataformaId: paqueteDuracionPlataforma.id,
    precioId: precio.id,
    cuentaId: cuenta.id,
    pantallaId: pantalla.id,
    ventaId: venta.id,
    ventaDetalleId: ventaDetalle.id,
    plantillaMensajeId: plantillaMensaje.id,
    movimientoSaldoId: movimientoSaldo.id,
    garantiaId: garantia.id,
  };
}

async function borrarEmpresaCompleta(empresaId: string) {
  // Orden que respeta las FK (hijos antes que padres); ver comentario en R1
  // del CLAUDE.md — nada se borra en producción, pero aquí es fixture propia.
  // MovimientoSaldo primero: referencia a Usuario con RESTRICT (no SET NULL
  // como su referencia a Venta), así que debe irse antes que el usuario.
  await prismaRaw.movimientoSaldo.deleteMany({ where: { empresaId } });
  await prismaRaw.garantia.deleteMany({ where: { empresaId } });
  await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
  await prismaRaw.venta.deleteMany({ where: { empresaId } });
  await prismaRaw.precio.deleteMany({ where: { empresaId } });
  await prismaRaw.paqueteDuracionPlataforma.deleteMany({ where: { empresaId } });
  await prismaRaw.paquetePlataforma.deleteMany({ where: { empresaId } });
  await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
  await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
  await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
  await prismaRaw.paquete.deleteMany({ where: { empresaId } });
  await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
  await prismaRaw.duracion.deleteMany({ where: { empresaId } });
  await prismaRaw.plataformaPantalla.deleteMany({ where: { empresaId } });
  await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
  await prismaRaw.usuario.deleteMany({ where: { empresaId } });
  await prismaRaw.empresa.delete({ where: { id: empresaId } });
}

describe("R1 — aislamiento entre empresas (prismaParaEmpresa)", () => {
  let fixtureA: FixtureEmpresa;
  let fixtureB: FixtureEmpresa;

  beforeAll(async () => {
    fixtureA = await crearEmpresaCompleta("Empresa de prueba A", "AAA");
    fixtureB = await crearEmpresaCompleta("Empresa de prueba B", "BBB");
  });

  afterAll(async () => {
    await borrarEmpresaCompleta(fixtureA.empresaId);
    await borrarEmpresaCompleta(fixtureB.empresaId);
  });

  it("cubre los 16 modelos con empresaId derivados del esquema", () => {
    expect(MODELOS_CON_EMPRESA_ID.size).toBe(16);
    expect([...MODELOS_CON_EMPRESA_ID].sort()).toEqual(
      [
        "Usuario",
        "Plataforma",
        "PlataformaPantalla",
        "Duracion",
        "TipoCliente",
        "Paquete",
        "PaquetePlataforma",
        "PaqueteDuracionPlataforma",
        "Precio",
        "Cuenta",
        "Pantalla",
        "Venta",
        "VentaDetalle",
        "PlantillaMensaje",
        "MovimientoSaldo",
        "Garantia",
      ].sort(),
    );
  });

  it("la fixture de prueba tiene un id para cada modelo con empresaId (ningún modelo se omite)", () => {
    for (const modelo of MODELOS_CON_EMPRESA_ID) {
      const clave = claveId(modelo);
      expect(typeof fixtureA[clave]).toBe("string");
      expect(typeof fixtureB[clave]).toBe("string");
    }
  });

  it("lanza si se invoca con empresaId nulo o indefinido", () => {
    expect(() => prismaParaEmpresa(null)).toThrow();
    expect(() => prismaParaEmpresa(undefined)).toThrow();
  });

  for (const modelo of MODELOS_CON_EMPRESA_ID) {
    const propiedad = propiedadCliente(modelo);

    it(`${modelo}: findMany bajo el cliente de empresa A solo devuelve filas de A`, async () => {
      const clienteA = prismaParaEmpresa(fixtureA.empresaId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filas = await (clienteA as any)[propiedad].findMany();

      expect(filas.length).toBeGreaterThan(0);
      for (const fila of filas) {
        expect(fila.empresaId).toBe(fixtureA.empresaId);
      }
    });

    it(`${modelo}: findUnique por el id de la fila de empresa B, bajo el cliente de empresa A, no la encuentra`, async () => {
      const clienteA = prismaParaEmpresa(fixtureA.empresaId);
      const idDeB = fixtureB[claveId(modelo)];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultado = await (clienteA as any)[propiedad].findUnique({ where: { id: idDeB } });

      expect(resultado).toBeNull();
    });
  }

  it("update sobre una fila de empresa B, bajo el cliente de empresa A, falla (no la modifica)", async () => {
    const clienteA = prismaParaEmpresa(fixtureA.empresaId);

    let lanzo = false;
    try {
      await clienteA.plataforma.update({
        where: { id: fixtureB.plataformaId },
        data: { nombre: "Intento de escritura entre empresas" },
      });
    } catch {
      lanzo = true;
    }
    expect(lanzo).toBe(true);

    const plataformaB = await prismaRaw.plataforma.findUniqueOrThrow({ where: { id: fixtureB.plataformaId } });
    expect(plataformaB.nombre).not.toBe("Intento de escritura entre empresas");
  });

  it("create bajo el cliente de empresa A inyecta empresaId, incluso si el caller intenta fijar otro", async () => {
    const clienteA = prismaParaEmpresa(fixtureA.empresaId);

    const tipoCliente = await clienteA.tipoCliente.create({
      data: { nombre: "Tipo inyectado", empresaId: fixtureB.empresaId } as never,
    });

    expect(tipoCliente.empresaId).toBe(fixtureA.empresaId);

    await prismaRaw.tipoCliente.delete({ where: { id: tipoCliente.id } });
  });

  // Requisito (d): el producto completo modelo × operación, derivando AMBAS
  // listas del cliente real de Prisma (no de un arreglo escrito a mano). Si
  // una futura versión de Prisma agrega una operación nueva a un delegado,
  // esta prueba falla hasta que alguien decida explícitamente si se envuelve
  // o se bloquea — no puede quedar sin clasificar en silencio.
  it("toda operación real de cada delegado con empresaId está clasificada: envuelta (where o data) o bloqueada", () => {
    const clasificadas = new Set<string>([
      ...METODOS_CON_WHERE,
      ...METODOS_CON_DATA_MUCHOS,
      ...OPERACIONES_DE_UN_SOLO_REGISTRO,
      ...OPERACIONES_BLOQUEADAS,
    ]);

    for (const modelo of MODELOS_CON_EMPRESA_ID) {
      const propiedad = propiedadCliente(modelo);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegado = (prismaRaw as any)[propiedad];
      const operacionesReales = Object.keys(delegado).filter(
        (clave) => typeof delegado[clave] === "function" && !PROPIEDADES_NO_OPERACION.has(clave),
      );

      // Si esto falla, el delegado no expone ninguna operación reconocible:
      // probablemente propiedadCliente() no coincide con el nombre real.
      expect(operacionesReales.length).toBeGreaterThan(0);

      for (const operacion of operacionesReales) {
        expect(clasificadas.has(operacion)).toBe(true);
      }
    }
  });

  // Requisito (b): upsert no se envuelve con un filtro — se bloquea. Un
  // filtro de upsert sería incorrecto en general porque su `where` exige un
  // selector único que no siempre admite empresaId.
  it("upsert sobre un modelo con empresaId lanza un error explícito y no ejecuta nada", async () => {
    const clienteA = prismaParaEmpresa(fixtureA.empresaId);

    let error: unknown;
    try {
      await clienteA.tipoCliente.upsert({
        where: { id: fixtureA.tipoClienteId },
        create: { nombre: "no debería crearse por upsert" },
        update: { nombre: "no debería actualizarse por upsert" },
      } as never);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("upsert");

    const sinCambios = await prismaRaw.tipoCliente.findUniqueOrThrow({ where: { id: fixtureA.tipoClienteId } });
    expect(sinCambios.nombre).not.toBe("no debería actualizarse por upsert");
  });

  // Requisito (c): aggregate y groupBy alimentan los totales del admin
  // (entrega 9). Sin filtrar, DISMANET vería sumado el dinero de otras
  // empresas. fixtureA y fixtureB tienen cada una una venta con utilidad
  // 5000; si el filtro se rompiera, el agregado vería 10000.
  it("aggregate bajo el cliente de empresa A no suma la utilidad de ventas de empresa B", async () => {
    const clienteA = prismaParaEmpresa(fixtureA.empresaId);

    const resultado = await clienteA.venta.aggregate({ _sum: { utilidad: true } });

    expect(resultado._sum.utilidad?.toString()).toBe("5000");
  });

  it("groupBy bajo el cliente de empresa A solo agrupa filas de empresa A, no mezcla la utilidad de empresa B", async () => {
    const clienteA = prismaParaEmpresa(fixtureA.empresaId);

    const resultado = await clienteA.venta.groupBy({
      by: ["empresaId"],
      _sum: { utilidad: true },
    });

    expect(resultado.length).toBe(1);
    expect(resultado[0].empresaId).toBe(fixtureA.empresaId);
    expect(resultado[0]._sum.utilidad?.toString()).toBe("5000");
  });
});

// ---------------------------------------------------------------------------
// R1 dentro de una transacción interactiva.
//
// prismaParaEmpresa(empresaId).$transaction(cb) debe entregarle a `cb` un
// `tx` TAMBIÉN envuelto con el mismo empresaId — nunca el tx crudo de
// Prisma. Sin esto, la venta (entrega 8), que vive entera dentro de una
// transacción, perdería el aislamiento exactamente donde más importa: la
// prueba de cobertura por operación de arriba nunca lo detecta porque
// ejercita las operaciones FUERA de cualquier transacción.
// ---------------------------------------------------------------------------
describe("R1 — aislamiento entre empresas dentro de $transaction", () => {
  let fixtureA: FixtureEmpresa;
  let fixtureB: FixtureEmpresa;

  beforeAll(async () => {
    fixtureA = await crearEmpresaCompleta("Empresa de prueba A (tx)", "ATX");
    fixtureB = await crearEmpresaCompleta("Empresa de prueba B (tx)", "BTX");
  });

  afterAll(async () => {
    await borrarEmpresaCompleta(fixtureA.empresaId);
    await borrarEmpresaCompleta(fixtureB.empresaId);
  });

  for (const modelo of MODELOS_CON_EMPRESA_ID) {
    const propiedad = propiedadCliente(modelo);

    it(`${modelo}: dentro de $transaction, findMany bajo el cliente de empresa A solo devuelve filas de A`, async () => {
      const clienteA = prismaParaEmpresa(fixtureA.empresaId);

      const filas = await clienteA.$transaction(async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (tx as any)[propiedad].findMany();
      });

      expect(filas.length).toBeGreaterThan(0);
      for (const fila of filas) {
        expect(fila.empresaId).toBe(fixtureA.empresaId);
      }
    });

    it(`${modelo}: dentro de $transaction, findUnique por el id de la fila de empresa B, bajo el cliente de empresa A, no la encuentra`, async () => {
      const clienteA = prismaParaEmpresa(fixtureA.empresaId);
      const idDeB = fixtureB[claveId(modelo)];

      const resultado = await clienteA.$transaction(async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (tx as any)[propiedad].findUnique({ where: { id: idDeB } });
      });

      expect(resultado).toBeNull();
    });
  }

  it("dentro de $transaction, update sobre una fila de empresa B, bajo el cliente de empresa A, falla (no la modifica)", async () => {
    const clienteA = prismaParaEmpresa(fixtureA.empresaId);

    let lanzo = false;
    try {
      await clienteA.$transaction(async (tx) => {
        await tx.plataforma.update({
          where: { id: fixtureB.plataformaId },
          data: { nombre: "Intento de escritura entre empresas (tx)" },
        });
      });
    } catch {
      lanzo = true;
    }
    expect(lanzo).toBe(true);

    const plataformaB = await prismaRaw.plataforma.findUniqueOrThrow({ where: { id: fixtureB.plataformaId } });
    expect(plataformaB.nombre).not.toBe("Intento de escritura entre empresas (tx)");
  });

  it("dentro de $transaction, create bajo el cliente de empresa A inyecta empresaId, incluso si el caller intenta fijar otro", async () => {
    const clienteA = prismaParaEmpresa(fixtureA.empresaId);

    const tipoCliente = await clienteA.$transaction(async (tx) => {
      return tx.tipoCliente.create({
        data: { nombre: "Tipo inyectado (tx)", empresaId: fixtureB.empresaId } as never,
      });
    });

    expect(tipoCliente.empresaId).toBe(fixtureA.empresaId);

    await prismaRaw.tipoCliente.delete({ where: { id: tipoCliente.id } });
  });

  it("dentro de $transaction, upsert sobre un modelo con empresaId lanza un error explícito y no ejecuta nada", async () => {
    const clienteA = prismaParaEmpresa(fixtureA.empresaId);

    let error: unknown;
    try {
      await clienteA.$transaction(async (tx) => {
        await tx.tipoCliente.upsert({
          where: { id: fixtureA.tipoClienteId },
          create: { nombre: "no debería crearse por upsert (tx)" },
          update: { nombre: "no debería actualizarse por upsert (tx)" },
        } as never);
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("upsert");

    const sinCambios = await prismaRaw.tipoCliente.findUniqueOrThrow({ where: { id: fixtureA.tipoClienteId } });
    expect(sinCambios.nombre).not.toBe("no debería actualizarse por upsert (tx)");
  });

  it("dentro de $transaction, aggregate bajo el cliente de empresa A no suma la utilidad de ventas de empresa B", async () => {
    const clienteA = prismaParaEmpresa(fixtureA.empresaId);

    const resultado = await clienteA.$transaction(async (tx) => {
      return tx.venta.aggregate({ _sum: { utilidad: true } });
    });

    expect(resultado._sum.utilidad?.toString()).toBe("5000");
  });

  it("dentro de $transaction, groupBy bajo el cliente de empresa A solo agrupa filas de empresa A", async () => {
    const clienteA = prismaParaEmpresa(fixtureA.empresaId);

    const resultado = await clienteA.$transaction(async (tx) => {
      return tx.venta.groupBy({ by: ["empresaId"], _sum: { utilidad: true } });
    });

    expect(resultado.length).toBe(1);
    expect(resultado[0].empresaId).toBe(fixtureA.empresaId);
  });

  it("si el callback de $transaction lanza, nada de lo escrito dentro queda (rollback real sobre el tx envuelto)", async () => {
    const clienteA = prismaParaEmpresa(fixtureA.empresaId);
    const nombreMarca = "No debería persistir (rollback tx)";

    let lanzo = false;
    try {
      await clienteA.$transaction(async (tx) => {
        await tx.tipoCliente.create({ data: { nombre: nombreMarca } as never });
        throw new Error("fuerza rollback");
      });
    } catch {
      lanzo = true;
    }
    expect(lanzo).toBe(true);

    const encontrado = await prismaRaw.tipoCliente.findFirst({ where: { nombre: nombreMarca } });
    expect(encontrado).toBeNull();
  });
});
