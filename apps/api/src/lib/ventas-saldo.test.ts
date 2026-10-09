import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
// prismaRaw en este archivo: arma la fixture directamente, fuera de
// cualquier contexto de empresa autenticado — mismo patrón que ventas.test.ts.
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { cifrar } from "./cifrado.ts";
import { realizarVenta } from "./ventas.ts";

// ---------------------------------------------------------------------------
// Saldo — concurrencia, deadlock, rollback, cuadre de ledger y no-regresión
// del camino de empleado, todo sobre `realizarVenta` directamente (sin pasar
// por HTTP). Las pruebas que dependen de la anulación (doble anulación,
// cuadre de ledger a través de venta + anulación) viven en
// routes/ventas.test.ts: esa lógica de DEVOLUCION es inline en el handler
// PATCH /:id/anular, no hay una función de lib/ reutilizable que llamar aquí.
// ---------------------------------------------------------------------------

describe("realizarVenta (Saldo) — concurrencia: varias ventas simultáneas, mismo revendedor, saldo para una sola", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa saldo-conc (ventas-saldo.test)", prefijoCodigo: "SLC" },
    });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-saldo-conc-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Revendedor",
        rol: "VENDEDOR",
        usaSaldo: true,
        saldo: "10000",
      },
    });
    vendedorId = vendedor.id;

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (saldo-conc.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "saldo-conc@ventas.test", password: cifrar("clave"), capacidadPantallas: 5 },
    });
    // Inventario amplio a propósito: el cuello de botella de esta prueba es
    // el saldo, no las pantallas (eso ya lo cubre R2 en ventas.test.ts).
    await Promise.all(
      [1, 2, 3, 4, 5].map((numero) => prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero } })),
    );

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (saldo-conc.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (saldo-conc.test)" } });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "10000", costo: "4000" },
    });
    await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "UNIDAD", contenido: "{{codigoCompra}}" } });
  });

  afterAll(async () => {
    await prismaRaw.movimientoSaldo.deleteMany({ where: { empresaId } });
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

  it("5 ventas en paralelo (cada una en su propia transacción real), saldo solo alcanza para 1: exactamente 1 ok y 4 saldo_insuficiente, nunca doble cobro", async () => {
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () =>
        prismaParaEmpresa(empresaId).$transaction((tx) =>
          realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }),
        ),
      ),
    );

    const ok = resultados.filter((r) => r.tipo === "ok");
    const sinSaldo = resultados.filter((r) => r.tipo === "saldo_insuficiente");
    expect(ok).toHaveLength(1);
    expect(sinSaldo).toHaveLength(4);
    for (const r of sinSaldo) {
      if (r.tipo !== "saldo_insuficiente") continue;
      expect(r.precioVenta.toString()).toBe("10000");
      // El bloqueo de la fila de Usuario (FOR UPDATE, sin SKIP LOCKED)
      // serializa las 5 transacciones: la que gana la carrera deja el
      // saldo en 0 antes de que cualquier otra alcance a leerlo.
      expect(new Prisma.Decimal(r.saldo).equals(0)).toBe(true);
      expect(new Prisma.Decimal(r.falta).equals(10000)).toBe(true);
    }

    const usuarioFinal = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorId } });
    expect(new Prisma.Decimal(usuarioFinal.saldo).equals(0)).toBe(true);

    const movimientos = await prismaRaw.movimientoSaldo.findMany({ where: { usuarioId: vendedorId } });
    expect(movimientos).toHaveLength(1); // nunca se cobró dos veces
    expect(movimientos[0]?.tipo).toBe("CONSUMO");
    expect(new Prisma.Decimal(movimientos[0]!.monto).equals(-10000)).toBe(true);
    expect(new Prisma.Decimal(movimientos[0]!.saldoResultante).equals(0)).toBe(true);

    // Inventario amplio: la única venta que se completó, se completó una
    // sola vez (ninguna pantalla duplicada ni huérfana).
    const detalles = await prismaRaw.ventaDetalle.findMany({ where: { empresaId } });
    expect(detalles).toHaveLength(1);
  });
});

describe("realizarVenta (Saldo) — deadlock: compras de paquete concurrentes que comparten plataformas, mismo revendedor", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaEscasaId: string;
  let plataformaAbundanteId: string;
  let paqueteId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa saldo-deadlock (ventas-saldo.test)", prefijoCodigo: "SLD" },
    });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-saldo-deadlock-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Revendedor",
        rol: "VENDEDOR",
        usaSaldo: true,
        saldo: "1000000", // de sobra para las compras que sí completen
      },
    });
    vendedorId = vendedor.id;

    const escasa = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix escasa (saldo-deadlock.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaEscasaId = escasa.id;
    const abundante = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ abundante (saldo-deadlock.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaAbundanteId = abundante.id;

    const cuentaEscasa = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaEscasaId, correo: "escasa@saldo-deadlock.test", password: cifrar("clave"), capacidadPantallas: 2 },
    });
    await Promise.all([1, 2].map((numero) => prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaEscasa.id, numero } })));

    const cuentaAbundante = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaAbundanteId, correo: "abundante@saldo-deadlock.test", password: cifrar("clave"), capacidadPantallas: 10 },
    });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => i + 1).map((numero) =>
        prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaAbundante.id, numero } }),
      ),
    );

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (saldo-deadlock.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;
    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (saldo-deadlock.test)" } });
    tipoClienteId = tipoCliente.id;

    const paquete = await prismaRaw.paquete.create({ data: { empresaId, nombre: "Combo (saldo-deadlock.test)" } });
    paqueteId = paquete.id;
    await prismaRaw.paquetePlataforma.create({ data: { empresaId, paqueteId, plataformaId: plataformaEscasaId, cantidadPantallas: 1 } });
    await prismaRaw.paquetePlataforma.create({ data: { empresaId, paqueteId, plataformaId: plataformaAbundanteId, cantidadPantallas: 1 } });
    await prismaRaw.precio.create({ data: { empresaId, paqueteId, duracionId, tipoClienteId, precioVenta: "20000", costo: "10000" } });
    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "PAQUETE", contenido: "{{codigoCompra}} {{paquete}}\n{{listaCuentas}}" },
    });
  });

  afterAll(async () => {
    await prismaRaw.movimientoSaldo.deleteMany({ where: { empresaId } });
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

  it("10 compras de paquete en paralelo, mismo revendedor: ni deadlock ni doble cobro — el bloqueo de Usuario serializa, exactamente 2 ok y el ledger cuadra", async () => {
    const inicio = Date.now();
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () =>
        prismaParaEmpresa(empresaId).$transaction((tx) =>
          realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "PAQUETE", paqueteId, duracionId, tipoClienteId }),
        ),
      ),
    );
    const duracionMs = Date.now() - inicio;
    // Un deadlock real (Postgres 40P01) aborta una de las transacciones en
    // conflicto en vez de simplemente hacerla esperar: si el orden de
    // bloqueo (Usuario antes que Pantallas — ver CLAUDE.md y
    // lib/bloqueo-usuario.ts) se invirtiera en algún camino, esta prueba
    // fallaría por un error de Postgres lanzado desde Promise.all, no por
    // un cuelgue. El límite de tiempo es solo una red de seguridad contra
    // un bloqueo colgado real (ningún deadlock debería tardar 20s).
    expect(duracionMs).toBeLessThan(20000);

    const ok = resultados.filter((r) => r.tipo === "ok");
    const sinInventario = resultados.filter((r) => r.tipo === "inventario_insuficiente");
    expect(ok).toHaveLength(2); // limitado por la plataforma escasa (2 pantallas)
    expect(sinInventario).toHaveLength(8);

    const usuarioFinal = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorId } });
    const movimientos = await prismaRaw.movimientoSaldo.findMany({
      where: { usuarioId: vendedorId },
      orderBy: { createdAt: "asc" },
    });
    expect(movimientos).toHaveLength(2); // solo se cobraron las 2 que de verdad completaron
    for (const m of movimientos) {
      expect(m.tipo).toBe("CONSUMO");
      expect(new Prisma.Decimal(m.monto).equals(-20000)).toBe(true);
    }

    // Cuadre de ledger: saldo final == saldo inicial + suma de movimientos,
    // y el saldoResultante del último movimiento coincide con la fila.
    const sumaMovimientos = movimientos.reduce((acc, m) => acc.plus(m.monto), new Prisma.Decimal(0));
    expect(new Prisma.Decimal("1000000").plus(sumaMovimientos).equals(usuarioFinal.saldo)).toBe(true);
    expect(new Prisma.Decimal(movimientos[1]!.saldoResultante).equals(usuarioFinal.saldo)).toBe(true);

    // Todo o nada por venta (R2): la plataforma abundante nunca tiene más
    // VentaDetalle huérfanos que compras completas.
    const detallesAbundante = await prismaRaw.ventaDetalle.findMany({ where: { empresaId, plataformaId: plataformaAbundanteId } });
    expect(detallesAbundante).toHaveLength(2);
  });
});

describe("realizarVenta (Saldo) — rollback: falla de inventario después de pasar la verificación de saldo no cobra nada", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa saldo-rollback (ventas-saldo.test)", prefijoCodigo: "SLR" },
    });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-saldo-rollback-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Revendedor",
        rol: "VENDEDOR",
        usaSaldo: true,
        saldo: "50000",
      },
    });
    vendedorId = vendedor.id;

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (saldo-rollback.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;
    // Cuenta sin ninguna pantalla: el saldo alcanza de sobra, pero el
    // inventario es cero a propósito y de forma determinista (no depende de
    // agotar inventario con una venta previa).
    await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "saldo-rollback@ventas.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (saldo-rollback.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;
    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (saldo-rollback.test)" } });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "10000", costo: "4000" },
    });
    await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "UNIDAD", contenido: "{{codigoCompra}}" } });
  });

  afterAll(async () => {
    await prismaRaw.movimientoSaldo.deleteMany({ where: { empresaId } });
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

  it("saldo suficiente pero sin pantallas libres: inventario_insuficiente, saldo intacto, sin movimiento huérfano", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }),
    );
    expect(resultado.tipo).toBe("inventario_insuficiente");

    const usuarioFinal = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorId } });
    expect(new Prisma.Decimal(usuarioFinal.saldo).equals(50000)).toBe(true); // intacto

    const movimientos = await prismaRaw.movimientoSaldo.findMany({ where: { usuarioId: vendedorId } });
    expect(movimientos).toHaveLength(0); // ningún movimiento huérfano
  });
});

describe("realizarVenta (Saldo) — EMPLEADO: camino de venta sin ningún cambio, sin importar la columna usaSaldo", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa saldo-empleado (ventas-saldo.test)", prefijoCodigo: "SLE" },
    });
    empresaId = empresa.id;

    // usaSaldo se fija en true A PROPÓSITO: la lógica de saldo es 100%
    // rol-driven (contexto.rol === Rol.VENDEDOR), nunca derivada de esta
    // columna. Un EMPLEADO con la columna vieja en true no debe activar el
    // camino de saldo — justo el bug que la división VENDEDOR/EMPLEADO vino
    // a evitar.
    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-saldo-empleado-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Empleado",
        rol: "EMPLEADO",
        usaSaldo: true,
      },
    });
    vendedorId = vendedor.id;

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (saldo-empleado.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;
    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "saldo-empleado@ventas.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 1 } });

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (saldo-empleado.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;
    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (saldo-empleado.test)" } });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "10000", costo: "4000" },
    });
    await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "UNIDAD", contenido: "{{codigoCompra}}" } });
  });

  afterAll(async () => {
    await prismaRaw.movimientoSaldo.deleteMany({ where: { empresaId } });
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

  it("vende normalmente, saldo nunca se verifica ni se mueve, saldo sigue en 0", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }),
    );
    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");

    const usuarioFinal = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorId } });
    expect(new Prisma.Decimal(usuarioFinal.saldo).equals(0)).toBe(true);
    // La columna sigue en true (nunca se tocó): la prueba es justamente que
    // no importa — el camino de saldo se decide por rol, no por esta columna.
    expect(usuarioFinal.usaSaldo).toBe(true);
    expect(usuarioFinal.rol).toBe("EMPLEADO");

    const movimientos = await prismaRaw.movimientoSaldo.findMany({ where: { usuarioId: vendedorId } });
    expect(movimientos).toHaveLength(0);
  });

  it("sin inventario para una segunda venta, falla por inventario, nunca por saldo (el camino de saldo no se activa para un EMPLEADO)", async () => {
    // La única pantalla ya se vendió en la prueba anterior. Si el camino de
    // saldo se activara por error para un empleado, el síntoma sería
    // "saldo_insuficiente" (saldo 0 < precio); el resultado correcto sigue
    // siendo el de siempre.
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }),
    );
    expect(resultado.tipo).toBe("inventario_insuficiente");
  });
});

describe("realizarVenta (Saldo) — cuadre de ledger: el saldo final es exactamente la suma de los movimientos", () => {
  let empresaId: string;
  let vendedorId: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa saldo-ledger (ventas-saldo.test)", prefijoCodigo: "SLL" },
    });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-saldo-ledger-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Revendedor",
        rol: "VENDEDOR",
        usaSaldo: true,
        saldo: "35000",
      },
    });
    vendedorId = vendedor.id;

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (saldo-ledger.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;
    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "saldo-ledger@ventas.test", password: cifrar("clave"), capacidadPantallas: 4 },
    });
    // 4 pantallas libres: las primeras 3 se cobran (saldo alcanza), la 4ª
    // queda libre a propósito para que la 4ª venta falle por SALDO, no por
    // inventario — aísla qué cuello de botella dispara el 409.
    await Promise.all(
      [1, 2, 3, 4].map((numero) => prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero } })),
    );

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (saldo-ledger.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;
    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (saldo-ledger.test)" } });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "10000", costo: "4000" },
    });
    await prismaRaw.plantillaMensaje.create({ data: { empresaId, tipo: "UNIDAD", contenido: "{{codigoCompra}}" } });
  });

  afterAll(async () => {
    await prismaRaw.movimientoSaldo.deleteMany({ where: { empresaId } });
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

  it("3 ventas secuenciales de 10000 contra un saldo inicial de 35000: saldo final 5000, 3 CONSUMO, cada saldoResultante cuadra paso a paso", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    for (let i = 0; i < 3; i++) {
      const resultado = await cliente.$transaction((tx) =>
        realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }),
      );
      expect(resultado.tipo).toBe("ok");
    }

    const usuarioFinal = await prismaRaw.usuario.findUniqueOrThrow({ where: { id: vendedorId } });
    expect(new Prisma.Decimal(usuarioFinal.saldo).equals(5000)).toBe(true);

    const movimientos = await prismaRaw.movimientoSaldo.findMany({
      where: { usuarioId: vendedorId },
      orderBy: { createdAt: "asc" },
    });
    expect(movimientos).toHaveLength(3);
    expect(movimientos.every((m) => m.tipo === "CONSUMO")).toBe(true);

    // Cuadre global: saldo inicial + suma de movimientos == saldo actual de
    // la fila, y el saldoResultante del último movimiento es exactamente esa
    // misma fila — nunca se reescribe un movimiento (R3), así que el valor
    // de auditoría y el valor en vivo nunca pueden desincronizarse.
    const sumaMovimientos = movimientos.reduce((acc, m) => acc.plus(m.monto), new Prisma.Decimal(0));
    expect(new Prisma.Decimal("35000").plus(sumaMovimientos).equals(usuarioFinal.saldo)).toBe(true);
    expect(new Prisma.Decimal(movimientos[2]!.saldoResultante).equals(usuarioFinal.saldo)).toBe(true);

    // Cuadre paso a paso: no solo el total final, cada parada intermedia.
    expect(new Prisma.Decimal(movimientos[0]!.saldoResultante).equals(25000)).toBe(true);
    expect(new Prisma.Decimal(movimientos[1]!.saldoResultante).equals(15000)).toBe(true);
    expect(new Prisma.Decimal(movimientos[2]!.saldoResultante).equals(5000)).toBe(true);

    // Una 4ª venta ya no alcanza (saldo 5000 < precio 10000): saldo_insuficiente,
    // no inventario (la pantalla #4 quedó libre a propósito).
    const cuarto = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }),
    );
    expect(cuarto.tipo).toBe("saldo_insuficiente");
  });
});
