import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { addDays, subDays } from "date-fns";
// prismaRaw en este archivo: arma la fixture (dos empresas, usuarios,
// cuentas, ventas de prueba) fuera de cualquier contexto de empresa
// autenticado — mismo patrón que cuentas.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { cifrar, descifrar } from "../lib/cifrado.ts";
import { realizarVenta } from "../lib/ventas.ts";
import { auth } from "./auth.ts";
import { cuentas } from "./cuentas.ts";

const CONTRASENA = "Clave#Segura123";
const PASSWORD_ORIGINAL = "clave-original-cuenta";

async function iniciarSesion(email: string): Promise<string> {
  const respuesta = await auth.handle(
    new Request("http://local/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: CONTRASENA }),
    }),
  );
  const setCookie = respuesta.headers.get("set-cookie");
  if (!setCookie) throw new Error(`Login falló para ${email}: ${await respuesta.text()}`);
  return setCookie.split(";")[0];
}

// ---------------------------------------------------------------------------
// F4.11, Parte 5 — pruebas de POST /cuentas/:id/reiniciar y GET
// /cuentas/por-reiniciar: atomicidad (ninguna escritura parcial cuando el
// reinicio se detiene por un error de negocio), los dos códigos de error
// (PASSWORD_SIN_CAMBIO, CUENTA_CON_VENTAS_VIGENTES), que una venta no puede
// tomar una pantalla POR_REINICIAR (R2 ya lo filtra en bloqueo-pantallas.ts;
// esto prueba el camino completo de la venta) y aislamiento entre empresas
// (R1) para los dos endpoints nuevos y el modelo ReinicioCuenta.
// ---------------------------------------------------------------------------

describe("POST /cuentas/:id/reiniciar y GET /cuentas/por-reiniciar", () => {
  let empresaAId: string;
  let empresaBId: string;
  let cookieAdminA: string;
  let cookieVendedorA: string;
  let cookieAdminB: string;
  let plataformaId: string;

  let cuentaExitoId: string;
  let pantallaExitoLibreId: string;
  let pantallaExitoPorReiniciarId: string;

  let cuentaSinCambioId: string;

  let cuentaVigenteId: string;
  let pantallaVigenteId: string;
  let pantallaVigentePorReiniciarId: string;

  let cuentaLiberadaId: string;

  let cuentaSoloPorReiniciarId: string;
  let cuentaMixtaId: string;

  let cuentaEmpresaBId: string;

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresaA = await prismaRaw.empresa.create({
      data: { nombre: "Empresa reinicio A (cuentas-reiniciar.test)", prefijoCodigo: "RSA" },
    });
    empresaAId = empresaA.id;
    const empresaB = await prismaRaw.empresa.create({
      data: { nombre: "Empresa reinicio B (cuentas-reiniciar.test)", prefijoCodigo: "RSB" },
    });
    empresaBId = empresaB.id;

    const adminAEmail = `admin-reiniciar-a-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: adminAEmail, passwordHash: hash, nombre: "Admin A", rol: "ADMIN" },
    });
    cookieAdminA = await iniciarSesion(adminAEmail);

    const vendedorAEmail = `vendedor-reiniciar-a-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId: empresaAId, email: vendedorAEmail, passwordHash: hash, nombre: "Vendedor A", rol: "VENDEDOR" },
    });
    cookieVendedorA = await iniciarSesion(vendedorAEmail);

    const adminBEmail = `admin-reiniciar-b-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId: empresaBId, email: adminBEmail, passwordHash: hash, nombre: "Admin B", rol: "ADMIN" },
    });
    cookieAdminB = await iniciarSesion(adminBEmail);

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId: empresaAId, nombre: "Netflix (reiniciar.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId: empresaAId, nombre: "30 días (reiniciar.test)", cantidad: 30, unidad: "DIAS" },
    });
    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId: empresaAId, nombre: "Nuevo (reiniciar.test)" } });

    async function crearVentaDetalle(opts: {
      cuentaId: string;
      pantallaId: string;
      fechaVencimiento: Date;
      codigoCompra: string;
    }): Promise<void> {
      const venta = await prismaRaw.venta.create({
        data: {
          empresaId: empresaAId,
          vendedorId: (await prismaRaw.usuario.findFirstOrThrow({ where: { email: adminAEmail } })).id,
          codigoCompra: opts.codigoCompra,
          tipoVenta: "UNIDAD",
          plataformaId,
          duracionId: duracion.id,
          nombreItem: "Netflix (reiniciar.test)",
          nombreDuracion: "30 días",
          cantidadDuracion: 30,
          unidadDuracion: "DIAS",
          nombreTipoCliente: "Nuevo",
          precioSugerido: "20000",
          precioVenta: "20000",
          costo: "10000",
          utilidad: "10000",
          fechaVencimientoMax: opts.fechaVencimiento,
          mensajeGenerado: "mensaje de prueba (cuentas-reiniciar.test)",
        },
      });
      await prismaRaw.ventaDetalle.create({
        data: {
          empresaId: empresaAId,
          ventaId: venta.id,
          pantallaId: opts.pantallaId,
          cuentaId: opts.cuentaId,
          plataformaId,
          nombrePlataforma: "Netflix (reiniciar.test)",
          passwordCuenta: "irrelevante-cifrado",
          duracionId: duracion.id,
          cantidadDuracion: 30,
          unidadDuracion: "DIAS",
          fechaVencimiento: opts.fechaVencimiento,
        },
      });
    }

    // Cuenta con reinicio exitoso: una pantalla POR_REINICIAR, otra LIBRE.
    const cuentaExito = await prismaRaw.cuenta.create({
      data: { empresaId: empresaAId, plataformaId, correo: "exito@reiniciar.test", password: cifrar(PASSWORD_ORIGINAL), capacidadPantallas: 2 },
    });
    cuentaExitoId = cuentaExito.id;
    const pantallaLibre = await prismaRaw.pantalla.create({ data: { empresaId: empresaAId, cuentaId: cuentaExitoId, numero: 1 } });
    pantallaExitoLibreId = pantallaLibre.id;
    const pantallaPorReiniciar = await prismaRaw.pantalla.create({ data: { empresaId: empresaAId, cuentaId: cuentaExitoId, numero: 2 } });
    pantallaExitoPorReiniciarId = pantallaPorReiniciar.id;
    await crearVentaDetalle({
      cuentaId: cuentaExitoId,
      pantallaId: pantallaExitoPorReiniciarId,
      fechaVencimiento: subDays(new Date(), 1),
      codigoCompra: "RSA-EXITO",
    });

    // Cuenta para PASSWORD_SIN_CAMBIO.
    const cuentaSinCambio = await prismaRaw.cuenta.create({
      data: { empresaId: empresaAId, plataformaId, correo: "sin-cambio@reiniciar.test", password: cifrar(PASSWORD_ORIGINAL), capacidadPantallas: 1 },
    });
    cuentaSinCambioId = cuentaSinCambio.id;
    await prismaRaw.pantalla.create({ data: { empresaId: empresaAId, cuentaId: cuentaSinCambioId, numero: 1 } });

    // Cuenta con venta vigente + una POR_REINICIAR (mixta), para
    // CUENTA_CON_VENTAS_VIGENTES.
    const cuentaVigente = await prismaRaw.cuenta.create({
      data: { empresaId: empresaAId, plataformaId, correo: "vigente@reiniciar.test", password: cifrar(PASSWORD_ORIGINAL), capacidadPantallas: 2 },
    });
    cuentaVigenteId = cuentaVigente.id;
    const pVigente = await prismaRaw.pantalla.create({ data: { empresaId: empresaAId, cuentaId: cuentaVigenteId, numero: 1 } });
    pantallaVigenteId = pVigente.id;
    const pPorReiniciar2 = await prismaRaw.pantalla.create({ data: { empresaId: empresaAId, cuentaId: cuentaVigenteId, numero: 2 } });
    pantallaVigentePorReiniciarId = pPorReiniciar2.id;
    await crearVentaDetalle({
      cuentaId: cuentaVigenteId,
      pantallaId: pantallaVigenteId,
      fechaVencimiento: addDays(new Date(), 30),
      codigoCompra: "RSA-VIGENTE",
    });
    await crearVentaDetalle({
      cuentaId: cuentaVigenteId,
      pantallaId: pantallaVigentePorReiniciarId,
      fechaVencimiento: subDays(new Date(), 1),
      codigoCompra: "RSA-VIGENTE-EXPIRADA",
    });

    // Cuenta ya reiniciada (vencida, pero liberadaEn posterior al
    // vencimiento ⇒ LIBRE por R5). Entra en el conjunto ESTRECHO de
    // candidatas de GET /por-reiniciar (tiene un VentaDetalle no anulado y
    // ninguno vigente), pero no debe aparecer en la respuesta: el estado
    // exacto lo decide pantallasDeCuentas/estadoDePantallas después de
    // estrechar, no el filtro de candidatas.
    const cuentaLiberada = await prismaRaw.cuenta.create({
      data: { empresaId: empresaAId, plataformaId, correo: "liberada@reiniciar.test", password: cifrar(PASSWORD_ORIGINAL), capacidadPantallas: 1 },
    });
    cuentaLiberadaId = cuentaLiberada.id;
    const pantallaLiberada = await prismaRaw.pantalla.create({ data: { empresaId: empresaAId, cuentaId: cuentaLiberadaId, numero: 1 } });
    await crearVentaDetalle({
      cuentaId: cuentaLiberadaId,
      pantallaId: pantallaLiberada.id,
      fechaVencimiento: subDays(new Date(), 5),
      codigoCompra: "RSA-LIBERADA",
    });
    await prismaRaw.pantalla.update({ where: { id: pantallaLiberada.id }, data: { liberadaEn: subDays(new Date(), 1) } });

    // Cuenta con una sola pantalla, POR_REINICIAR — para contrastar con la
    // mixta de abajo: debe salir con esMixta false y codigosCompraAfectados
    // vacío en el mismo GET /por-reiniciar.
    const cuentaSoloPorReiniciar = await prismaRaw.cuenta.create({
      data: { empresaId: empresaAId, plataformaId, correo: "solo-por-reiniciar@reiniciar.test", password: cifrar(PASSWORD_ORIGINAL), capacidadPantallas: 1 },
    });
    cuentaSoloPorReiniciarId = cuentaSoloPorReiniciar.id;
    const pantallaSolo = await prismaRaw.pantalla.create({ data: { empresaId: empresaAId, cuentaId: cuentaSoloPorReiniciarId, numero: 1 } });
    await crearVentaDetalle({
      cuentaId: cuentaSoloPorReiniciarId,
      pantallaId: pantallaSolo.id,
      fechaVencimiento: subDays(new Date(), 1),
      codigoCompra: "RSA-SOLO-POR-REINICIAR",
    });

    // Cuenta mixta: una pantalla POR_REINICIAR y otra OCUPADA con venta
    // vigente — el caso que el ADMIN tiene que ver antes de reiniciar, para
    // no cortarle el servicio a un cliente que sigue pagando.
    const cuentaMixta = await prismaRaw.cuenta.create({
      data: { empresaId: empresaAId, plataformaId, correo: "mixta@reiniciar.test", password: cifrar(PASSWORD_ORIGINAL), capacidadPantallas: 2 },
    });
    cuentaMixtaId = cuentaMixta.id;
    const pantallaMixtaPorReiniciar = await prismaRaw.pantalla.create({ data: { empresaId: empresaAId, cuentaId: cuentaMixtaId, numero: 1 } });
    await crearVentaDetalle({
      cuentaId: cuentaMixtaId,
      pantallaId: pantallaMixtaPorReiniciar.id,
      fechaVencimiento: subDays(new Date(), 1),
      codigoCompra: "RSA-MIXTA-EXPIRADA",
    });
    const pantallaMixtaOcupada = await prismaRaw.pantalla.create({ data: { empresaId: empresaAId, cuentaId: cuentaMixtaId, numero: 2 } });
    await crearVentaDetalle({
      cuentaId: cuentaMixtaId,
      pantallaId: pantallaMixtaOcupada.id,
      fechaVencimiento: addDays(new Date(), 10),
      codigoCompra: "RSA-MIXTA-VIGENTE",
    });

    // Cuenta de la empresa B, con una pantalla POR_REINICIAR — para probar
    // que ninguna consulta de la empresa A la alcanza (R1).
    const cuentaEmpresaB = await prismaRaw.cuenta.create({
      data: { empresaId: empresaBId, plataformaId: (await prismaRaw.plataforma.create({
        data: { empresaId: empresaBId, nombre: "Netflix B (reiniciar.test)", capacidadPantallas: 1, usaPerfilPin: false },
      })).id, correo: "b@reiniciar.test", password: cifrar(PASSWORD_ORIGINAL), capacidadPantallas: 1 },
    });
    cuentaEmpresaBId = cuentaEmpresaB.id;
    const pantallaB = await prismaRaw.pantalla.create({ data: { empresaId: empresaBId, cuentaId: cuentaEmpresaBId, numero: 1 } });
    const ventaB = await prismaRaw.venta.create({
      data: {
        empresaId: empresaBId,
        vendedorId: (await prismaRaw.usuario.findFirstOrThrow({ where: { email: adminBEmail } })).id,
        codigoCompra: "RSB-001",
        tipoVenta: "UNIDAD",
        plataformaId: cuentaEmpresaB.plataformaId,
        duracionId: (await prismaRaw.duracion.create({
          data: { empresaId: empresaBId, nombre: "30 días (reiniciar.test B)", cantidad: 30, unidad: "DIAS" },
        })).id,
        nombreItem: "Netflix B (reiniciar.test)",
        nombreDuracion: "30 días",
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        nombreTipoCliente: "Nuevo",
        precioSugerido: "20000",
        precioVenta: "20000",
        costo: "10000",
        utilidad: "10000",
        fechaVencimientoMax: subDays(new Date(), 1),
        mensajeGenerado: "mensaje de prueba (cuentas-reiniciar.test B)",
      },
    });
    await prismaRaw.ventaDetalle.create({
      data: {
        empresaId: empresaBId,
        ventaId: ventaB.id,
        pantallaId: pantallaB.id,
        cuentaId: cuentaEmpresaBId,
        plataformaId: cuentaEmpresaB.plataformaId,
        nombrePlataforma: "Netflix B (reiniciar.test)",
        passwordCuenta: "irrelevante-cifrado",
        duracionId: ventaB.duracionId,
        cantidadDuracion: 30,
        unidadDuracion: "DIAS",
        fechaVencimiento: subDays(new Date(), 1),
      },
    });

    // Plataforma/cuenta dedicada a probar que una venta no puede tomar una
    // pantalla POR_REINICIAR: una sola pantalla, ya vencida y sin liberar.
    const plataformaVenta = await prismaRaw.plataforma.create({
      data: { empresaId: empresaAId, nombre: "Disney+ (reiniciar-venta.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    const cuentaVenta = await prismaRaw.cuenta.create({
      data: { empresaId: empresaAId, plataformaId: plataformaVenta.id, correo: "venta@reiniciar.test", password: cifrar(PASSWORD_ORIGINAL), capacidadPantallas: 1 },
    });
    const pantallaVenta = await prismaRaw.pantalla.create({ data: { empresaId: empresaAId, cuentaId: cuentaVenta.id, numero: 1 } });
    await crearVentaDetalle({
      cuentaId: cuentaVenta.id,
      pantallaId: pantallaVenta.id,
      fechaVencimiento: subDays(new Date(), 1),
      codigoCompra: "RSA-DISNEY-VENCIDA",
    });
    await prismaRaw.precio.create({
      data: {
        empresaId: empresaAId,
        plataformaId: plataformaVenta.id,
        duracionId: duracion.id,
        tipoClienteId: tipoCliente.id,
        precioVenta: "20000",
        costo: "10000",
      },
    });

    // Variables usadas por el test de venta, fuera de este closure.
    plataformaVentaId = plataformaVenta.id;
    duracionId = duracion.id;
    tipoClienteId = tipoCliente.id;
    vendedorAId = (await prismaRaw.usuario.findFirstOrThrow({ where: { email: adminAEmail } })).id;
  });

  let plataformaVentaId: string;
  let duracionId: string;
  let tipoClienteId: string;
  let vendedorAId: string;

  afterAll(async () => {
    await prismaRaw.reinicioCuenta.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.venta.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.precio.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId: { in: [empresaAId, empresaBId] } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: [empresaAId, empresaBId] } } });
  });

  async function post(ruta: string, body: unknown, cookie: string = cookieAdminA) {
    return cuentas.handle(
      new Request(`http://local${ruta}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  async function get(ruta: string, cookie: string = cookieAdminA) {
    return cuentas.handle(new Request(`http://local${ruta}`, { headers: { cookie } }));
  }

  it("reinicia una cuenta sin ventas vigentes: libera la pantalla POR_REINICIAR, cambia la contraseña y registra ReinicioCuenta", async () => {
    const respuesta = await post(`/cuentas/${cuentaExitoId}/reiniciar`, { password: "Nueva#Clave1" });
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as { pantallasLiberadas: number; pantallasConVentaVigente: number };
    expect(cuerpo.pantallasLiberadas).toBe(1);
    expect(cuerpo.pantallasConVentaVigente).toBe(0);

    const cuentaActualizada = await prismaRaw.cuenta.findUniqueOrThrow({ where: { id: cuentaExitoId } });
    expect(descifrar(cuentaActualizada.password)).toBe("Nueva#Clave1");

    const pantallaActualizada = await prismaRaw.pantalla.findUniqueOrThrow({ where: { id: pantallaExitoPorReiniciarId } });
    expect(pantallaActualizada.liberadaEn).not.toBeNull();

    const registro = await prismaRaw.reinicioCuenta.findFirstOrThrow({ where: { cuentaId: cuentaExitoId } });
    expect(registro.pantallasLiberadas).toBe(1);
    expect(registro.pantallasConVentaVigente).toBe(0);
    expect(registro.codigosCompraAfectados).toEqual([]);
  });

  it("PASSWORD_SIN_CAMBIO: rechaza con 409 si la nueva contraseña es igual a la actual, sin tocar nada (atomicidad)", async () => {
    const respuesta = await post(`/cuentas/${cuentaSinCambioId}/reiniciar`, { password: PASSWORD_ORIGINAL });
    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe("PASSWORD_SIN_CAMBIO");

    const cuentaSinTocar = await prismaRaw.cuenta.findUniqueOrThrow({ where: { id: cuentaSinCambioId } });
    expect(descifrar(cuentaSinTocar.password)).toBe(PASSWORD_ORIGINAL);
    const registros = await prismaRaw.reinicioCuenta.findMany({ where: { cuentaId: cuentaSinCambioId } });
    expect(registros).toHaveLength(0);
  });

  it("CUENTA_CON_VENTAS_VIGENTES: sin confirmar responde 409 y no toca nada; confirmando libera todo y registra solo los códigos vigentes", async () => {
    const sinConfirmar = await post(`/cuentas/${cuentaVigenteId}/reiniciar`, { password: "Otra#Clave2" });
    expect(sinConfirmar.status).toBe(409);
    const cuerpoSinConfirmar = (await sinConfirmar.json()) as { error: { codigo: string }; codigosCompraAfectados: string[] };
    expect(cuerpoSinConfirmar.error.codigo).toBe("CUENTA_CON_VENTAS_VIGENTES");
    expect(cuerpoSinConfirmar.codigosCompraAfectados).toEqual(["RSA-VIGENTE"]);

    // Atomicidad: el intento sin confirmar no debió escribir nada.
    const cuentaSinTocar = await prismaRaw.cuenta.findUniqueOrThrow({ where: { id: cuentaVigenteId } });
    expect(descifrar(cuentaSinTocar.password)).toBe(PASSWORD_ORIGINAL);
    expect((await prismaRaw.reinicioCuenta.findMany({ where: { cuentaId: cuentaVigenteId } })).length).toBe(0);

    const confirmando = await post(`/cuentas/${cuentaVigenteId}/reiniciar`, {
      password: "Otra#Clave2",
      confirmarVentasVigentes: true,
    });
    expect(confirmando.status).toBe(200);
    const cuerpo = (await confirmando.json()) as { pantallasLiberadas: number; pantallasConVentaVigente: number };
    expect(cuerpo.pantallasLiberadas).toBe(1);
    expect(cuerpo.pantallasConVentaVigente).toBe(1);

    const cuentaActualizada = await prismaRaw.cuenta.findUniqueOrThrow({ where: { id: cuentaVigenteId } });
    expect(descifrar(cuentaActualizada.password)).toBe("Otra#Clave2");

    const registro = await prismaRaw.reinicioCuenta.findFirstOrThrow({ where: { cuentaId: cuentaVigenteId } });
    expect(registro.pantallasLiberadas).toBe(1);
    expect(registro.pantallasConVentaVigente).toBe(1);
    expect(registro.codigosCompraAfectados).toEqual(["RSA-VIGENTE"]);

    // La pantalla con venta vigente sigue OCUPADA — liberadaEn se tocó en
    // todas, pero su fechaVencimiento (futuro) sigue después de ese
    // liberadaEn, así que R5 sigue viéndola retenida por su venta real.
    const cliente = prismaParaEmpresa(empresaAId);
    const { pantallasDeCuenta } = await import("../lib/pantallas.ts");
    const estados = await pantallasDeCuenta(cliente, cuentaVigenteId);
    expect(estados.find((p) => p.id === pantallaVigenteId)?.estado).toBe("OCUPADA");
    expect(estados.find((p) => p.id === pantallaVigentePorReiniciarId)?.estado).toBe("LIBRE");
  });

  it("una venta no puede tomar una pantalla POR_REINICIAR: responde inventario_insuficiente, igual que si no hubiera pantallas", async () => {
    const cliente = prismaParaEmpresa(empresaAId);
    const resultado = await cliente.$transaction((tx) =>
      realizarVenta(tx, empresaAId, vendedorAId, {
        tipoVenta: "UNIDAD",
        plataformas: [plataformaVentaId],
        duracionId,
        tipoClienteId,
      }),
    );
    expect(resultado.tipo).toBe("inventario_insuficiente");
  });

  it("una cuenta ya liberada (liberadaEn posterior al vencimiento) entra en el conjunto estrecho de candidatas, pero no sale en la respuesta", async () => {
    const respuesta = await get("/cuentas/por-reiniciar", cookieAdminA);
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as { cuentas: { id: string }[] };
    expect(cuerpo.cuentas.some((c) => c.id === cuentaLiberadaId)).toBe(false);
  });

  // El filtro de candidatas (fix de rendimiento) opera a nivel de PANTALLA:
  // decide qué cuentas vale la pena mirar, no qué devolver. Los campos
  // esMixta/pantallasPorReiniciar/pantallasConVentaVigente/
  // codigosCompraAfectados se calculan después, a nivel de CUENTA, agregando
  // las pantallas de pantallasDeCuentas. Son los campos que le avisan al
  // ADMIN que, si reinicia esta cuenta, le corta el servicio a un cliente que
  // sigue vigente — si alguien "optimiza" el cálculo para que viva a nivel de
  // pantalla (p.ej. calculándolo dentro del mismo findMany de candidatas),
  // estos tres números se van a cero en silencio y el aviso desaparece de la
  // vista sin que ningún tipo ni ninguna otra prueba lo note.
  it("una cuenta mixta (una pantalla POR_REINICIAR y otra OCUPADA con venta vigente) sale con esMixta true y el código de la venta vigente; una cuenta solo POR_REINICIAR sale con esMixta false y sin códigos", async () => {
    const respuesta = await get("/cuentas/por-reiniciar", cookieAdminA);
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as {
      cuentas: {
        id: string;
        esMixta: boolean;
        pantallasPorReiniciar: number;
        pantallasConVentaVigente: number;
        codigosCompraAfectados: string[];
      }[];
    };

    const mixta = cuerpo.cuentas.find((c) => c.id === cuentaMixtaId);
    expect(mixta).toBeDefined();
    expect(mixta?.esMixta).toBe(true);
    expect(mixta?.pantallasPorReiniciar).toBe(1);
    expect(mixta?.pantallasConVentaVigente).toBe(1);
    expect(mixta?.codigosCompraAfectados).toEqual(["RSA-MIXTA-VIGENTE"]);

    const solo = cuerpo.cuentas.find((c) => c.id === cuentaSoloPorReiniciarId);
    expect(solo).toBeDefined();
    expect(solo?.esMixta).toBe(false);
    expect(solo?.pantallasPorReiniciar).toBe(1);
    expect(solo?.pantallasConVentaVigente).toBe(0);
    expect(solo?.codigosCompraAfectados).toEqual([]);
  });

  it("R1: GET /cuentas/por-reiniciar de la empresa A nunca incluye cuentas de la empresa B, y viceversa", async () => {
    const respuestaA = await get("/cuentas/por-reiniciar", cookieAdminA);
    expect(respuestaA.status).toBe(200);
    const cuerpoA = (await respuestaA.json()) as { cuentas: { id: string }[] };
    expect(cuerpoA.cuentas.some((c) => c.id === cuentaEmpresaBId)).toBe(false);

    const respuestaB = await get("/cuentas/por-reiniciar", cookieAdminB);
    expect(respuestaB.status).toBe(200);
    const cuerpoB = (await respuestaB.json()) as { cuentas: { id: string }[] };
    expect(cuerpoB.cuentas.some((c) => c.id === cuentaEmpresaBId)).toBe(true);
    expect(cuerpoB.cuentas.some((c) => c.id === cuentaExitoId)).toBe(false);
  });

  it("R1: POST /cuentas/:id/reiniciar con un id de otra empresa responde 404, no toca la cuenta ajena", async () => {
    const respuesta = await post(`/cuentas/${cuentaEmpresaBId}/reiniciar`, { password: "Lo#Que#Sea1" }, cookieAdminA);
    expect(respuesta.status).toBe(404);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe("CUENTA_NO_ENCONTRADA");

    const cuentaIntacta = await prismaRaw.cuenta.findUniqueOrThrow({ where: { id: cuentaEmpresaBId } });
    expect(descifrar(cuentaIntacta.password)).toBe(PASSWORD_ORIGINAL);
  });

  it("un VENDEDOR obtiene 403 en los dos endpoints de reinicio", async () => {
    const respuestaListado = await get("/cuentas/por-reiniciar", cookieVendedorA);
    expect(respuestaListado.status).toBe(403);

    const respuestaReiniciar = await post(`/cuentas/${cuentaSinCambioId}/reiniciar`, { password: "Lo#Que#Sea2" }, cookieVendedorA);
    expect(respuestaReiniciar.status).toBe(403);
  });
});
