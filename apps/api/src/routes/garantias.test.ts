import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: arma la fixture fuera de cualquier contexto de
// empresa autenticado, igual que ventas.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { cifrar } from "../lib/cifrado.ts";
import { auth } from "./auth.ts";
import { ventas } from "./ventas.ts";
import { garantias } from "./garantias.ts";

const CONTRASENA = "Clave#Segura123";

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

describe("Rutas de garantías (/garantias)", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let cookieVendedor: string;
  let duracionId: string;
  let tipoClienteId: string;

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa garantías-ruta (garantias.test)", prefijoCodigo: "GTR" },
    });
    empresaId = empresa.id;

    const adminEmail = `admin-garantias-ruta-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });
    cookieAdmin = await iniciarSesion(adminEmail);

    const vendedorEmail = `empleado-garantias-ruta-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: vendedorEmail, passwordHash: hash, nombre: "Empleado", rol: "EMPLEADO" },
    });
    cookieVendedor = await iniciarSesion(vendedorEmail);

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (garantias-ruta.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;

    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Nuevo (garantias-ruta.test)" },
    });
    tipoClienteId = tipoCliente.id;

    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "UNIDAD", contenido: "Código {{codigoCompra}} - {{correo}} - {{clave}}" },
    });
    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "PAQUETE", contenido: "Código {{codigoCompra}} - {{paquete}}\n{{listaCuentas}}" },
    });
  });

  afterAll(async () => {
    await prismaRaw.garantia.deleteMany({ where: { empresaId } });
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

  async function get(ruta: string, cookie: string) {
    return garantias.handle(new Request(`http://local${ruta}`, { headers: { cookie } }));
  }

  async function reemplazar(ventaDetalleId: string, body: { motivo?: string }, cookie: string) {
    return garantias.handle(
      new Request(`http://local/garantias/${ventaDetalleId}/reemplazar`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  async function venderUnidad(cookie: string, plataformaId: string) {
    const respuesta = await ventas.handle(
      new Request("http://local/ventas", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }),
      }),
    );
    if (respuesta.status !== 201) throw new Error(`venta falló: ${await respuesta.text()}`);
    return (await respuesta.json()) as { venta: { id: string } };
  }

  async function anularVenta(ventaId: string, cookie: string) {
    return ventas.handle(
      new Request(`http://local/ventas/${ventaId}/anular`, { method: "PATCH", headers: { cookie } }),
    );
  }

  // Cada prueba arma su PROPIA plataforma, con su propio Precio. R5 libera la
  // pantalla de una venta anulada (queda "libre" otra vez), así que una
  // plataforma compartida entre pruebas deja inventario colgado de una
  // prueba disponible para la siguiente — ver el mismo fix en
  // lib/garantias.test.ts. Aislar por plataforma elimina ese acoplamiento
  // sin depender del orden de ejecución.
  async function crearPlataforma(sufijo: string) {
    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: `Netflix (garantias-ruta.test ${sufijo})`, capacidadPantallas: 1, usaPerfilPin: true },
    });
    // Costo distinto de cero a propósito: así el escaneo R4 detectaría una
    // fuga real si "costo"/"costoAsumido" se filtrara al EMPLEADO.
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId: plataforma.id, duracionId, tipoClienteId, precioVenta: "15000", costo: "6000" },
    });
    return plataforma.id;
  }

  async function crearCuentaConPantallaLibre(plataformaId: string, correo: string, clave: string) {
    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo, password: cifrar(clave), capacidadPantallas: 1 },
    });
    await prismaRaw.pantalla.create({
      data: { empresaId, cuentaId: cuenta.id, numero: 1, perfil: "Perfil nuevo", pin: cifrar("2222") },
    });
    return cuenta;
  }

  it("GET /pantallas-vendidas: ambos roles listan, pero el JSON crudo del EMPLEADO nunca trae costo/utilidad/margen (R4)", async () => {
    const plataformaId = await crearPlataforma("listado");
    await crearCuentaConPantallaLibre(plataformaId, "original-listado@garantias-ruta.test", "clave-original-listado");
    const { venta } = await venderUnidad(cookieVendedor, plataformaId);

    const respuestaVendedor = await get("/garantias/pantallas-vendidas", cookieVendedor);
    expect(respuestaVendedor.status).toBe(200);
    const textoVendedor = await respuestaVendedor.text();
    expect(textoVendedor).not.toContain("costo");
    expect(textoVendedor).not.toContain("utilidad");
    expect(textoVendedor).not.toContain("margen");

    const cuerpoVendedor = JSON.parse(textoVendedor) as {
      pantallas: Array<{
        id: string;
        correoCuenta: string;
        claveCuenta: string;
        codigoCompra: string;
        estado: string;
        puedeReemplazar: boolean;
        garantia: unknown;
      }>;
    };
    const filaVendedor = cuerpoVendedor.pantallas.find((p) => p.correoCuenta === "original-listado@garantias-ruta.test");
    expect(filaVendedor).toBeDefined();
    // El EMPLEADO SÍ ve las credenciales (sección 6: necesita poder revisar
    // si la cuenta sirve, sin importar quién vendió).
    expect(filaVendedor?.claveCuenta).toBe("clave-original-listado");
    expect(filaVendedor?.estado).toBe("VIGENTE");
    expect(filaVendedor?.puedeReemplazar).toBe(true);
    expect(filaVendedor?.garantia).toBeNull();

    const respuestaAdmin = await get("/garantias/pantallas-vendidas", cookieAdmin);
    expect(respuestaAdmin.status).toBe(200);
    const cuerpoAdmin = (await respuestaAdmin.json()) as { pantallas: Array<{ correoCuenta: string }> };
    expect(cuerpoAdmin.pantallas.some((p) => p.correoCuenta === "original-listado@garantias-ruta.test")).toBe(true);

    await anularVenta(venta.id, cookieAdmin);
  });

  it("POST /:id/reemplazar con un id inexistente responde 404 PANTALLA_NO_ENCONTRADA", async () => {
    const respuesta = await reemplazar("id-que-no-existe", {}, cookieVendedor);
    expect(respuesta.status).toBe(404);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe("PANTALLA_NO_ENCONTRADA");
  });

  it("flujo completo: reemplaza, el mensaje anuncia el reemplazo, el listado refleja REEMPLAZADA/VIGENTE y el EMPLEADO no ve costoAsumido mientras el ADMIN sí", async () => {
    const plataformaId = await crearPlataforma("flujo");
    await crearCuentaConPantallaLibre(plataformaId, "original-flujo@garantias-ruta.test", "clave-original-flujo");
    const { venta } = await venderUnidad(cookieVendedor, plataformaId);
    const detalleOriginal = await prismaRaw.ventaDetalle.findFirstOrThrow({ where: { ventaId: venta.id } });

    await crearCuentaConPantallaLibre(plataformaId, "reemplazo-flujo@garantias-ruta.test", "clave-reemplazo-flujo");

    const respuesta = await reemplazar(detalleOriginal.id, { motivo: "Pantalla congelada" }, cookieVendedor);
    expect(respuesta.status).toBe(201);
    const cuerpo = (await respuesta.json()) as { mensajeGenerado: string };
    expect(cuerpo.mensajeGenerado).toContain("*Reemplazo de pantalla*");
    expect(cuerpo.mensajeGenerado).toContain("clave-reemplazo-flujo");

    // Vista del EMPLEADO: la fila original pasa a REEMPLAZADA, sin botón, y
    // sin costoAsumido (R4 — exclusión en el select, nunca post-filtrado).
    const listadoVendedor = await get("/garantias/pantallas-vendidas", cookieVendedor);
    const textoVendedor = await listadoVendedor.text();
    expect(textoVendedor).not.toContain("costoAsumido");
    const cuerpoVendedor = JSON.parse(textoVendedor) as {
      pantallas: Array<{
        correoCuenta: string;
        estado: string;
        puedeReemplazar: boolean;
        garantia: { motivo: string | null; correoCuentaReemplazo: string } | null;
      }>;
    };
    const filaOriginalVendedor = cuerpoVendedor.pantallas.find(
      (p) => p.correoCuenta === "original-flujo@garantias-ruta.test",
    );
    expect(filaOriginalVendedor?.estado).toBe("REEMPLAZADA");
    expect(filaOriginalVendedor?.puedeReemplazar).toBe(false);
    expect(filaOriginalVendedor?.garantia?.motivo).toBe("Pantalla congelada");
    expect(filaOriginalVendedor?.garantia?.correoCuentaReemplazo).toBe("reemplazo-flujo@garantias-ruta.test");

    const filaReemplazoVendedor = cuerpoVendedor.pantallas.find(
      (p) => p.correoCuenta === "reemplazo-flujo@garantias-ruta.test",
    );
    expect(filaReemplazoVendedor?.estado).toBe("VIGENTE");
    expect(filaReemplazoVendedor?.puedeReemplazar).toBe(true);
    expect(filaReemplazoVendedor?.garantia).toBeNull();

    // Vista del ADMIN: misma fila, pero con costoAsumido visible (select
    // distinto, no el mismo objeto filtrado después).
    const listadoAdmin = await get("/garantias/pantallas-vendidas", cookieAdmin);
    const cuerpoAdmin = (await listadoAdmin.json()) as {
      pantallas: Array<{ correoCuenta: string; garantia: { costoAsumido?: string } | null }>;
    };
    const filaOriginalAdmin = cuerpoAdmin.pantallas.find(
      (p) => p.correoCuenta === "original-flujo@garantias-ruta.test",
    );
    // costoAsumido copia el costo de la plataforma/duración al momento de la
    // garantía (sección 4) — "6000" porque esta prueba fijó Precio.costo a
    // propósito, para que un R4 roto sea detectable (no porque hoy los
    // costos reales estén en cero).
    expect(filaOriginalAdmin?.garantia?.costoAsumido).toBe("6000");
  });

  it("una segunda garantía sobre la misma pantalla ya reemplazada responde 409 YA_REEMPLAZADA", async () => {
    const plataformaId = await crearPlataforma("doble");
    await crearCuentaConPantallaLibre(plataformaId, "original-doble@garantias-ruta.test", "clave-original-doble");
    const { venta } = await venderUnidad(cookieVendedor, plataformaId);
    const detalleOriginal = await prismaRaw.ventaDetalle.findFirstOrThrow({ where: { ventaId: venta.id } });

    await crearCuentaConPantallaLibre(plataformaId, "reemplazo-doble-1@garantias-ruta.test", "clave-reemplazo-doble-1");
    await crearCuentaConPantallaLibre(plataformaId, "reemplazo-doble-2@garantias-ruta.test", "clave-reemplazo-doble-2");

    const primera = await reemplazar(detalleOriginal.id, {}, cookieAdmin);
    expect(primera.status).toBe(201);

    const segunda = await reemplazar(detalleOriginal.id, {}, cookieAdmin);
    expect(segunda.status).toBe(409);
    const cuerpo = (await segunda.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe("YA_REEMPLAZADA");
  });

  it("sin pantalla libre de esa plataforma responde 409 SIN_PANTALLAS_DISPONIBLES con el nombre de la plataforma en el mensaje", async () => {
    const plataformaId = await crearPlataforma("sininventario");
    await crearCuentaConPantallaLibre(
      plataformaId,
      "original-sininventario@garantias-ruta.test",
      "clave-original-sininventario",
    );
    const { venta } = await venderUnidad(cookieVendedor, plataformaId);
    const detalleOriginal = await prismaRaw.ventaDetalle.findFirstOrThrow({ where: { ventaId: venta.id } });
    // A propósito: no se deja ninguna pantalla libre adicional de esta
    // plataforma antes de pedir el reemplazo; la plataforma es exclusiva de
    // esta prueba, así que no hay inventario colgado de otra prueba.

    const respuesta = await reemplazar(detalleOriginal.id, {}, cookieVendedor);
    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string; mensaje: string } };
    expect(cuerpo.error.codigo).toBe("SIN_PANTALLAS_DISPONIBLES");
    expect(cuerpo.error.mensaje).toBe(
      "No hay pantallas disponibles de Netflix (garantias-ruta.test sininventario) para hacer el reemplazo.",
    );

    await anularVenta(venta.id, cookieAdmin);
  });

  it("sobre una venta ya anulada responde 409 VENTA_ANULADA", async () => {
    const plataformaId = await crearPlataforma("anulada");
    await crearCuentaConPantallaLibre(plataformaId, "original-anulada@garantias-ruta.test", "clave-original-anulada");
    const { venta } = await venderUnidad(cookieVendedor, plataformaId);
    const detalleOriginal = await prismaRaw.ventaDetalle.findFirstOrThrow({ where: { ventaId: venta.id } });

    const anulacion = await anularVenta(venta.id, cookieAdmin);
    expect(anulacion.status).toBe(200);

    await crearCuentaConPantallaLibre(plataformaId, "reemplazo-anulada@garantias-ruta.test", "clave-reemplazo-anulada");

    const respuesta = await reemplazar(detalleOriginal.id, {}, cookieVendedor);
    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe("VENTA_ANULADA");
  });

  it("filtro soloVigentes excluye las filas reemplazadas, vencidas y de ventas anuladas", async () => {
    const plataformaId = await crearPlataforma("filtro");
    await crearCuentaConPantallaLibre(plataformaId, "original-filtro@garantias-ruta.test", "clave-original-filtro");
    const { venta } = await venderUnidad(cookieVendedor, plataformaId);

    const respuesta = await get("/garantias/pantallas-vendidas?soloVigentes=true", cookieAdmin);
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as { pantallas: Array<{ correoCuenta: string; estado: string }> };
    expect(cuerpo.pantallas.every((p) => p.estado === "VIGENTE")).toBe(true);
    expect(cuerpo.pantallas.some((p) => p.correoCuenta === "original-filtro@garantias-ruta.test")).toBe(true);

    await anularVenta(venta.id, cookieAdmin);

    const respuestaTrasAnular = await get("/garantias/pantallas-vendidas?soloVigentes=true", cookieAdmin);
    const cuerpoTrasAnular = (await respuestaTrasAnular.json()) as { pantallas: Array<{ correoCuenta: string }> };
    expect(cuerpoTrasAnular.pantallas.some((p) => p.correoCuenta === "original-filtro@garantias-ruta.test")).toBe(
      false,
    );
  });
});
