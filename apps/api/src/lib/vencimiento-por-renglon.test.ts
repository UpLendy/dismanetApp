import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { subDays } from "date-fns";
// prismaRaw en este archivo: arma la fixture fuera de cualquier contexto de
// empresa autenticado — mismo patrón que ventas.test.ts/pantallas.test.ts.
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { cifrar } from "./cifrado.ts";
import { realizarVenta } from "./ventas.ts";
import { pantallasDisponibles } from "./pantallas.ts";

// ---------------------------------------------------------------------------
// Entrega 9, sección 0d — consecuencia automatizada de R5: "la pantalla de
// Netflix dejaría bloqueada dos días de más si se usara
// Venta.fechaVencimientoMax" (CLAUDE.md, ejemplo "Básico 1"). Se vende un
// paquete real con una excepción de duración (Netflix 28 días, Disney+ 30
// días, ambos bajo una venta a "30 días"), y en vez de esperar 29 días
// reales se manipula hacia atrás el fechaVencimiento de cada VentaDetalle
// -29 días — simula "hoy es el día 29" sin tocar el reloj real. Si R5 se
// rompiera y alguien calculara disponibilidad con Venta.fechaVencimientoMax
// en lugar del fechaVencimiento de cada renglón, esta prueba lo detecta:
// ambas pantallas seguirían "ocupadas" porque fechaVencimientoMax (30 días)
// todavía no ha pasado.
// ---------------------------------------------------------------------------

describe("R5 (0d) — la disponibilidad se calcula por renglón, no por Venta.fechaVencimientoMax", () => {
  let empresaId: string;
  let vendedorId: string;
  let netflixId: string;
  let disneyId: string;
  let paqueteId: string;
  let duracion30Id: string;
  let tipoClienteId: string;
  let ventaId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa vencimiento-renglon (R5.test)", prefijoCodigo: "R5X" },
    });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: `vendedor-r5x-${randomUUID()}@test.local`, passwordHash: "hash", nombre: "Vendedor", rol: "VENDEDOR" },
    });
    vendedorId = vendedor.id;

    const netflix = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (R5.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    netflixId = netflix.id;
    const disney = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ (R5.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    disneyId = disney.id;

    const cuentaNetflix = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: netflixId, correo: "netflix@r5x.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaNetflix.id, numero: 1 } });

    const cuentaDisney = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: disneyId, correo: "disney@r5x.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaDisney.id, numero: 1 } });

    const duracion30 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (R5.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracion30Id = duracion30.id;
    const duracion28 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "28 días (R5.test)", cantidad: 28, unidad: "DIAS" },
    });

    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (R5.test)" } });
    tipoClienteId = tipoCliente.id;

    const paquete = await prismaRaw.paquete.create({ data: { empresaId, nombre: "Básico 1 (R5.test)" } });
    paqueteId = paquete.id;
    await prismaRaw.paquetePlataforma.create({ data: { empresaId, paqueteId, plataformaId: netflixId, cantidadPantallas: 1 } });
    await prismaRaw.paquetePlataforma.create({ data: { empresaId, paqueteId, plataformaId: disneyId, cantidadPantallas: 1 } });

    // Única excepción: Netflix resuelve a 28 días en vez de los 30 vendidos.
    // Disney+ no tiene fila aquí, así que usa la duración vendida (30 días).
    await prismaRaw.paqueteDuracionPlataforma.create({
      data: { empresaId, paqueteId, duracionVendidaId: duracion30Id, plataformaId: netflixId, duracionRealId: duracion28.id },
    });

    await prismaRaw.precio.create({
      data: { empresaId, paqueteId, duracionId: duracion30Id, tipoClienteId, precioVenta: "20000", costo: "10000" },
    });

    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "PAQUETE", contenido: "Código {{codigoCompra}} - {{paquete}}\n{{listaCuentas}}" },
    });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.paqueteDuracionPlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquetePlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.paquete.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("vende el paquete con vencimientos distintos por plataforma (28 días Netflix, 30 días Disney+)", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "PAQUETE",
        paqueteId,
        duracionId: duracion30Id,
        tipoClienteId,
      }),
    );
    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");
    ventaId = resultado.venta.id;

    const detalles = await prismaRaw.ventaDetalle.findMany({ where: { ventaId } });
    const detalleNetflix = detalles.find((d) => d.plataformaId === netflixId)!;
    const detalleDisney = detalles.find((d) => d.plataformaId === disneyId)!;
    expect(detalleNetflix.fechaVencimiento.getTime()).toBeLessThan(detalleDisney.fechaVencimiento.getTime());
  });

  it("al simular el día 29 (manipulando las fechas, sin esperar en tiempo real), Netflix queda libre y Disney+ sigue ocupado", async () => {
    const detallesOriginales = await prismaRaw.ventaDetalle.findMany({ where: { ventaId } });
    for (const detalle of detallesOriginales) {
      await prismaRaw.ventaDetalle.update({
        where: { id: detalle.id },
        data: { fechaVencimiento: subDays(detalle.fechaVencimiento, 29) },
      });
    }

    const cliente = prismaParaEmpresa(empresaId);
    const [estadosNetflix, estadosDisney] = await Promise.all([
      pantallasDisponibles(cliente, netflixId),
      pantallasDisponibles(cliente, disneyId),
    ]);

    expect(estadosNetflix).toHaveLength(1);
    expect(estadosNetflix[0].libre).toBe(true);
    expect(estadosDisney).toHaveLength(1);
    expect(estadosDisney[0].libre).toBe(false);
    expect(estadosDisney[0].ventaId).toBe(ventaId);

    // El mismo combo, visto con el campo prohibido por R5: fechaVencimientoMax
    // de la Venta sigue en el futuro (todavía no pasaron los 30 días), así
    // que si la disponibilidad se calculara con ese campo en vez del
    // fechaVencimiento de cada VentaDetalle, Netflix seguiría apareciendo
    // "ocupado" dos días de más — exactamente el inventario sin vender que
    // CLAUDE.md describe.
    const venta = await prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaId } });
    expect(venta.fechaVencimientoMax.getTime()).toBeGreaterThan(Date.now());
  });
});
