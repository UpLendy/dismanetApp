import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
// prismaRaw en este archivo: arma la fixture directamente, fuera de cualquier
// contexto de empresa autenticado — mismo patrón que ventas.test.ts.
import { prismaRaw } from "./prisma.ts";
import { prismaParaEmpresa } from "./prisma-empresa.ts";
import { cifrar, descifrar } from "./cifrado.ts";
import { realizarVenta } from "./ventas.ts";
import { realizarGarantia, realizarGarantiaExterna, GarantiaYaReemplazadaError } from "./garantias.ts";
import { pantallasDisponibles } from "./pantallas.ts";

describe("realizarGarantia", () => {
  let empresaId: string;
  let vendedorId: string;
  let adminId: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa garantías (garantias.test)", prefijoCodigo: "GAR" },
    });
    empresaId = empresa.id;

    const vendedor = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `vendedor-garantias-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Empleado",
        rol: "EMPLEADO",
      },
    });
    vendedorId = vendedor.id;

    const admin = await prismaRaw.usuario.create({
      data: {
        empresaId,
        email: `admin-garantias-${randomUUID()}@test.local`,
        passwordHash: "hash",
        nombre: "Admin",
        rol: "ADMIN",
      },
    });
    adminId = admin.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (garantias.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (garantias.test)" } });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.plantillaMensaje.create({
      data: {
        empresaId,
        tipo: "UNIDAD",
        contenido:
          "Código: {{codigoCompra}} | {{plataforma}} | {{correo}} | {{clave}} | {{perfil}} | {{pin}} | Vence: {{fechaVencimiento}}",
      },
    });
    await prismaRaw.plantillaMensaje.create({
      data: {
        empresaId,
        tipo: "PAQUETE",
        contenido: "Código: {{codigoCompra}} | {{paquete}}\n{{listaCuentas}}\nVence: {{fechaVencimiento}}",
      },
    });
  });

  afterAll(async () => {
    await prismaRaw.garantia.deleteMany({ where: { empresaId } });
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.movimientoSaldo.deleteMany({ where: { empresaId } });
    await prismaRaw.plantillaMensaje.deleteMany({ where: { empresaId } });
    await prismaRaw.costoPlataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.precio.deleteMany({ where: { empresaId } });
    // Si una prueba falla antes de llegar a su propia limpieza (ej. PAQUETE),
    // estas filas quedan colgando y el delete de plataforma más abajo choca
    // contra su llave foránea. Se limpian aquí también por robustez.
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

  // Cada prueba arma su PROPIA plataforma, con su propio Precio. R5 libera la
  // pantalla de una venta anulada (queda "libre" otra vez), así que una
  // plataforma compartida entre pruebas deja inventario colgado de una
  // prueba disponible para la siguiente — exactamente lo que necesita NO
  // pasar en la prueba de "sin_inventario". Aislar por plataforma elimina
  // ese acoplamiento sin depender del orden de ejecución.
  async function crearPlataforma(sufijo: string) {
    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: `Netflix (garantias.test ${sufijo})`, capacidadPantallas: 1, usaPerfilPin: true },
    });
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: plataforma.id, duracionId, tipoClienteId, precioVenta: "15000", costo: "0" },
    });
    return plataforma.id;
  }

  // Crea una cuenta+pantalla nuevas y una venta UNIDAD de 30 días sobre esa
  // pantalla, para tener un VentaDetalle "original" fresco en una
  // plataforma dedicada a esta prueba.
  async function crearVentaConUnaPantalla(sufijo: string) {
    const plataformaId = await crearPlataforma(sufijo);
    const cuenta = await prismaRaw.cuenta.create({
      data: {
        empresaId,
        plataformaId,
        correo: `original-${sufijo}@garantias.test`,
        password: cifrar("clave-original"),
        capacidadPantallas: 1,
      },
    });
    await prismaRaw.pantalla.create({
      data: { empresaId, cuentaId: cuenta.id, numero: 1, perfil: "Perfil original", pin: cifrar("1111") },
    });

    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "UNIDAD", plataformas: [plataformaId], duracionId, tipoClienteId }),
    );
    if (resultado.tipo !== "ok") throw new Error(`esperaba ok, llegó ${resultado.tipo}`);

    const detalleOriginal = await prismaRaw.ventaDetalle.findFirstOrThrow({ where: { ventaId: resultado.venta.id } });
    return { venta: resultado.venta, detalleOriginal, cuenta, plataformaId };
  }

  async function crearCuentaConPantallaLibre(sufijo: string, plataformaId: string) {
    const cuenta = await prismaRaw.cuenta.create({
      data: {
        empresaId,
        plataformaId,
        correo: `reemplazo-${sufijo}@garantias.test`,
        password: cifrar("clave-reemplazo"),
        capacidadPantallas: 1,
      },
    });
    await prismaRaw.pantalla.create({
      data: { empresaId, cuentaId: cuenta.id, numero: 1, perfil: "Perfil nuevo", pin: cifrar("2222") },
    });
    return cuenta;
  }

  it("reemplaza la pantalla dañada: hereda vencimiento, copia credenciales de la cuenta nueva, desactiva la dañada y no toca el original (R3)", async () => {
    const { detalleOriginal, plataformaId } = await crearVentaConUnaPantalla("basico");
    await crearCuentaConPantallaLibre("basico", plataformaId);

    const vencimientoOriginal = detalleOriginal.fechaVencimiento;

    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarGarantia(tx, empresaId, adminId, detalleOriginal.id, "Pantalla congelada"),
    );

    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");

    // Hereda el vencimiento del original, no se recalcula (sección 3).
    expect(resultado.ventaDetalleReemplazo.fechaVencimiento.getTime()).toBe(vencimientoOriginal.getTime());
    expect(resultado.ventaDetalleReemplazo.ventaId).toBe(detalleOriginal.ventaId);
    expect(resultado.ventaDetalleReemplazo.id).not.toBe(detalleOriginal.id);
    expect(descifrar(resultado.ventaDetalleReemplazo.passwordCuenta)).toBe("clave-reemplazo");
    expect(resultado.ventaDetalleReemplazo.perfil).toBe("Perfil nuevo");

    // R3: el renglón original no se toca nunca.
    const originalReleido = await prismaRaw.ventaDetalle.findUniqueOrThrow({ where: { id: detalleOriginal.id } });
    expect(originalReleido.correoCuenta).toBe(detalleOriginal.correoCuenta);
    expect(originalReleido.fechaVencimiento.getTime()).toBe(vencimientoOriginal.getTime());
    expect(originalReleido.passwordCuenta).toBe(detalleOriginal.passwordCuenta);

    // La pantalla dañada sale del inventario; la cuenta sigue activa.
    const pantallaDañada = await prismaRaw.pantalla.findUniqueOrThrow({ where: { id: detalleOriginal.pantallaId } });
    expect(pantallaDañada.activa).toBe(false);
    const cuentaOriginal = await prismaRaw.cuenta.findUniqueOrThrow({ where: { id: detalleOriginal.cuentaId } });
    expect(cuentaOriginal.activa).toBe(true);

    // El mensaje anuncia el reemplazo y lleva los datos de la cuenta nueva.
    expect(resultado.garantia.mensajeGenerado).toContain("*Reemplazo de pantalla*");
    expect(resultado.garantia.mensajeGenerado).toContain("clave-reemplazo");
    expect(resultado.garantia.mensajeGenerado).toContain("Perfil nuevo");

    // El saldo no se toca en absoluto.
    const movimientos = await prismaRaw.movimientoSaldo.findMany({ where: { ventaId: detalleOriginal.ventaId } });
    expect(movimientos).toHaveLength(0);

    // Sin CostoPlataforma configurado para esta plataforma+duración, el
    // costo asumido cae a cero (no bloquea la garantía por un dato de
    // configuración faltante — mismo criterio que una venta).
    expect(resultado.garantia.costoAsumido.toString()).toBe("0");
  });

  it("costoAsumido viene de CostoPlataforma (plataforma+duración), no de Precio.costo", async () => {
    const { detalleOriginal, plataformaId } = await crearVentaConUnaPantalla("costo-real");
    await crearCuentaConPantallaLibre("costo-real", plataformaId);
    await prismaRaw.costoPlataforma.create({
      data: { empresaId, plataformaId, duracionId, costo: "4500" },
    });

    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarGarantia(tx, empresaId, adminId, detalleOriginal.id, "Pantalla con costo real"),
    );

    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");
    expect(resultado.garantia.costoAsumido.toString()).toBe("4500");
  });

  it("reemplazo al día 8 de una venta de 30 días conserva el vencimiento original (día 30), no uno recalculado desde hoy", async () => {
    const { detalleOriginal, venta, plataformaId } = await crearVentaConUnaPantalla("dia8");
    await crearCuentaConPantallaLibre("dia8", plataformaId);

    // Simula que han pasado 8 días desde la venta: la fechaVenta se mueve
    // hacia atrás, pero fechaVencimiento (día 30 real) queda igual.
    const hace8Dias = new Date(venta.fechaVenta.getTime() - 8 * 24 * 60 * 60 * 1000);
    await prismaRaw.venta.update({ where: { id: venta.id }, data: { fechaVenta: hace8Dias } });

    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarGarantia(tx, empresaId, adminId, detalleOriginal.id, null),
    );

    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");
    expect(resultado.ventaDetalleReemplazo.fechaVencimiento.getTime()).toBe(detalleOriginal.fechaVencimiento.getTime());

    // El vencimiento sigue siendo ~30 días desde la venta original, no ~22
    // (30 - 8) ni recalculado desde "hoy".
    const diasHastaVencimiento =
      (resultado.ventaDetalleReemplazo.fechaVencimiento.getTime() - venta.fechaVenta.getTime()) /
      (24 * 60 * 60 * 1000);
    expect(diasHastaVencimiento).toBeGreaterThan(29);
    expect(diasHastaVencimiento).toBeLessThan(31);
  });

  it("R5: la pantalla dañada ya no aparece en pantallasDisponibles tras la garantía", async () => {
    const { detalleOriginal, plataformaId } = await crearVentaConUnaPantalla("disponibilidad");
    await crearCuentaConPantallaLibre("disponibilidad", plataformaId);

    const cliente = prismaParaEmpresa(empresaId);

    const antes = await pantallasDisponibles(cliente, plataformaId);
    expect(antes.map((p) => p.id)).toContain(detalleOriginal.pantallaId);

    await cliente.$transaction((tx) => realizarGarantia(tx, empresaId, adminId, detalleOriginal.id, null));

    const despues = await pantallasDisponibles(cliente, plataformaId);
    expect(despues.map((p) => p.id)).not.toContain(detalleOriginal.pantallaId);
  });

  it("venta_anulada: no se puede pedir garantía sobre una venta ya anulada", async () => {
    const { detalleOriginal, venta } = await crearVentaConUnaPantalla("anulada");
    await prismaRaw.venta.update({ where: { id: venta.id }, data: { anulada: true } });

    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarGarantia(tx, empresaId, adminId, detalleOriginal.id, null),
    );
    expect(resultado.tipo).toBe("venta_anulada");

    const detalles = await prismaRaw.ventaDetalle.findMany({ where: { ventaId: venta.id } });
    expect(detalles).toHaveLength(1); // nada se entregó
  });

  it("ya_reemplazada: una segunda garantía secuencial sobre la misma pantalla es un error de negocio, no una segunda entrega", async () => {
    const { detalleOriginal, plataformaId } = await crearVentaConUnaPantalla("doble-secuencial");
    await crearCuentaConPantallaLibre("doble-secuencial-1", plataformaId);
    await crearCuentaConPantallaLibre("doble-secuencial-2", plataformaId);

    const cliente = prismaParaEmpresa(empresaId);
    const primero = await cliente.$transaction((tx) =>
      realizarGarantia(tx, empresaId, adminId, detalleOriginal.id, null),
    );
    expect(primero.tipo).toBe("ok");

    const segundo = await cliente.$transaction((tx) =>
      realizarGarantia(tx, empresaId, adminId, detalleOriginal.id, null),
    );
    expect(segundo.tipo).toBe("ya_reemplazada");

    const reemplazos = await prismaRaw.garantia.findMany({ where: { ventaDetalleOriginalId: detalleOriginal.id } });
    expect(reemplazos).toHaveLength(1); // solo una pantalla entregada
  });

  it("doble garantía concurrente: exactamente una transacción gana, la otra lanza GarantiaYaReemplazadaError (no 500 genérico) y solo una pantalla queda entregada", async () => {
    const { detalleOriginal, plataformaId } = await crearVentaConUnaPantalla("doble-concurrente");
    // Dos pantallas libres: suficientes para que AMBAS transacciones
    // concurrentes alcancen a bloquear una pantalla distinta y lleguen hasta
    // el create() de Garantia, donde la restricción única decide quién gana.
    await crearCuentaConPantallaLibre("doble-concurrente-1", plataformaId);
    await crearCuentaConPantallaLibre("doble-concurrente-2", plataformaId);

    const cliente = prismaParaEmpresa(empresaId);
    const resultados = await Promise.allSettled([
      cliente.$transaction((tx) => realizarGarantia(tx, empresaId, adminId, detalleOriginal.id, "intento A")),
      cliente.$transaction((tx) => realizarGarantia(tx, empresaId, adminId, detalleOriginal.id, "intento B")),
    ]);

    const cumplidas = resultados.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<unknown>[];
    const rechazadas = resultados.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(cumplidas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    expect(rechazadas[0]?.reason).toBeInstanceOf(GarantiaYaReemplazadaError);

    // El ROLLBACK de la transacción perdedora deshizo su bloqueo de pantalla,
    // su VentaDetalle y su desactivación de Pantalla: solo una garantía y un
    // reemplazo quedaron en la base.
    const garantiasCreadas = await prismaRaw.garantia.findMany({ where: { ventaDetalleOriginalId: detalleOriginal.id } });
    expect(garantiasCreadas).toHaveLength(1);
    const detallesDeLaVenta = await prismaRaw.ventaDetalle.findMany({ where: { ventaId: detalleOriginal.ventaId } });
    expect(detallesDeLaVenta).toHaveLength(2); // original + exactamente un reemplazo
  });

  it("sin_inventario: sin pantalla libre de esa plataforma, falla con un resultado de negocio claro (no encola, no ofrece otra plataforma)", async () => {
    const { detalleOriginal } = await crearVentaConUnaPantalla("sin-inventario");
    // A propósito: no se crea ninguna cuenta/pantalla libre adicional, y la
    // plataforma es exclusiva de esta prueba, así que no hay inventario
    // colgado de otra prueba que la contamine.

    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarGarantia(tx, empresaId, adminId, detalleOriginal.id, null),
    );

    expect(resultado.tipo).toBe("sin_inventario");
    if (resultado.tipo === "sin_inventario") {
      expect(resultado.nombrePlataforma).toBe("Netflix (garantias.test sin-inventario)");
    }

    // Nada se escribió: la pantalla dañada original sigue activa y servible.
    const pantallaOriginal = await prismaRaw.pantalla.findUniqueOrThrow({ where: { id: detalleOriginal.pantallaId } });
    expect(pantallaOriginal.activa).toBe(true);
    const detalles = await prismaRaw.ventaDetalle.findMany({ where: { ventaId: detalleOriginal.ventaId } });
    expect(detalles).toHaveLength(1);
  });

  it("no_encontrado: un ventaDetalleOriginalId inexistente no revienta, devuelve un resultado de negocio", async () => {
    const cliente = prismaParaEmpresa(empresaId);
    const resultado = await cliente.$transaction((tx) =>
      realizarGarantia(tx, empresaId, adminId, "id-que-no-existe", null),
    );
    expect(resultado.tipo).toBe("no_encontrado");
  });

  it("PAQUETE: el mensaje de reemplazo usa la plantilla de PAQUETE con un solo bloque — el de la plataforma reemplazada", async () => {
    const plataformaNetflix = await crearPlataforma("paquete-netflix");
    const disney = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney+ (garantias.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    const cuentaNetflixPaquete = await prismaRaw.cuenta.create({
      data: {
        empresaId,
        plataformaId: plataformaNetflix,
        correo: "netflix-paquete@garantias.test",
        password: cifrar("clave-netflix-combo"),
        capacidadPantallas: 1,
      },
    });
    await prismaRaw.pantalla.create({
      data: { empresaId, cuentaId: cuentaNetflixPaquete.id, numero: 1, perfil: "Perfil combo", pin: cifrar("3333") },
    });
    const cuentaDisney = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId: disney.id, correo: "disney-paquete@garantias.test", password: cifrar("clave-disney-combo"), capacidadPantallas: 1 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuentaDisney.id, numero: 1 } });

    const paquete = await prismaRaw.paquete.create({ data: { empresaId, nombre: "Combo (garantias.test)" } });
    await prismaRaw.paquetePlataforma.create({
      data: { empresaId, paqueteId: paquete.id, plataformaId: plataformaNetflix, cantidadPantallas: 1 },
    });
    await prismaRaw.paquetePlataforma.create({ data: { empresaId, paqueteId: paquete.id, plataformaId: disney.id, cantidadPantallas: 1 } });
    await prismaRaw.precio.create({ data: { empresaId, paqueteId: paquete.id, duracionId, tipoClienteId, precioVenta: "25000", costo: "0" } });

    const cliente = prismaParaEmpresa(empresaId);
    const ventaPaquete = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaId, vendedorId, { tipoVenta: "PAQUETE", paqueteId: paquete.id, duracionId, tipoClienteId }),
    );
    if (ventaPaquete.tipo !== "ok") throw new Error(`esperaba ok, llegó ${ventaPaquete.tipo}`);

    const detalleNetflix = await prismaRaw.ventaDetalle.findFirstOrThrow({
      where: { ventaId: ventaPaquete.venta.id, plataformaId: plataformaNetflix },
    });

    await crearCuentaConPantallaLibre("paquete-reemplazo", plataformaNetflix);

    const resultado = await cliente.$transaction((tx) =>
      realizarGarantia(tx, empresaId, adminId, detalleNetflix.id, null),
    );
    expect(resultado.tipo).toBe("ok");
    if (resultado.tipo !== "ok") throw new Error("esperaba ok");

    expect(resultado.garantia.mensajeGenerado).toContain("*Reemplazo de pantalla*");
    expect(resultado.garantia.mensajeGenerado).toContain("Netflix (garantias.test paquete-netflix)");
    expect(resultado.garantia.mensajeGenerado).toContain("clave-reemplazo");
    // Solo el bloque de la plataforma reemplazada: Disney+ (la otra mitad
    // del paquete, intacta) no debe aparecer en el mensaje de garantía.
    expect(resultado.garantia.mensajeGenerado).not.toContain("Disney+");
    expect(resultado.garantia.mensajeGenerado).not.toContain("clave-disney-combo");

    await prismaRaw.garantia.deleteMany({ where: { ventaDetalleOriginalId: detalleNetflix.id } });
    await prismaRaw.ventaDetalle.deleteMany({ where: { ventaId: ventaPaquete.venta.id } });
    await prismaRaw.venta.delete({ where: { id: ventaPaquete.venta.id } });
    await prismaRaw.precio.deleteMany({ where: { paqueteId: paquete.id } });
    await prismaRaw.paquetePlataforma.deleteMany({ where: { paqueteId: paquete.id } });
    await prismaRaw.paquete.delete({ where: { id: paquete.id } });
    await prismaRaw.pantalla.deleteMany({ where: { cuentaId: { in: [cuentaNetflixPaquete.id, cuentaDisney.id] } } });
    await prismaRaw.cuenta.deleteMany({ where: { id: { in: [cuentaNetflixPaquete.id, cuentaDisney.id] } } });
    await prismaRaw.plataforma.delete({ where: { id: disney.id } });
  });

  // -------------------------------------------------------------------------
  // F4.3 — garantía de una venta hecha fuera del sistema: no hay VentaDetalle
  // original, así que se crea una Venta mínima `esExterna` en vez de volver
  // VentaDetalle.ventaId opcional (ver comentario en garantias.ts). Mismo
  // aislamiento por plataforma que el resto del archivo (crearPlataforma).
  // -------------------------------------------------------------------------
  describe("realizarGarantiaExterna", () => {
    async function crearPlataformaConCosto(sufijo: string, costo: string) {
      const plataformaId = await crearPlataforma(sufijo);
      await prismaRaw.costoPlataforma.create({ data: { empresaId, plataformaId, duracionId, costo } });
      return plataformaId;
    }

    it("entrega una pantalla del inventario y crea una Venta mínima esExterna: precio/costo/utilidad en cero, sin tipoCliente, Garantia sin VentaDetalle original", async () => {
      const plataformaId = await crearPlataformaConCosto("externa-ok", "9000");
      await crearCuentaConPantallaLibre("externa-ok", plataformaId);

      const fechaVencimiento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const cliente = prismaParaEmpresa(empresaId);
      const resultado = await cliente.$transaction((tx) =>
        realizarGarantiaExterna(tx, empresaId, adminId, {
          plataformaId,
          duracionId,
          fechaVencimiento,
          celularCliente: "3000000000",
          motivo: "Venta por WhatsApp",
        }),
      );

      expect(resultado.tipo).toBe("ok");
      if (resultado.tipo !== "ok") throw new Error("esperaba ok");

      const venta = await prismaRaw.venta.findUniqueOrThrow({ where: { id: resultado.ventaDetalleReemplazo.ventaId } });
      expect(venta.esExterna).toBe(true);
      expect(venta.tipoVenta).toBe("UNIDAD");
      expect(venta.tipoClienteId).toBeNull();
      expect(venta.nombreTipoCliente).toBe("Venta externa");
      expect(venta.precioVenta.toString()).toBe("0");
      expect(venta.costo.toString()).toBe("0");
      expect(venta.utilidad.toString()).toBe("0");
      expect(venta.vendedorId).toBe(adminId);

      expect(resultado.ventaDetalleReemplazo.fechaVencimiento.getTime()).toBe(fechaVencimiento.getTime());
      expect(resultado.ventaDetalleReemplazo.plataformaId).toBe(plataformaId);
      expect(descifrar(resultado.ventaDetalleReemplazo.passwordCuenta)).toBe("clave-reemplazo");

      expect(resultado.garantia.esExterna).toBe(true);
      expect(resultado.garantia.ventaDetalleOriginalId).toBeNull();
      expect(resultado.garantia.ventaDetalleReemplazoId).toBe(resultado.ventaDetalleReemplazo.id);
      expect(resultado.garantia.plataformaExternaId).toBe(plataformaId);
      expect(resultado.garantia.celularExterno).toBe("3000000000");
      expect(resultado.garantia.motivo).toBe("Venta por WhatsApp");
      // CostoPlataforma(plataformaId, duracionId) = 9000, no Precio (F4.3
      // no fija precio de venta) — este es el costo que se asume como
      // pérdida.
      expect(resultado.garantia.costoAsumido.toString()).toBe("9000");

      // El mensaje usa la plantilla UNIDAD de esta empresa de prueba (sin
      // marcador de precio, ver fixture arriba) con el aviso de reemplazo
      // antepuesto. La prueba de que precioVenta=0 nunca se renderiza como
      // "$0" vive en mensaje.test.ts (quitarBloquePrecioSiAplica) — aquí
      // solo se confirma que el camino completo no lo reintroduce.
      expect(resultado.garantia.mensajeGenerado).toContain("*Reemplazo de pantalla*");
      expect(resultado.garantia.mensajeGenerado).not.toContain("$0");
    });

    it("NO desactiva ninguna Pantalla — a diferencia de realizarGarantia normal, la pantalla entregada sigue activa y disponible para su propio ciclo de vencimiento", async () => {
      const plataformaId = await crearPlataformaConCosto("externa-sin-desactivar", "0");
      await crearCuentaConPantallaLibre("externa-sin-desactivar", plataformaId);

      const activasAntes = await prismaRaw.pantalla.count({
        where: { cuenta: { plataformaId }, activa: true },
      });

      const cliente = prismaParaEmpresa(empresaId);
      const resultado = await cliente.$transaction((tx) =>
        realizarGarantiaExterna(tx, empresaId, adminId, {
          plataformaId,
          duracionId,
          fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }),
      );
      expect(resultado.tipo).toBe("ok");

      const activasDespues = await prismaRaw.pantalla.count({
        where: { cuenta: { plataformaId }, activa: true },
      });
      expect(activasDespues).toBe(activasAntes);
    });

    it("sin inventario: no deja ninguna Venta ni VentaDetalle huérfanos (todo o nada)", async () => {
      const plataformaId = await crearPlataforma("externa-sin-inventario");
      // Ninguna cuenta/pantalla para esta plataforma: inventario cero.

      const ventasAntes = await prismaRaw.venta.count({ where: { empresaId } });
      const detallesAntes = await prismaRaw.ventaDetalle.count({ where: { empresaId } });

      const cliente = prismaParaEmpresa(empresaId);
      const resultado = await cliente.$transaction((tx) =>
        realizarGarantiaExterna(tx, empresaId, adminId, {
          plataformaId,
          duracionId,
          fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }),
      );

      expect(resultado.tipo).toBe("sin_inventario");

      const ventasDespues = await prismaRaw.venta.count({ where: { empresaId } });
      const detallesDespues = await prismaRaw.ventaDetalle.count({ where: { empresaId } });
      expect(ventasDespues).toBe(ventasAntes);
      expect(detallesDespues).toBe(detallesAntes);
    });

    it("plataforma inactiva: no_disponible, sin tocar inventario", async () => {
      const plataformaId = await crearPlataforma("externa-inactiva");
      await crearCuentaConPantallaLibre("externa-inactiva", plataformaId);
      await prismaRaw.plataforma.update({ where: { id: plataformaId }, data: { activa: false } });

      const cliente = prismaParaEmpresa(empresaId);
      const resultado = await cliente.$transaction((tx) =>
        realizarGarantiaExterna(tx, empresaId, adminId, {
          plataformaId,
          duracionId,
          fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }),
      );
      expect(resultado.tipo).toBe("no_disponible");
    });

    it("concurrencia (R2): con una sola pantalla libre, dos garantías externas simultáneas — una gana, la otra recibe sin_inventario", async () => {
      const plataformaId = await crearPlataforma("externa-concurrencia");
      await crearCuentaConPantallaLibre("externa-concurrencia", plataformaId);

      const cliente = prismaParaEmpresa(empresaId);
      const entrada = {
        plataformaId,
        duracionId,
        fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      const [resultadoA, resultadoB] = await Promise.all([
        cliente.$transaction((tx) => realizarGarantiaExterna(tx, empresaId, adminId, entrada)),
        cliente.$transaction((tx) => realizarGarantiaExterna(tx, empresaId, adminId, entrada)),
      ]);

      const tipos = [resultadoA.tipo, resultadoB.tipo].sort();
      expect(tipos).toEqual(["ok", "sin_inventario"]);
    });

    it("garantía de la garantía: la pantalla entregada por una garantía externa se puede reemplazar con realizarGarantia normal", async () => {
      const plataformaId = await crearPlataformaConCosto("externa-garantia-de-garantia", "0");
      await crearCuentaConPantallaLibre("externa-garantia-de-garantia-1", plataformaId);

      const cliente = prismaParaEmpresa(empresaId);
      const externa = await cliente.$transaction((tx) =>
        realizarGarantiaExterna(tx, empresaId, adminId, {
          plataformaId,
          duracionId,
          fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }),
      );
      expect(externa.tipo).toBe("ok");
      if (externa.tipo !== "ok") throw new Error("esperaba ok");

      await crearCuentaConPantallaLibre("externa-garantia-de-garantia-2", plataformaId);
      const resultado = await cliente.$transaction((tx) =>
        realizarGarantia(tx, empresaId, adminId, externa.ventaDetalleReemplazo.id, "Pantalla fallida de nuevo"),
      );

      expect(resultado.tipo).toBe("ok");
      if (resultado.tipo !== "ok") throw new Error("esperaba ok");
      expect(resultado.ventaDetalleReemplazo.ventaId).toBe(externa.ventaDetalleReemplazo.ventaId);
      expect(resultado.ventaDetalleReemplazo.fechaVencimiento.getTime()).toBe(
        externa.ventaDetalleReemplazo.fechaVencimiento.getTime(),
      );
    });
  });
});
