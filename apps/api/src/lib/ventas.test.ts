import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
// prismaRaw en este archivo: arma la fixture (empresa, plataformas, cuentas,
// pantallas, duraciones, tipos de cliente, precios, plantillas) directamente,
// fuera de cualquier contexto de empresa autenticado — mismo patrón que
// paquetes.test.ts/bloqueo-pantallas.test.ts.
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { cifrar } from "./cifrado.ts";
import { realizarVenta } from "./ventas.ts";
import { calcularEstadisticas } from "./estadisticas-ventas.ts";

describe("realizarVenta", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaNetflixId: string;
  let plataformaDisneyId: string;
  let plataformaHboId: string;
  let cuentaNetflixId: string;
  let cuentaDisneyId: string;
  let cuentaHboId: string;
  let duracion30Id: string;
  let tipoClienteId: string;
  let paqueteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa ventas (ventas.test)", prefijoCodigo: "VTA" },
    });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-ventas-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Empleado",
        rol: "EMPLEADO",
      },
    });
    vendedorId = vendedor.id;

    const netflix = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (ventas.test)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaNetflixId = netflix.id;

    const disney = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ (ventas.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaDisneyId = disney.id;

    // HBO (ventas.test): tiene Precio pero deliberadamente NO tiene
    // CostoPlataforma — es la fixture de F4.7 para el renglón sin costo
    // atribuible (VentaDetalle.costo debe quedar en null, no en 0).
    const hbo = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "HBO (ventas.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaHboId = hbo.id;

    const cuentaNetflix = await prismaRaw.cuenta.create({
      data: {
        empresaId,
        plataformaId: plataformaNetflixId,
        correo: "netflix@ventas.test",
        password: cifrar("clave-netflix"),
        capacidadPantallas: 1,
      },
    });
    cuentaNetflixId = cuentaNetflix.id;
    await prismaRaw.pantalla.create({
      data: { empresaId, cuentaId: cuentaNetflixId, numero: 1, perfil: "Perfil 1", pin: cifrar("1234") },
    });

    const cuentaDisney = await prismaRaw.cuenta.create({
      data: {
        empresaId,
        plataformaId: plataformaDisneyId,
        correo: "disney@ventas.test",
        password: cifrar("clave-disney"),
        capacidadPantallas: 1,
      },
    });
    cuentaDisneyId = cuentaDisney.id;
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaDisneyId, numero: 1 } });

    const cuentaHbo = await prismaRaw.cuenta.create({
      data: {
        empresaId,
        plataformaId: plataformaHboId,
        correo: "hbo@ventas.test",
        password: cifrar("clave-hbo"),
        capacidadPantallas: 1,
      },
    });
    cuentaHboId = cuentaHbo.id;
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaHboId, numero: 1 } });

    const duracion30 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (ventas.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracion30Id = duracion30.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Nuevo (ventas.test)" },
    });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: plataformaNetflixId, duracionId: duracion30Id, tipoClienteId, precioVenta: "15000", costo: "8000" },
    });
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: plataformaDisneyId, duracionId: duracion30Id, tipoClienteId, precioVenta: "12000", costo: "5000" },
    });
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: plataformaHboId, duracionId: duracion30Id, tipoClienteId, precioVenta: "10000", costo: "0" },
    });
    // El costo ya no sale de Precio: CostoPlataforma es la fuente real que
    // realizarVenta consulta (lib/ventas.ts). HBO deliberadamente no tiene
    // fila en CostoPlataforma (ver fixture arriba).
    await prismaRaw.costoPlataforma.create({
      data: { empresaId, plataformaId: plataformaNetflixId, duracionId: duracion30Id, costo: "8000" },
    });
    await prismaRaw.costoPlataforma.create({
      data: { empresaId, plataformaId: plataformaDisneyId, duracionId: duracion30Id, costo: "5000" },
    });

    const paquete = await prismaRaw.paquete.create({ data: { empresaId, nombre: "Combo (ventas.test)" } });
    paqueteId = paquete.id;
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId, plataformaId: plataformaNetflixId, cantidadPantallas: 1 },
    });
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId, plataformaId: plataformaDisneyId, cantidadPantallas: 1 },
    });
    await prismaRaw.precio.create({
      data: { empresaId, paqueteId, duracionId: duracion30Id, tipoClienteId, precioVenta: "25000", costo: "13000" },
    });

    await prismaRaw.plantillaMensaje.create({
      data: {
        empresaId,
        tipo: "UNIDAD",
        contenido:
          "Código: {{codigoCompra}} | {{plataforma}} | {{correo}} | {{clave}} | {{perfil}} | {{pin}} | Vence: {{fechaVencimiento}} | {{precio}}",
      },
    });
    await prismaRaw.plantillaMensaje.create({
      data: {
        empresaId,
        tipo: "PAQUETE",
        contenido: "Código: {{codigoCompra}} | {{paquete}}\n{{listaCuentas}}\nVence: {{fechaVencimiento}} | {{precio}}",
      },
    });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.costoPlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
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

  it("UNIDAD: vende Netflix, crea Venta + un VentaDetalle y deja la pantalla ocupada", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "UNIDAD",
        plataformas: [plataformaNetflixId],
        duracionId: duracion30Id,
        tipoClienteId,
      }),
    );

    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");

    expect(resultado.venta.precioVenta.toString()).toBe("15000");
    expect(resultado.venta.utilidad.toString()).toBe("7000");
    expect(resultado.venta.codigoCompra.startsWith("VTA")).toBe(true);
    expect(resultado.venta.mensajeGenerado).toContain(resultado.venta.codigoCompra);
    expect(resultado.venta.mensajeGenerado).toContain("Perfil 1");
    expect(resultado.venta.mensajeGenerado).toContain("1234");
    expect(resultado.venta.mensajeGenerado).toContain("clave-netflix");

    const detalles = await prismaRaw.ventaDetalle.findMany({ where: { ventaId: resultado.venta.id } });
    expect(detalles).toHaveLength(1);
    expect(detalles[0]?.passwordCuenta).not.toBe("clave-netflix"); // copia cifrada, no en claro

    // Pantalla única de Netflix ya ocupada: una segunda venta UNIDAD de
    // Netflix se queda sin inventario.
    const segundo = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "UNIDAD",
        plataformas: [plataformaNetflixId],
        duracionId: duracion30Id,
        tipoClienteId,
      }),
    );
    expect(segundo.tipo).toBe("inventario_insuficiente");
  });

  it("PAQUETE: vende Combo (Netflix + Disney+), crea Venta + dos VentaDetalle", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "PAQUETE",
        paqueteId,
        duracionId: duracion30Id,
        tipoClienteId,
      }),
    );

    // La pantalla de Netflix ya se vendió en la prueba anterior: el paquete
    // debe fallar por inventario insuficiente en Netflix, todo o nada (R2).
    expect(resultado.tipo).toBe("inventario_insuficiente");
    if (resultado.tipo === "inventario_insuficiente") {
      expect(resultado.nombrePlataforma).toBe("Netflix (ventas.test)");
    }

    // Disney+ no debe haber quedado afectado: todo o nada.
    const detallesDisney = await prismaRaw.ventaDetalle.findMany({ where: { empresaId, plataformaId: plataformaDisneyId } });
    expect(detallesDisney).toHaveLength(0);
  });

  it("item_no_disponible: precio inexistente para la combinación", async () => {
    const otroTipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Sin precio (ventas.test)" } });

    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "UNIDAD",
        plataformas: [plataformaDisneyId],
        duracionId: duracion30Id,
        tipoClienteId: otroTipoCliente.id,
      }),
    );

    expect(resultado.tipo).toBe("no_disponible");

    await prismaRaw.tipoCliente.delete({ where: { id: otroTipoCliente.id } });
  });

  it("item_no_disponible: plataforma desactivada aunque el Precio siga activo", async () => {
    await prismaRaw.plataforma.update({ where: { id: plataformaDisneyId }, data: { activa: false } });

    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "UNIDAD",
        plataformas: [plataformaDisneyId],
        duracionId: duracion30Id,
        tipoClienteId,
      }),
    );

    expect(resultado.tipo).toBe("no_disponible");

    await prismaRaw.plataforma.update({ where: { id: plataformaDisneyId }, data: { activa: true } });
  });

  // F4.7, arreglo 1: sin CostoPlataforma, VentaDetalle.costo debe quedar en
  // null (dato desconocido), nunca en 0 (costo real) — Venta.costo, en
  // cambio, sigue siendo NOT NULL y alimenta los agregados.
  it("UNIDAD: sin CostoPlataforma, VentaDetalle.costo queda en null y el renglón se cuenta como sin costo atribuible", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "UNIDAD",
        plataformas: [plataformaHboId],
        duracionId: duracion30Id,
        tipoClienteId,
      }),
    );

    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");

    // Venta.costo (el agregado) no es nulo: sin costo atribuible se trata
    // como 0 para el total, que es la semántica correcta de un agregado.
    expect(resultado.venta.costo.toString()).toBe("0");

    const detalle = await prismaRaw.ventaDetalle.findFirst({ where: { ventaId: resultado.venta.id } });
    expect(detalle?.costo).toBeNull();

    const estadisticas = await calcularEstadisticas(cliente, new Date(0), new Date(Date.now() + 86_400_000));
    const segmentoHbo = estadisticas.porPlataforma.find((p) => p.plataformaId === plataformaHboId);
    expect(segmentoHbo?.renglonesSinCostoAtribuible).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// R2 — Pruebas obligatorias de concurrencia (PRD, regla R2). Cada petición
// corre en SU PROPIA transacción real contra Postgres (igual que el patrón
// de concurrencia de bloqueo-pantallas.test.ts), no llamadas secuenciales
// disfrazadas de paralelas.
// ---------------------------------------------------------------------------

describe("realizarVenta (R2, prueba obligatoria 1) — UNIDAD: 20 peticiones en paralelo contra 5 pantallas libres", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({ data: { nombre: "Empresa R2-unidad (ventas.test)", prefijoCodigo: "R2U" } });
    empresaId = empresa.id;
    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: `vendedor-r2u-${randomUUID()}@test.local`, passwordHash: "hash", nombre: "Empleado", rol: "EMPLEADO" },
    });
    vendedorId = vendedor.id;
    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (R2-unidad.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;
    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "r2u@ventas.test", password: cifrar("clave"), capacidadPantallas: 5 },
    });
    await Promise.all(
      [1, 2, 3, 4, 5].map((numero) => prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero } })),
    );
    const duracion = await prismaRaw.duracion.create({ data: { empresaId, nombre: "30 días (R2-unidad.test)", cantidad: 30, unidad: "DIAS" } });
    duracionId = duracion.id;
    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (R2-unidad.test)" } });
    tipoClienteId = tipoCliente.id;
    await prismaRaw.precio.create({ data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "10000", costo: "5000" } });
    await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "UNIDAD", contenido: "{{codigoCompra}}" } });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("exactamente 5 ventas, 15 rechazos por inventario, ninguna pantalla duplicada", async () => {
    const resultados = await Promise.all(
      Array.from({ length: 20 }, () =>
        prismaParaEmpresa(empresaId).$transaction((tx) =>
          realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformas: [plataformaId], duracionId, tipoClienteId }),
        ),
      ),
    );

    const ok = resultados.filter((r) => r.tipo === "ok");
    const sinInventario = resultados.filter((r) => r.tipo === "inventario_insuficiente");
    expect(ok).toHaveLength(5);
    expect(sinInventario).toHaveLength(15);

    const detalles = await prismaRaw.ventaDetalle.findMany({ where: { empresaId } });
    expect(detalles).toHaveLength(5);
    const pantallaIds = detalles.map((d) => d.pantallaId);
    expect(new Set(pantallaIds).size).toBe(5); // ninguna pantalla se repite
  });
});

describe("realizarVenta (R2, prueba obligatoria 2) — PAQUETE: todo o nada bajo concurrencia", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaEscasaId: string; // 2 pantallas libres
  let plataformaAbundanteId: string; // 10 pantallas libres
  let paqueteId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({ data: { nombre: "Empresa R2-paquete (ventas.test)", prefijoCodigo: "R2P" } });
    empresaId = empresa.id;
    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: `vendedor-r2p-${randomUUID()}@test.local`, passwordHash: "hash", nombre: "Empleado", rol: "EMPLEADO" },
    });
    vendedorId = vendedor.id;

    const escasa = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix escasa (R2-paquete.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaEscasaId = escasa.id;
    const abundante = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ abundante (R2-paquete.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaAbundanteId = abundante.id;

    const cuentaEscasa = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaEscasaId, correo: "escasa@r2p.test", password: cifrar("clave"), capacidadPantallas: 2 },
    });
    await Promise.all([1, 2].map((numero) => prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaEscasa.id, numero } })));

    const cuentaAbundante = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaAbundanteId, correo: "abundante@r2p.test", password: cifrar("clave"), capacidadPantallas: 10 },
    });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => i + 1).map((numero) =>
        prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaAbundante.id, numero } }),
      ),
    );

    const duracion = await prismaRaw.duracion.create({ data: { empresaId, nombre: "30 días (R2-paquete.test)", cantidad: 30, unidad: "DIAS" } });
    duracionId = duracion.id;
    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (R2-paquete.test)" } });
    tipoClienteId = tipoCliente.id;

    const paquete = await prismaRaw.paquete.create({ data: { empresaId, nombre: "Combo (R2-paquete.test)" } });
    paqueteId = paquete.id;
    await prismaRaw.paquetePlataforma.create({ data: { empresaId, paqueteId, plataformaId: plataformaEscasaId, cantidadPantallas: 1 } });
    await prismaRaw.paquetePlataforma.create({ data: { empresaId, paqueteId, plataformaId: plataformaAbundanteId, cantidadPantallas: 1 } });
    await prismaRaw.precio.create({ data: { empresaId, paqueteId, duracionId, tipoClienteId, precioVenta: "20000", costo: "10000" } });
    await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "PAQUETE", contenido: "{{codigoCompra}} {{listaCuentas}}" } });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
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

  it("exactamente 2 ventas; las 8 fallidas no consumen pantallas de la plataforma abundante", async () => {
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () =>
        prismaParaEmpresa(empresaId).$transaction((tx) =>
          realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "PAQUETE", paqueteId, duracionId, tipoClienteId }),
        ),
      ),
    );

    const ok = resultados.filter((r) => r.tipo === "ok");
    const sinInventario = resultados.filter((r) => r.tipo === "inventario_insuficiente");
    expect(ok).toHaveLength(2);
    expect(sinInventario).toHaveLength(8);
    for (const r of sinInventario) {
      if (r.tipo === "inventario_insuficiente") expect(r.nombrePlataforma).toBe("Netflix escasa (R2-paquete.test)");
    }

    // Todo o nada: la plataforma abundante solo debe tener detalles de las
    // 2 ventas que SÍ completaron ambas plataformas, nunca 8 huérfanos.
    const detallesAbundante = await prismaRaw.ventaDetalle.findMany({ where: { empresaId, plataformaId: plataformaAbundanteId } });
    expect(detallesAbundante).toHaveLength(2);
    const detallesEscasa = await prismaRaw.ventaDetalle.findMany({ where: { empresaId, plataformaId: plataformaEscasaId } });
    expect(detallesEscasa).toHaveLength(2);
  });
});

describe("realizarVenta (R2, prueba obligatoria 3) — código de compra bajo concurrencia real", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;
  const CANTIDAD = 30;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({ data: { nombre: "Empresa R2-codigo (ventas.test)", prefijoCodigo: "R2C" } });
    empresaId = empresa.id;
    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: `vendedor-r2c-${randomUUID()}@test.local`, passwordHash: "hash", nombre: "Empleado", rol: "EMPLEADO" },
    });
    vendedorId = vendedor.id;
    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (R2-codigo.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;
    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "r2c@ventas.test", password: cifrar("clave"), capacidadPantallas: CANTIDAD },
    });
    await Promise.all(
      Array.from({ length: CANTIDAD }, (_, i) => i + 1).map((numero) =>
        prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero } }),
      ),
    );
    const duracion = await prismaRaw.duracion.create({ data: { empresaId, nombre: "30 días (R2-codigo.test)", cantidad: 30, unidad: "DIAS" } });
    duracionId = duracion.id;
    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (R2-codigo.test)" } });
    tipoClienteId = tipoCliente.id;
    await prismaRaw.precio.create({ data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "10000", costo: "5000" } });
    await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "UNIDAD", contenido: "{{codigoCompra}}" } });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it(`${CANTIDAD} ventas en paralelo producen ${CANTIDAD} códigos de compra distintos`, async () => {
    const resultados = await Promise.all(
      Array.from({ length: CANTIDAD }, () =>
        prismaParaEmpresa(empresaId).$transaction((tx) =>
          realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformas: [plataformaId], duracionId, tipoClienteId }),
        ),
      ),
    );

    const ok = resultados.filter((r) => r.tipo === "ok");
    expect(ok).toHaveLength(CANTIDAD);
    const codigos = ok.map((r) => (r.tipo === "ok" ? r.venta.codigoCompra : ""));
    expect(new Set(codigos).size).toBe(CANTIDAD);
  });
});

describe("realizarVenta (R3) — editar la plantilla después de vender no cambia el mensaje ya generado", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({ data: { nombre: "Empresa R3 (ventas.test)", prefijoCodigo: "R3V" } });
    empresaId = empresa.id;
    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: `vendedor-r3-${randomUUID()}@test.local`, passwordHash: "hash", nombre: "Empleado", rol: "EMPLEADO" },
    });
    vendedorId = vendedor.id;
    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (R3.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;
    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "r3@ventas.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 1 } });
    const duracion = await prismaRaw.duracion.create({ data: { empresaId, nombre: "30 días (R3.test)", cantidad: 30, unidad: "DIAS" } });
    duracionId = duracion.id;
    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (R3.test)" } });
    tipoClienteId = tipoCliente.id;
    await prismaRaw.precio.create({ data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "10000", costo: "5000" } });
    await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "UNIDAD", contenido: "Plantilla original {{codigoCompra}}" } });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  it("el mensajeGenerado de una venta ya hecha no cambia aunque se edite la plantilla después", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformas: [plataformaId], duracionId, tipoClienteId }),
    );
    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");
    expect(resultado.venta.mensajeGenerado).toContain("Plantilla original");

    await prismaRaw.plantillaMensaje.updateMany({
      where: { empresaId, tipo: "UNIDAD" },
      data: { contenido: "Plantilla NUEVA {{codigoCompra}}" },
    });

    const ventaRelida = await prismaRaw.venta.findUniqueOrThrow({ where: { id: resultado.venta.id } });
    expect(ventaRelida.mensajeGenerado).toContain("Plantilla original");
    expect(ventaRelida.mensajeGenerado).not.toContain("Plantilla NUEVA");
  });
});

// ---------------------------------------------------------------------------
// Entrega 9, sección 0c — la prueba de 30 ventas en paralelo (arriba) demuestra
// que no hubo colisión, no que el reintento ante P2002 funcione: con 6
// dígitos aleatorios esa rama casi nunca se ejecuta por azar. Esta prueba la
// FUERZA: envuelve `tx` para que la pre-verificación de generarCodigoCompra
// (su propio `findUnique`) MIENTA la primera vez y diga "código libre" aunque
// ya exista una venta con ese código, así el `create()` real que sigue choca
// de verdad contra la restricción única de Postgres — la misma carrera que
// describe CLAUDE.md (pre-check optimista + P2002 real), sin depender de
// concurrencia real ni de que el azar produzca la colisión.
// ---------------------------------------------------------------------------

describe("realizarVenta (0c, prueba forzada) — colisión real de código de compra (P2002) obliga a reintentar", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa R2-colision (ventas.test)", prefijoCodigo: "R2X" },
    });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-r2x-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Empleado",
        rol: "EMPLEADO",
      },
    });
    vendedorId = vendedor.id;

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (R2-colision.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "r2x@ventas.test", password: cifrar("clave"), capacidadPantallas: 2 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 1 } });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 2 } });

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (R2-colision.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (R2-colision.test)" } });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "10000", costo: "5000" },
    });
    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "UNIDAD", contenido: "Código {{codigoCompra}}" },
    });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  // `mentirasRestantes` cuenta cuántas veces MÁS debe mentir `findUnique`
  // antes de empezar a responder la verdad. Con 1, miente una sola vez; con
  // Infinity, miente siempre (para el caso de agotar los 5 intentos).
  function conPreVerificacionMentirosa<T extends object>(tx: T, mentirasRestantes: number): T {
    let restantes = mentirasRestantes;
    return new Proxy(tx as Record<string, unknown>, {
      get(objetivo, prop, receptor) {
        if (prop !== "venta") return Reflect.get(objetivo, prop, receptor);
        const delegadoVenta = Reflect.get(objetivo, prop, receptor) as Record<string, unknown>;
        return new Proxy(delegadoVenta, {
          get(delegadoObjetivo, propVenta, receptorVenta) {
            if (propVenta === "findUnique" && restantes > 0) {
              restantes -= 1;
              return async () => null;
            }
            return Reflect.get(delegadoObjetivo, propVenta, receptorVenta);
          },
        });
      },
    }) as T;
  }

  it("el pre-check miente una vez (dice que el código está libre), create() choca de verdad contra P2002, y la venta reintenta con un código distinto hasta completarse", async () => {
    const codigoColisionado = "R2X111111";
    await prismaRaw.venta.create({
      data: {
        empresaId,
        vendedorId,
        codigoCompra: codigoColisionado,
        tipoVenta: "UNIDAD",
        plataformaId,
        duracionId,
        tipoClienteId,
        nombreItem: "Fantasma",
        nombreDuracion: "30 días",
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        nombreTipoCliente: "Nuevo",
        precioVenta: "10000",
        precioSugerido: "10000",
        costo: "5000",
        utilidad: "5000",
        fechaVencimientoMax: new Date(),
        mensajeGenerado: "venta fantasma para forzar la colisión real de P2002",
      },
    });

    const randomOriginal = Math.random;
    let llamada = 0;
    // 1ª llamada -> 111111 (coincide con la venta fantasma); desde la 2ª en
    // adelante -> 654321 (libre), para que el reintento tenga a dónde ir.
    Math.random = () => {
      llamada += 1;
      return llamada === 1 ? 0.111111 : 0.654321;
    };

    try {
      const cliente = prismaParaEmpresa(empresaId);
      const resultado = await cliente.$transaction((tx) =>
        realizarVenta(conPreVerificacionMentirosa(tx, 1), empresaId, vendedorId, {
          tipoVenta: "UNIDAD",
          plataformas: [plataformaId],
          duracionId,
          tipoClienteId,
        }),
      );

      expect(resultado.tipo).toBe("ok");
      if (resultado.tipo !== "ok") throw new Error("esperaba ok");
      expect(resultado.venta.codigoCompra).not.toBe(codigoColisionado);
      expect(resultado.venta.codigoCompra).toBe("R2X654321");
      // El generador de dígitos sí tuvo que invocarse una segunda vez: la
      // prueba ejerció el reintento, no solo el primer intento con suerte.
      expect(llamada).toBeGreaterThanOrEqual(2);
    } finally {
      Math.random = randomOriginal;
    }
  });

  it("si la colisión persiste en los 5 intentos, lanza un error claro y nunca devuelve ni duplica un código", async () => {
    const codigoColisionado = "R2X222222";
    await prismaRaw.venta.create({
      data: {
        empresaId,
        vendedorId,
        codigoCompra: codigoColisionado,
        tipoVenta: "UNIDAD",
        plataformaId,
        duracionId,
        tipoClienteId,
        nombreItem: "Fantasma 2",
        nombreDuracion: "30 días",
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        nombreTipoCliente: "Nuevo",
        precioVenta: "10000",
        precioSugerido: "10000",
        costo: "5000",
        utilidad: "5000",
        fechaVencimientoMax: new Date(),
        mensajeGenerado: "venta fantasma 2 para agotar los reintentos",
      },
    });

    const randomOriginal = Math.random;
    Math.random = () => 0.222222; // siempre el mismo código -> siempre choca

    try {
      const cliente = prismaParaEmpresa(empresaId);
      await expect(
        cliente.$transaction((tx) =>
          realizarVenta(conPreVerificacionMentirosa(tx, Infinity), empresaId, vendedorId, {
            tipoVenta: "UNIDAD",
            plataformas: [plataformaId],
            duracionId,
            tipoClienteId,
          }),
        ),
      ).rejects.toThrow(/No se pudo generar un código de compra único/);

      const ventasConEseCodigo = await prismaRaw.venta.findMany({ where: { empresaId, codigoCompra: codigoColisionado } });
      expect(ventasConEseCodigo).toHaveLength(1); // solo la fantasma: nada se creó ni se duplicó
    } finally {
      Math.random = randomOriginal;
    }
  });
});

// ---------------------------------------------------------------------------
// Promoción (esPromocion) — una promoción es un Paquete con esPromocion=true;
// no hay una segunda ruta de venta. R3: Venta.esPromocion es copia inmutable
// del paquete al momento de vender. R2: una promoción de varios componentes
// sigue siendo todo o nada.
// ---------------------------------------------------------------------------

describe("realizarVenta — Promoción", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaNetflixId: string;
  let plataformaDisneyId: string;
  let duracion30Id: string;
  let tipoClienteId: string;
  let paquetePromoId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa promoción (ventas.test)", prefijoCodigo: "PRM" },
    });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-promo-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Empleado",
        rol: "EMPLEADO",
      },
    });
    vendedorId = vendedor.id;

    const netflix = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (promo.test)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaNetflixId = netflix.id;
    const cuentaNetflix = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaNetflixId, correo: "netflix@promo.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    // Una pantalla libre: suficiente para una venta UNIDAD de Netflix, pero
    // el paquete promocional exige 1 de Netflix Y 1 de Disney+ a la vez.
    await prismaRaw.pantalla.create({
      data: { empresaId, cuentaId: cuentaNetflix.id, numero: 1, perfil: "Perfil 1", pin: cifrar("1234") },
    });

    const disney = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ (promo.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaDisneyId = disney.id;
    // Cuenta sin ninguna pantalla: 0 cupo libre siempre, de forma
    // determinista (no depende de agotar inventario con una venta previa).
    await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaDisneyId, correo: "disney@promo.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });

    const duracion30 = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (promo.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracion30Id = duracion30.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (promo.test)" } });
    tipoClienteId = tipoCliente.id;

    const paquetePromo = await prismaRaw.paquete.create({
      data: { empresaId, nombre: "Promo 2x1 (promo.test)", esPromocion: true },
    });
    paquetePromoId = paquetePromo.id;
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId: paquetePromoId, plataformaId: plataformaNetflixId, cantidadPantallas: 1 },
    });
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId: paquetePromoId, plataformaId: plataformaDisneyId, cantidadPantallas: 1 },
    });
    await prismaRaw.precio.create({
      data: { empresaId, paqueteId: paquetePromoId, duracionId: duracion30Id, tipoClienteId, precioVenta: "20000", costo: "10000" },
    });

    await prismaRaw.plantillaMensaje.create({
      data: {
        empresaId,
        tipo: "PAQUETE",
        contenido: "Código: {{codigoCompra}} | {{paquete}}\n{{listaCuentas}}\nVence: {{fechaVencimiento}} | {{precio}}",
      },
    });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
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

  it("R2: promoción de dos componentes es todo o nada si a uno le falta cupo", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "PAQUETE",
        paqueteId: paquetePromoId,
        duracionId: duracion30Id,
        tipoClienteId,
      }),
    );

    // Disney+ no tiene ninguna pantalla: la promoción debe fallar entera.
    expect(resultado.tipo).toBe("inventario_insuficiente");
    if (resultado.tipo === "inventario_insuficiente") {
      expect(resultado.nombrePlataforma).toBe("Disney+ (promo.test)");
    }

    // Netflix sí tenía cupo: si quedó algo tomado ahí, no fue todo o nada.
    const detallesNetflix = await prismaRaw.ventaDetalle.findMany({
      where: { empresaId, plataformaId: plataformaNetflixId },
    });
    expect(detallesNetflix).toHaveLength(0);

    const ventas = await prismaRaw.venta.findMany({ where: { empresaId, paqueteId: paquetePromoId } });
    expect(ventas).toHaveLength(0);
  });

  it("R3: Venta.esPromocion es copia inmutable — desmarcar el paquete después no cambia ventas ya hechas", async () => {
    // Darle a Disney+ su propia pantalla para que esta venta sí se complete.
    const cuentaDisney = await prismaRaw.cuenta.findFirstOrThrow({ where: { empresaId, plataformaId: plataformaDisneyId } });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaDisney.id, numero: 1 } });

    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "PAQUETE",
        paqueteId: paquetePromoId,
        duracionId: duracion30Id,
        tipoClienteId,
      }),
    );

    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");
    expect(resultado.venta.esPromocion).toBe(true);

    // El admin desmarca la promoción el mes entrante...
    await prismaRaw.paquete.update({ where: { id: paquetePromoId }, data: { esPromocion: false } });

    // ...la venta de este mes sigue contando como promoción (R3): es copia,
    // no una lectura en vivo de Paquete.esPromocion.
    const ventaRecargada = await prismaRaw.venta.findUniqueOrThrow({ where: { id: resultado.venta.id } });
    expect(ventaRecargada.esPromocion).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F4.4 — "Venta de varios productos con precio final editable". Fixture
// propia: el describe de arriba no tiene cupo para vender 2+ renglones en
// una sola llamada. Cada escenario usa sus propias plataformas dedicadas
// (en vez de compartir cupo entre pruebas) para que el conteo de pantallas
// consumidas de cada prueba sea independiente y legible.
// ---------------------------------------------------------------------------

describe("realizarVenta (F4.4) — UNIDAD multi-renglón", () => {
  let empresaId: string;
  let vendedorId: string;
  let duracion30Id: string;
  let tipoClienteId: string;

  let netflixId: string;
  let disneyId: string;
  let netflixPaqueteId: string;
  let disneyPaqueteId: string;
  let paqueteId: string;
  let netflixDescId: string;
  let disneyDescId: string;
  let netflixSurId: string;
  let disneySurId: string;
  let netflixOrdId: string;
  let disneyOrdId: string;

  // Crea una plataforma con su propia cuenta, N pantallas libres, Precio y
  // CostoPlataforma — todo lo que realizarVenta necesita para vender esa
  // plataforma de inmediato.
  async function crearPlataformaConCupo(nombre: string, cantidadPantallas: number, precioVenta: string, costo: string) {
    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre, capacidadPantallas: cantidadPantallas, usaPerfilPin: false },
    });
    const slug = nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataforma.id, correo: `${slug}@f44.test`, password: cifrar("clave"), capacidadPantallas: cantidadPantallas },
    });
    for (let numero = 1; numero <= cantidadPantallas; numero++) {
      await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero } });
    }
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: plataforma.id, duracionId: duracion30Id, tipoClienteId, precioVenta, costo },
    });
    await prismaRaw.costoPlataforma.create({ data: { empresaId, plataformaId: plataforma.id, duracionId: duracion30Id, costo } });
    return plataforma.id;
  }

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({ data: { nombre: "Empresa F4.4 (ventas.test)", prefijoCodigo: "F44" } });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: `empleado-f44-${randomUUID()}@test.local`, passwordHash: "hash", nombre: "Empleado", rol: "EMPLEADO" },
    });
    vendedorId = vendedor.id;

    const duracion = await prismaRaw.duracion.create({ data: { empresaId, nombre: "30 días (f44.test)", cantidad: 30, unidad: "DIAS" } });
    duracion30Id = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (f44.test)" } });
    tipoClienteId = tipoCliente.id;

    // Netflix/Disney+ con 3 pantallas cada una: alcanza para las pruebas de
    // "2 distintas" (1+1) y "repetida x2" (2) antes de agotarse, lo que deja
    // la prueba de todo-o-nada usando el agotamiento real de la anterior en
    // vez de un stock fabricado aparte.
    netflixId = await crearPlataformaConCupo("Netflix (f44.test)", 3, "15000", "8000");
    disneyId = await crearPlataformaConCupo("Disney+ (f44.test)", 3, "12000", "5000");

    netflixPaqueteId = await crearPlataformaConCupo("Netflix combo (f44.test)", 1, "15000", "8000");
    disneyPaqueteId = await crearPlataformaConCupo("Disney+ combo (f44.test)", 1, "12000", "5000");
    const paquete = await prismaRaw.paquete.create({ data: { empresaId, nombre: "Combo (f44.test)" } });
    paqueteId = paquete.id;
    await prismaRaw.paquetePlataforma.create({ data: { empresaId, paqueteId, plataformaId: netflixPaqueteId, cantidadPantallas: 1 } });
    await prismaRaw.paquetePlataforma.create({ data: { empresaId, paqueteId, plataformaId: disneyPaqueteId, cantidadPantallas: 1 } });
    await prismaRaw.precio.create({ data: { empresaId, paqueteId, duracionId: duracion30Id, tipoClienteId, precioVenta: "25000", costo: "13000" } });

    netflixDescId = await crearPlataformaConCupo("Netflix descuento (f44.test)", 1, "15000", "8000");
    disneyDescId = await crearPlataformaConCupo("Disney+ descuento (f44.test)", 1, "12000", "5000");

    netflixSurId = await crearPlataformaConCupo("Netflix recargo (f44.test)", 1, "15000", "8000");
    disneySurId = await crearPlataformaConCupo("Disney+ recargo (f44.test)", 1, "12000", "5000");

    netflixOrdId = await crearPlataformaConCupo("Netflix orden (f44.test)", 2, "15000", "8000");
    disneyOrdId = await crearPlataformaConCupo("Disney+ orden (f44.test)", 2, "12000", "5000");

    // F4.4 Parte 2b: 2+ renglones usa la plantilla PAQUETE (un bloque por
    // pantalla), aunque tipoVenta siga siendo "UNIDAD".
    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "UNIDAD", contenido: "Código: {{codigoCompra}} | {{correo}} | {{clave}} | {{precio}}" },
    });
    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "PAQUETE", contenido: "Código: {{codigoCompra}} | {{paquete}}\n{{listaCuentas}}\n{{precio}}" },
    });
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.costoPlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
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

  it("2 plataformas distintas en una sola venta: plataformaId null, precioSugerido = suma, un VentaDetalle por plataforma con su propio precioSugerido/costo", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "UNIDAD",
        plataformas: [netflixId, disneyId],
        duracionId: duracion30Id,
        tipoClienteId,
      }),
    );

    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");
    expect(resultado.venta.plataformaId).toBeNull(); // decisión 6: sin un único id que represente el renglón
    expect(resultado.venta.precioSugerido.toString()).toBe("27000"); // 15000 + 12000
    expect(resultado.venta.precioVenta.toString()).toBe("27000"); // sin precioFinal, se cobra el sugerido
    expect(resultado.venta.nombreItem).toBe("Netflix (f44.test) + Disney+ (f44.test)");
    // un solo mensaje para los dos renglones (decisión 1/4), no dos mensajes separados.
    expect(resultado.venta.mensajeGenerado.match(/Código:/g)?.length).toBe(1);

    const detalles = await prismaRaw.ventaDetalle.findMany({ where: { ventaId: resultado.venta.id } });
    expect(detalles).toHaveLength(2);
    const detalleNetflix = detalles.find((d) => d.plataformaId === netflixId)!;
    const detalleDisney = detalles.find((d) => d.plataformaId === disneyId)!;
    expect(detalleNetflix.precioSugerido?.toString()).toBe("15000");
    expect(detalleNetflix.costo?.toString()).toBe("8000");
    expect(detalleDisney.precioSugerido?.toString()).toBe("12000");
    expect(detalleDisney.costo?.toString()).toBe("5000");
  });

  it("plataforma repetida (Netflix x2): un componente agrupado con 2 pantallas, dos VentaDetalle de la misma plataforma en pantallas distintas", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "UNIDAD",
        plataformas: [netflixId, netflixId],
        duracionId: duracion30Id,
        tipoClienteId,
      }),
    );

    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");
    expect(resultado.venta.plataformaId).toBeNull();
    expect(resultado.venta.precioSugerido.toString()).toBe("30000"); // 15000 x 2 renglones
    expect(resultado.venta.nombreItem).toBe("Netflix (f44.test) + Netflix (f44.test)");
    expect(resultado.venta.mensajeGenerado.match(/Código:/g)?.length).toBe(1); // un mensaje con 2 bloques, no 2 mensajes

    const detalles = await prismaRaw.ventaDetalle.findMany({ where: { ventaId: resultado.venta.id } });
    expect(detalles).toHaveLength(2);
    expect(detalles.every((d) => d.plataformaId === netflixId)).toBe(true);
    expect(new Set(detalles.map((d) => d.pantallaId)).size).toBe(2); // 2 pantallas distintas, no la misma dos veces
    for (const detalle of detalles) {
      expect(detalle.precioSugerido?.toString()).toBe("15000");
      expect(detalle.costo?.toString()).toBe("8000");
    }
  });

  it("todo o nada: si una de las plataformas ya no tiene cupo, no se vende ninguna (ni siquiera la que sí tenía)", async () => {
    // Netflix ya agotó sus 3 pantallas en las dos pruebas anteriores (1 + 2).
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "UNIDAD",
        plataformas: [netflixId, disneyId],
        duracionId: duracion30Id,
        tipoClienteId,
      }),
    );

    expect(resultado.tipo).toBe("inventario_insuficiente");
    if (resultado.tipo === "inventario_insuficiente") {
      expect(resultado.nombrePlataforma).toBe("Netflix (f44.test)");
    }

    // Disney+ no quedó afectado por el intento fallido: sigue con el único
    // VentaDetalle de la primera prueba, ninguno nuevo (R2 regla 2).
    const detallesDisney = await prismaRaw.ventaDetalle.findMany({ where: { empresaId, plataformaId: disneyId } });
    expect(detallesDisney).toHaveLength(1);
  });

  it("precioFinal (descuento manual): ajusta Venta.precioVenta pero no distribuye el descuento ni toca las copias por plataforma", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "UNIDAD",
        plataformas: [netflixDescId, disneyDescId],
        duracionId: duracion30Id,
        tipoClienteId,
        precioFinal: new Prisma.Decimal("20000"),
      }),
    );

    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");
    expect(resultado.venta.precioSugerido.toString()).toBe("27000"); // 15000 + 12000, intacto
    expect(resultado.venta.precioVenta.toString()).toBe("20000"); // lo que de verdad se cobró
    expect(resultado.venta.utilidad.toString()).toBe("7000"); // 20000 - costo(8000+5000)

    const detalles = await prismaRaw.ventaDetalle.findMany({ where: { ventaId: resultado.venta.id } });
    const detalleNetflix = detalles.find((d) => d.plataformaId === netflixDescId)!;
    const detalleDisney = detalles.find((d) => d.plataformaId === disneyDescId)!;
    // decisión 3 del encargo F4.4: el descuento es del total, nunca se
    // reparte — cada renglón conserva su propio precio de catálogo.
    expect(detalleNetflix.precioSugerido?.toString()).toBe("15000");
    expect(detalleDisney.precioSugerido?.toString()).toBe("12000");
  });

  it("precioFinal por encima de precioSugerido (recargo) se acepta igual", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, {
        tipoVenta: "UNIDAD",
        plataformas: [netflixSurId, disneySurId],
        duracionId: duracion30Id,
        tipoClienteId,
        precioFinal: new Prisma.Decimal("40000"),
      }),
    );

    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");
    expect(resultado.venta.precioSugerido.toString()).toBe("27000");
    expect(resultado.venta.precioVenta.toString()).toBe("40000");
  });

  it("PAQUETE: VentaDetalle.precioSugerido queda null (el precio de un paquete no se puede atribuir por plataforma)", async () => {
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

    const detalles = await prismaRaw.ventaDetalle.findMany({ where: { ventaId: resultado.venta.id } });
    expect(detalles).toHaveLength(2);
    for (const detalle of detalles) {
      expect(detalle.precioSugerido).toBeNull();
      // El costo sí se conoce por plataforma (CostoPlataforma): solo el
      // precio de venta es lo que no se puede atribuir sin inventarlo.
      expect(detalle.costo).not.toBeNull();
    }
  });

  it("R2 regla 1: dos ventas concurrentes que piden las mismas 2 plataformas en orden inverso no se bloquean entre sí ni duplican pantallas", async () => {
    const clienteA = prismaParaEmpresa(empresaId);
    const clienteB = prismaParaEmpresa(empresaId);

    const [resultadoA, resultadoB] = await Promise.all([
      clienteA.$transaction((tx) =>
        realizarVenta(tx, empresaId, vendedorId, {
          tipoVenta: "UNIDAD",
          plataformas: [netflixOrdId, disneyOrdId],
          duracionId: duracion30Id,
          tipoClienteId,
        }),
      ),
      clienteB.$transaction((tx) =>
        realizarVenta(tx, empresaId, vendedorId, {
          tipoVenta: "UNIDAD",
          plataformas: [disneyOrdId, netflixOrdId], // mismo par, orden invertido
          duracionId: duracion30Id,
          tipoClienteId,
        }),
      ),
    ]);

    expect(resultadoA.tipo).toBe("ok");
    expect(resultadoB.tipo).toBe("ok");

    const detalles = await prismaRaw.ventaDetalle.findMany({
      where: { empresaId, plataformaId: { in: [netflixOrdId, disneyOrdId] } },
    });
    expect(detalles).toHaveLength(4); // 2 ventas x 2 plataformas
    expect(new Set(detalles.map((d) => d.pantallaId)).size).toBe(4); // ninguna pantalla repetida entre las dos ventas
  });
});
