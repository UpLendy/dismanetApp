// Prueba del script de reparación uno-solo-vez ("camino del dinero", punto
// 7). prismaRaw: arma la fixture directamente, fuera de cualquier contexto
// de empresa autenticado — mismo patrón que ventas.test.ts/garantias.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { cifrar } from "./cifrado.ts";
import { realizarVenta } from "./ventas.ts";
import { realizarGarantiaExterna } from "./garantias.ts";
import { repararCostosHistoricosDeEmpresa } from "./reparar-costos-historicos.ts";

describe("repararCostosHistoricosDeEmpresa", () => {
  let empresaId: string;
  let vendedorId: string;
  let duracionId: string;
  let tipoClienteId: string;

  let plataformaUnidadId: string;
  let plataformaPaqueteId: string;
  let plataformaSinCostoId: string;
  let plataformaConCostoRealId: string;

  let paqueteId: string;

  let ventaUnidadId: string;
  let ventaPaqueteId: string;
  let ventaSinCostoDeterminableId: string;
  let ventaConCostoRealId: string;
  let ventaExternaId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa reparación costos (test)", prefijoCodigo: "RCH" },
    });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-rch-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Empleado",
        rol: "EMPLEADO",
      },
    });
    vendedorId = vendedor.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (rch.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (rch.test)" } });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.plantillaMensaje.create({
      data: {
        empresaId,
        tipo: "UNIDAD",
        contenido: "Código: {{codigoCompra}} | {{plataforma}} | {{correo}} | {{clave}} | {{perfil}} | {{pin}} | Vence: {{fechaVencimiento}} | {{precio}}",
      },
    });
    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "PAQUETE", contenido: "Código: {{codigoCompra}} | {{paquete}}\n{{listaCuentas}}\nVence: {{fechaVencimiento}} | {{precio}}" },
    });

    // --- Caso 1: venta UNIDAD vendida sin CostoPlataforma (costo = 0). ---
    const plataformaUnidad = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (rch.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaUnidadId = plataformaUnidad.id;
    const cuentaUnidad = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaUnidadId, correo: "u@rch.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaUnidad.id, numero: 1 } });
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: plataformaUnidadId, duracionId, tipoClienteId, precioVenta: "15000", costo: "0" },
    });

    // --- Caso 2: paquete con 2 pantallas de la MISMA plataforma, vendido sin
    // CostoPlataforma (costo = 0). Prueba obligatoria del punto 9: costo de
    // paquete = suma de componentes × pantallas.
    const plataformaPaquete = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ (rch.test)", capacidadPantallas: 2, usaPerfilPin: false },
    });
    plataformaPaqueteId = plataformaPaquete.id;
    const cuentaPaquete = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaPaqueteId, correo: "p@rch.test", password: cifrar("clave"), capacidadPantallas: 2 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaPaquete.id, numero: 1 } });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaPaquete.id, numero: 2 } });

    const paquete = await prismaRaw.paquete.create({ data: { empresaId, nombre: "Combo (rch.test)" } });
    paqueteId = paquete.id;
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId, plataformaId: plataformaPaqueteId, cantidadPantallas: 2 },
    });
    await prismaRaw.precio.create({
      data: { empresaId, paqueteId, duracionId, tipoClienteId, precioVenta: "20000", costo: "0" },
    });

    // --- Caso 3: venta UNIDAD sin CostoPlataforma, y SIGUE sin tenerlo hoy
    // (no determinable). ---
    const plataformaSinCosto = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "HBO (rch.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaSinCostoId = plataformaSinCosto.id;
    const cuentaSinCosto = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaSinCostoId, correo: "h@rch.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaSinCosto.id, numero: 1 } });
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: plataformaSinCostoId, duracionId, tipoClienteId, precioVenta: "9000", costo: "0" },
    });

    // --- Caso 4: venta UNIDAD vendida CON CostoPlataforma real — nunca debe
    // tocarse (R3 — "nunca una que ya tenga costo real"). ---
    const plataformaConCostoReal = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Prime (rch.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaConCostoRealId = plataformaConCostoReal.id;
    const cuentaConCostoReal = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaConCostoRealId, correo: "pr@rch.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaConCostoReal.id, numero: 1 } });
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: plataformaConCostoRealId, duracionId, tipoClienteId, precioVenta: "10000", costo: "0" },
    });
    await prismaRaw.costoPlataforma.create({
      data: { empresaId, plataformaId: plataformaConCostoRealId, duracionId, costo: "3000" },
    });

    // --- Caso 5 (F4.8): garantía externa — su Venta queda esExterna: true,
    // costo = 0 A PROPÓSITO (no por falta de dato). CostoPlataforma SÍ
    // existe para esta plataforma/duración desde antes: si el script la
    // tocara, sería porque ignoró esExterna, no porque le faltara costo.
    const plataformaExterna = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Externa (rch.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    const cuentaExterna = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: plataformaExterna.id, correo: "ext@rch.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaExterna.id, numero: 1 } });
    await prismaRaw.costoPlataforma.create({
      data: { empresaId, plataformaId: plataformaExterna.id, duracionId, costo: "7000" },
    });

    const cliente = prismaParaEmpresa(empresaId);

    const resultadoExterna = await cliente.$transaction((tx) =>
      realizarGarantiaExterna(tx, empresaId, vendedorId, {
        plataformaId: plataformaExterna.id,
        duracionId,
        fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    );
    if (resultadoExterna.tipo !== "ok") throw new Error(`esperaba ok (externa), llegó ${resultadoExterna.tipo}`);
    ventaExternaId = resultadoExterna.ventaDetalleReemplazo.ventaId;

    const ventaExternaFixture = await prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaExternaId } });
    if (!ventaExternaFixture.esExterna || !ventaExternaFixture.costo.isZero()) {
      throw new Error("fixture inválida: la venta externa no quedó esExterna=true con costo 0");
    }

    const ventaUnidad = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformas: [plataformaUnidadId], duracionId, tipoClienteId }),
    );
    if (ventaUnidad.tipo !== "ok") throw new Error(`esperaba ok (unidad), llegó ${ventaUnidad.tipo}`);
    ventaUnidadId = ventaUnidad.venta.id;

    const ventaPaquete = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "PAQUETE", paqueteId, duracionId, tipoClienteId }),
    );
    if (ventaPaquete.tipo !== "ok") throw new Error(`esperaba ok (paquete), llegó ${ventaPaquete.tipo}`);
    ventaPaqueteId = ventaPaquete.venta.id;

    const ventaSinCosto = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformas: [plataformaSinCostoId], duracionId, tipoClienteId }),
    );
    if (ventaSinCosto.tipo !== "ok") throw new Error(`esperaba ok (sin costo), llegó ${ventaSinCosto.tipo}`);
    ventaSinCostoDeterminableId = ventaSinCosto.venta.id;

    const ventaConCostoReal = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformas: [plataformaConCostoRealId], duracionId, tipoClienteId }),
    );
    if (ventaConCostoReal.tipo !== "ok") throw new Error(`esperaba ok (costo real), llegó ${ventaConCostoReal.tipo}`);
    ventaConCostoRealId = ventaConCostoReal.venta.id;

    // Confirma que las ventas de los casos 1-3 de verdad quedaron en costo 0
    // antes de seguir — si esto falla, el resto de la prueba no dice nada.
    const [v1, v2, v3] = await Promise.all([
      prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaUnidadId } }),
      prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaPaqueteId } }),
      prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaSinCostoDeterminableId } }),
    ]);
    if (!v1.costo.isZero() || !v2.costo.isZero() || !v3.costo.isZero()) {
      throw new Error("fixture inválida: las ventas de prueba no quedaron en costo 0");
    }

    // Ahora sí: el cliente carga sus costos reales HOY, después de vender.
    await prismaRaw.costoPlataforma.create({
      data: { empresaId, plataformaId: plataformaUnidadId, duracionId, costo: "6000" },
    });
    await prismaRaw.costoPlataforma.create({
      data: { empresaId, plataformaId: plataformaPaqueteId, duracionId, costo: "4000" },
    });
    // plataformaSinCostoId: a propósito, nunca se le carga costo.
  });

  afterAll(async () => {
    await prismaRaw.garantia.deleteMany({ where: { empresaId } });
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

  it("modo simulación: calcula el antes/después correcto y no escribe nada", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const reporte = await repararCostosHistoricosDeEmpresa(cliente, { aplicar: false });

    const filaUnidad = reporte.reparadas.find((f) => f.ventaId === ventaUnidadId);
    expect(filaUnidad).toBeDefined();
    expect(filaUnidad?.costoAntes).toBe("0");
    expect(filaUnidad?.costoDespues).toBe("6000");
    expect(filaUnidad?.utilidadAntes).toBe("15000");
    expect(filaUnidad?.utilidadDespues).toBe("9000");

    // Paquete: 2 pantallas de la misma plataforma, costo 4000 cada una ->
    // 8000 en total (un VentaDetalle por pantalla entregada, no la
    // composición actual del paquete).
    const filaPaquete = reporte.reparadas.find((f) => f.ventaId === ventaPaqueteId);
    expect(filaPaquete).toBeDefined();
    expect(filaPaquete?.costoDespues).toBe("8000");
    expect(filaPaquete?.utilidadDespues).toBe("12000");

    const noDeterminable = reporte.noDeterminables.find((f) => f.ventaId === ventaSinCostoDeterminableId);
    expect(noDeterminable).toBeDefined();

    // La venta con costo real nunca entra al reporte, ni como reparada ni
    // como no-determinable: el filtro de origen es costo = 0.
    expect(reporte.reparadas.some((f) => f.ventaId === ventaConCostoRealId)).toBe(false);
    expect(reporte.noDeterminables.some((f) => f.ventaId === ventaConCostoRealId)).toBe(false);

    // Simulación: nada se escribió.
    const [v1, v2, v3, v4] = await Promise.all([
      prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaUnidadId } }),
      prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaPaqueteId } }),
      prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaSinCostoDeterminableId } }),
      prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaConCostoRealId } }),
    ]);
    expect(v1.costo.isZero()).toBe(true);
    expect(v2.costo.isZero()).toBe(true);
    expect(v3.costo.isZero()).toBe(true);
    expect(v4.costo.toString()).toBe("3000");
  });

  it("--aplicar: escribe costo y utilidad, deja intacta la venta no determinable, y es idempotente", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const primero = await repararCostosHistoricosDeEmpresa(cliente, { aplicar: true });
    expect(primero.reparadas).toHaveLength(2); // unidad + paquete
    expect(primero.noDeterminables).toHaveLength(1);

    // F4.8 — la venta externa no se considera: ni reparada ni no
    // determinable. No es un caso sin determinar, es un caso que no aplica
    // (su pérdida ya vive en Garantia.costoAsumido).
    expect(primero.reparadas.some((f) => f.ventaId === ventaExternaId)).toBe(false);
    expect(primero.noDeterminables.some((f) => f.ventaId === ventaExternaId)).toBe(false);
    const ventaExternaDespues = await prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaExternaId } });
    expect(ventaExternaDespues.costo.isZero()).toBe(true);

    const [v1, v2, v3] = await Promise.all([
      prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaUnidadId } }),
      prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaPaqueteId } }),
      prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaSinCostoDeterminableId } }),
    ]);
    expect(v1.costo.toString()).toBe("6000");
    expect(v1.utilidad.toString()).toBe("9000");
    expect(v2.costo.toString()).toBe("8000");
    expect(v2.utilidad.toString()).toBe("12000");
    // No determinable: se deja exactamente como estaba.
    expect(v3.costo.isZero()).toBe(true);

    // Idempotente: ya reparada, costo != 0 -> sale del filtro de origen.
    const segundo = await repararCostosHistoricosDeEmpresa(cliente, { aplicar: true });
    expect(segundo.reparadas.some((f) => f.ventaId === ventaUnidadId)).toBe(false);
    expect(segundo.reparadas.some((f) => f.ventaId === ventaPaqueteId)).toBe(false);
    // La no determinable sigue apareciendo (sigue en costo 0) hasta que se
    // cargue su CostoPlataforma — correrlo de nuevo no cambia nada de ella.
    expect(segundo.noDeterminables.some((f) => f.ventaId === ventaSinCostoDeterminableId)).toBe(true);

    const v1Releido = await prismaRaw.venta.findUniqueOrThrow({ where: { id: ventaUnidadId } });
    expect(v1Releido.costo.toString()).toBe("6000");
  });
});
