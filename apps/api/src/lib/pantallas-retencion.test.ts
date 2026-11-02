import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { addDays, subDays } from "date-fns";
// prismaRaw en este archivo: arma la fixture fuera de cualquier contexto de
// empresa autenticado — mismo patrón que vencimiento-por-renglon.test.ts.
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { cifrar } from "./cifrado.ts";
import { pantallasDeCuenta, pantallasDisponibles, contarPantallasPorEstado } from "./pantallas.ts";
import { tomarPantallasDisponibles } from "./bloqueo-pantallas.ts";

// ---------------------------------------------------------------------------
// F4.11, Parte 5 — los 8 escenarios de concordancia de R5. La regla
// "retenida ⟺ existe un VentaDetalle con venta no anulada y
// fechaVencimiento > COALESCE(liberadaEn, -infinity)" vive en tres sitios
// (CLAUDE.md R5): estadoDePantallas (pantallas.ts, vía pantallasDisponibles/
// pantallasDeCuenta), tomarPantallasDisponibles (bloqueo-pantallas.ts, SQL
// crudo) y contarPantallasPorEstado (que delega en el primero). Esta prueba
// no verifica cada sitio por separado: arma los 8 estados en una sola
// empresa y verifica que los tres sitios concuerden sobre el mismo conjunto
// de pantallas al mismo tiempo — que es justo donde una reescritura parcial
// de la regla (cambiar un sitio y olvidar otro) se delataría.
// ---------------------------------------------------------------------------

describe("R5 — concordancia entre los tres sitios que calculan disponibilidad", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaId: string;
  let duracionId: string;

  const ids: Record<string, string> = {};

  async function crearCuentaConPantalla(sufijo: string): Promise<{ cuentaId: string; pantallaId: string }> {
    const cuenta = await prismaRaw.cuenta.create({
      data: {
        empresaId,
        plataformaId,
        correo: `${sufijo}@concordancia.test`,
        password: cifrar("clave-original"),
        capacidadPantallas: 1,
      },
    });
    const pantalla = await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 1 } });
    return { cuentaId: cuenta.id, pantallaId: pantalla.id };
  }

  async function crearVentaDetalle(opts: {
    cuentaId: string;
    pantallaId: string;
    fechaVencimiento: Date;
    anulada?: boolean;
    codigoCompra: string;
  }): Promise<void> {
    const venta = await prismaRaw.venta.create({
      data: {
        empresaId,
        vendedorId,
        codigoCompra: opts.codigoCompra,
        tipoVenta: "UNIDAD",
        plataformaId,
        duracionId,
        nombreItem: "Netflix (concordancia.test)",
        nombreDuracion: "30 días",
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        nombreTipoCliente: "Nuevo",
        precioSugerido: "20000",
        precioVenta: "20000",
        costo: "10000",
        utilidad: "10000",
        fechaVencimientoMax: opts.fechaVencimiento,
        mensajeGenerado: "mensaje de prueba (concordancia.test)",
        anulada: opts.anulada ?? false,
      },
    });
    await prismaRaw.ventaDetalle.create({
      data: {
        empresaId,
        ventaId: venta.id,
        pantallaId: opts.pantallaId,
        cuentaId: opts.cuentaId,
        plataformaId,
        nombrePlataforma: "Netflix (concordancia.test)",
        passwordCuenta: "irrelevante-cifrado",
        duracionId,
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        fechaVencimiento: opts.fechaVencimiento,
      },
    });
  }

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa concordancia R5 (pantallas-retencion.test)", prefijoCodigo: "R5C" },
    });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: `vendedor-r5c-${randomUUID()}@test.local`, passwordHash: "hash", nombre: "Empleado", rol: "EMPLEADO" },
    });
    vendedorId = vendedor.id;

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (concordancia.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (concordancia.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const ahora = new Date();

    // 1. Nunca vendida ⇒ LIBRE.
    const p1 = await crearCuentaConPantalla("p1-nunca-vendida");
    ids.pantalla1 = p1.pantallaId;

    // 2. Venta vigente ⇒ OCUPADA.
    const p2 = await crearCuentaConPantalla("p2-venta-vigente");
    ids.pantalla2 = p2.pantallaId;
    await crearVentaDetalle({ ...p2, fechaVencimiento: addDays(ahora, 30), codigoCompra: "R5C-002" });

    // 3. Vencida, liberadaEn = null ⇒ POR_REINICIAR.
    const p3 = await crearCuentaConPantalla("p3-vencida-sin-liberar");
    ids.pantalla3 = p3.pantallaId;
    await crearVentaDetalle({ ...p3, fechaVencimiento: subDays(ahora, 1), codigoCompra: "R5C-003" });

    // 4. Vencida, liberadaEn posterior al vencimiento ⇒ LIBRE (reinicio real).
    const p4 = await crearCuentaConPantalla("p4-vencida-liberada-despues");
    ids.pantalla4 = p4.pantallaId;
    await crearVentaDetalle({ ...p4, fechaVencimiento: subDays(ahora, 5), codigoCompra: "R5C-004" });
    await prismaRaw.pantalla.update({ where: { id: p4.pantallaId }, data: { liberadaEn: subDays(ahora, 1) } });

    // 5. Vencida, liberadaEn anterior al vencimiento ⇒ POR_REINICIAR
    //    (se revendió después de un reinicio y volvió a vencer, sin un
    //    segundo reinicio desde entonces).
    const p5 = await crearCuentaConPantalla("p5-revendida-y-vencida-otra-vez");
    ids.pantalla5 = p5.pantallaId;
    await prismaRaw.pantalla.update({ where: { id: p5.pantallaId }, data: { liberadaEn: subDays(ahora, 10) } });
    await crearVentaDetalle({ ...p5, fechaVencimiento: subDays(ahora, 5), codigoCompra: "R5C-005" });

    // 6. Sobreventa: dos ventas vigentes a la vez ⇒ OCUPADA, con ambos códigos.
    const p6 = await crearCuentaConPantalla("p6-sobreventa");
    ids.pantalla6 = p6.pantallaId;
    await crearVentaDetalle({ ...p6, fechaVencimiento: addDays(ahora, 10), codigoCompra: "R5C-006A" });
    await crearVentaDetalle({ ...p6, fechaVencimiento: addDays(ahora, 20), codigoCompra: "R5C-006B" });

    // 7. Venta anulada y vencida ⇒ LIBRE (la anulación gana, sin importar
    //    que haya pasado la fecha).
    const p7 = await crearCuentaConPantalla("p7-anulada-y-vencida");
    ids.pantalla7 = p7.pantallaId;
    await crearVentaDetalle({ ...p7, fechaVencimiento: subDays(ahora, 1), anulada: true, codigoCompra: "R5C-007" });

    // 8. Mixta: misma cuenta con una pantalla vigente (OCUPADA) y otra
    //    vencida sin liberar (POR_REINICIAR).
    const cuenta8 = await prismaRaw.cuenta.create({
      data: {
        empresaId,
        plataformaId,
        correo: "p8-mixta@concordancia.test",
        password: cifrar("clave-original"),
        capacidadPantallas: 2,
      },
    });
    ids.cuenta8 = cuenta8.id;
    const pantalla8a = await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta8.id, numero: 1 } });
    const pantalla8b = await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta8.id, numero: 2 } });
    ids.pantalla8a = pantalla8a.id;
    ids.pantalla8b = pantalla8b.id;
    await crearVentaDetalle({
      cuentaId: cuenta8.id,
      pantallaId: pantalla8a.id,
      fechaVencimiento: addDays(ahora, 15),
      codigoCompra: "R5C-008A",
    });
    await crearVentaDetalle({
      cuentaId: cuenta8.id,
      pantallaId: pantalla8b.id,
      fechaVencimiento: subDays(ahora, 1),
      codigoCompra: "R5C-008B",
    });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("sitio 1 (pantallas.ts / estadoDePantallas): cada pantalla cae en el estado esperado", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const estados = await pantallasDisponibles(cliente, plataformaId);
    const porId = new Map(estados.map((e) => [e.id, e]));

    expect(porId.get(ids.pantalla1)?.estado).toBe("LIBRE");
    expect(porId.get(ids.pantalla2)?.estado).toBe("OCUPADA");
    expect(porId.get(ids.pantalla3)?.estado).toBe("POR_REINICIAR");
    expect(porId.get(ids.pantalla4)?.estado).toBe("LIBRE");
    expect(porId.get(ids.pantalla5)?.estado).toBe("POR_REINICIAR");
    expect(porId.get(ids.pantalla6)?.estado).toBe("OCUPADA");
    expect(porId.get(ids.pantalla6)?.codigosCompraAfectados.sort()).toEqual(["R5C-006A", "R5C-006B"]);
    expect(porId.get(ids.pantalla7)?.estado).toBe("LIBRE");
    expect(porId.get(ids.pantalla8a)?.estado).toBe("OCUPADA");
    expect(porId.get(ids.pantalla8b)?.estado).toBe("POR_REINICIAR");

    // Escenario 8 visto por cuenta (pantallasDeCuenta): la misma cuenta
    // reporta una pantalla ocupada y otra por reiniciar, sin mezclarse.
    const porCuenta8 = await pantallasDeCuenta(cliente, ids.cuenta8);
    const estado8a = porCuenta8.find((p) => p.id === ids.pantalla8a);
    const estado8b = porCuenta8.find((p) => p.id === ids.pantalla8b);
    expect(estado8a?.estado).toBe("OCUPADA");
    expect(estado8b?.estado).toBe("POR_REINICIAR");
  });

  it("sitio 2 (bloqueo-pantallas.ts / tomarPantallasDisponibles, SQL crudo): solo toma las LIBRE", async () => {
    const tomadas = await prismaRaw.$transaction((tx) => tomarPantallasDisponibles(tx, empresaId, plataformaId, 99));
    const idsTomadas = new Set(tomadas.map((p) => p.id));

    // Libres (1, 4, 7): deben poder tomarse.
    expect(idsTomadas.has(ids.pantalla1)).toBe(true);
    expect(idsTomadas.has(ids.pantalla4)).toBe(true);
    expect(idsTomadas.has(ids.pantalla7)).toBe(true);

    // Retenidas, ocupadas o por reiniciar (2, 3, 5, 6, 8a, 8b): ninguna
    // debe poder tomarse — el mismo WHERE que decide OCUPADA/POR_REINICIAR
    // en estadoDePantallas decide aquí si la pantalla es tomable.
    expect(idsTomadas.has(ids.pantalla2)).toBe(false);
    expect(idsTomadas.has(ids.pantalla3)).toBe(false);
    expect(idsTomadas.has(ids.pantalla5)).toBe(false);
    expect(idsTomadas.has(ids.pantalla6)).toBe(false);
    expect(idsTomadas.has(ids.pantalla8a)).toBe(false);
    expect(idsTomadas.has(ids.pantalla8b)).toBe(false);

    expect(tomadas.length).toBe(3);
  });

  it("sitio 3 (diagnostico-empresa.ts, vía contarPantallasPorEstado): el conteo agregado coincide con el detalle", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const conteo = await contarPantallasPorEstado(cliente);

    // Libres: 1, 4, 7. Ocupadas: 2, 6, 8a. Por reiniciar: 3, 5, 8b.
    expect(conteo.libres).toBe(3);
    expect(conteo.ocupadas).toBe(3);
    expect(conteo.porReiniciar).toBe(3);
  });
});
