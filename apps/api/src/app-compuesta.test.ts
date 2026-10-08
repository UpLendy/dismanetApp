import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Elysia } from "elysia";
import { prismaRaw } from "./lib/prisma.ts";
import { cifrar } from "./lib/cifrado.ts";
import { Prisma } from "./generated/prisma/client.ts";
import { auth } from "./routes/auth.ts";
import { empresas } from "./routes/empresas.ts";
import { usuarios } from "./routes/usuarios.ts";
import { plataformas } from "./routes/plataformas.ts";
import { duraciones } from "./routes/duraciones.ts";
import { tiposCliente } from "./routes/tipos-cliente.ts";
import { paquetes } from "./routes/paquetes.ts";
import { precios } from "./routes/precios.ts";
import { cuentas } from "./routes/cuentas.ts";
import { disponibilidad } from "./routes/disponibilidad.ts";
import { ventas } from "./routes/ventas.ts";
import { plantillas } from "./routes/plantillas.ts";
import { perfil } from "./routes/perfil.ts";

/** Forma de error del API: `{ error: { codigo, mensaje } }` (CLAUDE.md). */
type RespuestaError = { error: { codigo: string; mensaje: string } };

// Regresión: `empresas.ts` aplica requiereRol(ADMIN) para crear y
// requiereRol(SUPER_ADMIN) para el resto, dentro de la MISMA app compuesta
// que usuarios/plataformas/duraciones/tipos-cliente. Si las guardas de
// guardas.ts usan scope "global" en vez de "scoped", el onBeforeHandle de
// SUPER_ADMIN de empresas.ts se filtra a TODAS las rutas registradas
// después en la app compuesta, bloqueando a un ADMIN legítimo con 403 en
// endpoints que solo exigen ADMIN. Las pruebas por router (.handle() sobre
// un sub-app aislado) nunca detectan esto porque cada router se prueba
// solo, sin la app compuesta real de index.ts. Esta prueba monta la app
// exactamente como index.ts para que la fuga sea detectable.
const app = new Elysia()
  .use(auth)
  .use(empresas)
  .use(usuarios)
  .use(plataformas)
  .use(duraciones)
  .use(tiposCliente)
  .use(paquetes)
  .use(precios)
  .use(cuentas)
  .use(disponibilidad)
  .use(ventas)
  .use(plantillas)
  .use(perfil);

const CONTRASENA = "Clave#Segura123";

async function iniciarSesion(email: string): Promise<string> {
  const respuesta = await app.handle(
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

describe("App compuesta — las guardas de un router no se filtran a otros (regresión scope)", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let cookieVendedor: string;
  let vendedorId: string;
  let plataformaId: string;
  let duracionId: string;
  let tipoClienteId: string;

  const idsEmpresas: string[] = [];
  const emailsUsuarios: string[] = [];

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa app compuesta (app-compuesta.test)", prefijoCodigo: "ACP" },
    });
    empresaId = empresa.id;
    idsEmpresas.push(empresaId);

    const adminEmail = `admin-app-compuesta-${randomUUID()}@test.local`;
    emailsUsuarios.push(adminEmail);
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });
    cookieAdmin = await iniciarSesion(adminEmail);

    const vendedorEmail = `vendedor-app-compuesta-${randomUUID()}@test.local`;
    emailsUsuarios.push(vendedorEmail);
    const vendedor = await prismaRaw.usuario.create({
      data: { empresaId, email: vendedorEmail, passwordHash: hash, nombre: "Vendedor", rol: "VENDEDOR" },
    });
    vendedorId = vendedor.id;
    cookieVendedor = await iniciarSesion(vendedorEmail);

    const plataforma = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix (app-compuesta.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaId = plataforma.id;

    const cuenta = await prismaRaw.cuenta.create({
      data: { empresaId, plataformaId, correo: "netflix@app-compuesta.test", password: cifrar("clave"), capacidadPantallas: 1 },
    });
    await prismaRaw.pantalla.create({ data: { empresaId, cuentaId: cuenta.id, numero: 1 } });

    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (app-compuesta.test)", cantidad: 30, unidad: "DIAS" },
    });
    duracionId = duracion.id;
    const tipoCliente = await prismaRaw.tipoCliente.create({ data: { empresaId, nombre: "Nuevo (app-compuesta.test)" } });
    tipoClienteId = tipoCliente.id;
    await prismaRaw.precio.create({
      data: { empresaId, plataformaId, duracionId, tipoClienteId, precioVenta: "15000", costo: "8000" },
    });
    await prismaRaw.plantillaMensaje.create({
      data: { empresaId, tipo: "UNIDAD", contenido: "Código {{codigoCompra}} - {{correo}} - {{clave}}" },
    });
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
    await prismaRaw.usuario.deleteMany({ where: { email: { in: emailsUsuarios } } });
    await prismaRaw.empresa.deleteMany({ where: { id: { in: idsEmpresas } } });
  });

  async function get(ruta: string, cookie: string = cookieAdmin) {
    return app.handle(new Request(`http://local${ruta}`, { headers: { cookie } }));
  }

  async function post(ruta: string, body: unknown, cookie: string = cookieAdmin) {
    return app.handle(
      new Request(`http://local${ruta}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  async function patch(ruta: string, cookie: string = cookieAdmin) {
    return app.handle(new Request(`http://local${ruta}`, { method: "PATCH", headers: { cookie } }));
  }

  async function patchBody(ruta: string, body: unknown, cookie: string = cookieAdmin) {
    return app.handle(
      new Request(`http://local${ruta}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  it("un ADMIN puede usar /usuarios, /plataformas, /duraciones, /tipos-cliente y /paquetes aunque /empresas también esté montado", async () => {
    for (const ruta of ["/usuarios", "/plataformas", "/duraciones", "/tipos-cliente", "/paquetes"]) {
      const respuesta = await get(ruta);
      expect(respuesta.status).toBe(200);
    }
  });

  it("un ADMIN puede usar /precios/unidades aunque /empresas también esté montado", async () => {
    const respuesta = await get(`/precios/unidades?plataformaId=${plataformaId}`);
    expect(respuesta.status).toBe(200);
  });

  it("un ADMIN sigue sin poder listar /empresas (exclusivo de SUPER_ADMIN)", async () => {
    const respuesta = await get("/empresas");
    expect(respuesta.status).toBe(403);
  });

  it("un ADMIN puede usar /cuentas y /disponibilidad aunque /empresas también esté montado", async () => {
    const respuestaCuentas = await get("/cuentas");
    expect(respuestaCuentas.status).toBe(200);
    const respuestaDisponibilidad = await get("/disponibilidad");
    expect(respuestaDisponibilidad.status).toBe(200);
  });

  it("un VENDEDOR puede usar /disponibilidad pero recibe 403 en /cuentas", async () => {
    const respuestaDisponibilidad = await get("/disponibilidad", cookieVendedor);
    expect(respuestaDisponibilidad.status).toBe(200);
    const respuestaCuentas = await get("/cuentas", cookieVendedor);
    expect(respuestaCuentas.status).toBe(403);
  });

  it("un VENDEDOR puede usar los selectores de /ventas aunque /empresas y /cuentas también estén montados", async () => {
    for (const ruta of ["/ventas/tipos-cliente", "/ventas/duraciones"]) {
      const respuesta = await get(ruta, cookieVendedor);
      expect(respuesta.status).toBe(200);
    }
  });

  it("un ADMIN también puede usar /ventas (jerarquía de rol, no lista cerrada)", async () => {
    const respuesta = await get("/ventas/tipos-cliente", cookieAdmin);
    expect(respuesta.status).toBe(200);
  });

  it("Entrega 9: un VENDEDOR vende y ve /ventas/mias, pero recibe 403 en /listado, /totales y al anular; un ADMIN sí puede usar esas rutas", async () => {
    const respuestaVenta = await post("/ventas", { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }, cookieVendedor);
    expect(respuestaVenta.status).toBe(201);
    const cuerpoVenta = (await respuestaVenta.json()) as { venta: { id: string } };
    const ventaId = cuerpoVenta.venta.id;

    const respuestaMias = await get("/ventas/mias", cookieVendedor);
    expect(respuestaMias.status).toBe(200);

    const respuestaListadoVendedor = await get("/ventas/listado", cookieVendedor);
    expect(respuestaListadoVendedor.status).toBe(403);
    const respuestaTotalesVendedor = await get("/ventas/totales", cookieVendedor);
    expect(respuestaTotalesVendedor.status).toBe(403);
    const respuestaAnularVendedor = await patch(`/ventas/${ventaId}/anular`, cookieVendedor);
    expect(respuestaAnularVendedor.status).toBe(403);

    const respuestaListadoAdmin = await get("/ventas/listado", cookieAdmin);
    expect(respuestaListadoAdmin.status).toBe(200);
    const respuestaTotalesAdmin = await get("/ventas/totales", cookieAdmin);
    expect(respuestaTotalesAdmin.status).toBe(200);
    const respuestaAnularAdmin = await patch(`/ventas/${ventaId}/anular`, cookieAdmin);
    expect(respuestaAnularAdmin.status).toBe(200);
  });

  // Entrega 10: /ventas/codigos se montó después de la guarda de ADMIN de la
  // línea de /listado. Esta prueba existe porque el endpoint devuelve los
  // códigos de TODA la empresa sin paginar: si la guarda se moviera de nivel,
  // un VENDEDOR se llevaría las compras de sus compañeros en una sola llamada.
  it("Entrega 10: /ventas/codigos es solo de ADMIN, trae el conjunto filtrado completo y deja fuera las anuladas", async () => {
    const respuestaVenta = await post("/ventas", { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId }, cookieVendedor);
    expect(respuestaVenta.status).toBe(201);
    const { venta } = (await respuestaVenta.json()) as { venta: { id: string; codigoCompra: string } };

    const respuestaVendedor = await get("/ventas/codigos", cookieVendedor);
    expect(respuestaVendedor.status).toBe(403);

    const respuestaAdmin = await get("/ventas/codigos", cookieAdmin);
    expect(respuestaAdmin.status).toBe(200);
    const { codigos } = (await respuestaAdmin.json()) as { codigos: string[] };
    expect(codigos).toContain(venta.codigoCompra);

    const respuestaAnular = await patch(`/ventas/${venta.id}/anular`, cookieAdmin);
    expect(respuestaAnular.status).toBe(200);

    const despues = await get("/ventas/codigos", cookieAdmin);
    const { codigos: codigosDespues } = (await despues.json()) as { codigos: string[] };
    expect(codigosDespues).not.toContain(venta.codigoCompra);
  });

  // Saldo: un VENDEDOR normal (usaSaldo=false) no ve nada de esto; un ADMIN
  // lo activa como revendedor, le carga saldo, y desde ese momento sus
  // ventas lo consumen. Cubre además R4 (los endpoints de administración de
  // saldo son solo de ADMIN) montado junto al resto de la app compuesta.
  it("Saldo: un VENDEDOR sin usaSaldo no ve saldo propio; ADMIN lo activa, carga saldo, y la venta del VENDEDOR lo consume", async () => {
    const propioAntes = await get("/perfil/saldo", cookieVendedor);
    expect(propioAntes.status).toBe(200);
    expect(await propioAntes.json()).toEqual({ usaSaldo: false, saldo: null });

    const historialAntes = await get("/perfil/saldo/movimientos", cookieVendedor);
    expect(historialAntes.status).toBe(200);
    expect(await historialAntes.json()).toEqual({ movimientos: [] });

    // Un VENDEDOR no puede administrar saldo, ni el propio ni el de otros.
    const usarSaldoDesdeVendedor = await patchBody(`/usuarios/${vendedorId}/usar-saldo`, { usaSaldo: true }, cookieVendedor);
    expect(usarSaldoDesdeVendedor.status).toBe(403);
    const cargarDesdeVendedor = await post(`/usuarios/${vendedorId}/saldo/cargar`, { monto: "50000" }, cookieVendedor);
    expect(cargarDesdeVendedor.status).toBe(403);

    const activar = await patchBody(`/usuarios/${vendedorId}/usar-saldo`, { usaSaldo: true }, cookieAdmin);
    expect(activar.status).toBe(200);
    const { usuario: usuarioActivado } = (await activar.json()) as { usuario: { usaSaldo: boolean; saldo: string } };
    expect(usuarioActivado.usaSaldo).toBe(true);
    expect(new Prisma.Decimal(usuarioActivado.saldo).equals(0)).toBe(true);

    const carga = await post(`/usuarios/${vendedorId}/saldo/cargar`, { monto: "50000" }, cookieAdmin);
    expect(carga.status).toBe(200);
    const { usuario: usuarioCargado } = (await carga.json()) as { usuario: { saldo: string } };
    expect(new Prisma.Decimal(usuarioCargado.saldo).equals(50000)).toBe(true);

    const propioDespuesDeCargar = await get("/perfil/saldo", cookieVendedor);
    const { usaSaldo: usaSaldoDespuesDeCargar, saldo: saldoDespuesDeCargar } = (await propioDespuesDeCargar.json()) as {
      usaSaldo: boolean;
      saldo: string;
    };
    expect(usaSaldoDespuesDeCargar).toBe(true);
    expect(new Prisma.Decimal(saldoDespuesDeCargar).equals(50000)).toBe(true);

    const respuestaVenta = await post(
      "/ventas",
      { tipoVenta: "UNIDAD", plataformaId, duracionId, tipoClienteId },
      cookieVendedor,
    );
    expect(respuestaVenta.status).toBe(201);
    const { venta } = (await respuestaVenta.json()) as { venta: { id: string; precioVenta: string } };

    const propioDespuesDeVender = await get("/perfil/saldo", cookieVendedor);
    const { saldo: saldoDespuesDeVender } = (await propioDespuesDeVender.json()) as { saldo: string };
    expect(new Prisma.Decimal(saldoDespuesDeVender).equals(new Prisma.Decimal("50000").minus(venta.precioVenta))).toBe(
      true,
    );

    // El VENDEDOR ve su propio historial; un ADMIN ve el historial de
    // cualquiera de su empresa desde /usuarios.
    const historialPropio = await get("/perfil/saldo/movimientos", cookieVendedor);
    const { movimientos: movimientosPropios } = (await historialPropio.json()) as { movimientos: unknown[] };
    expect(movimientosPropios.length).toBe(2); // CARGA + CONSUMO

    const historialDesdeAdmin = await get(`/usuarios/${vendedorId}/saldo/movimientos`, cookieAdmin);
    expect(historialDesdeAdmin.status).toBe(200);
    const { movimientos: movimientosDesdeAdmin } = (await historialDesdeAdmin.json()) as { movimientos: unknown[] };
    expect(movimientosDesdeAdmin.length).toBe(2);

    const historialDesdeVendedorSobreSiMismo = await get(`/usuarios/${vendedorId}/saldo/movimientos`, cookieVendedor);
    expect(historialDesdeVendedorSobreSiMismo.status).toBe(403);
  });

  // Regresión: paquetes.ts, precios.ts, cuentas.ts, disponibilidad.ts y
  // ventas.ts declaraban su propio onBeforeHandle de SIN_EMPRESA_ACTIVA con
  // { as: "scoped" } directamente sobre la instancia exportada que index.ts
  // monta sobre app. "scoped" sube exactamente un nivel — y como esa
  // instancia se monta directo sobre app, ese nivel ES app, así que el hook
  // se aplicaba a TODA la app compuesta. Para cualquier request sin empresa
  // activa (sin cookie o con versionSesion vencida), paquetes.ts respondía
  // primero (es el primero de los cinco en montarse) y tapaba el 401/403
  // real de /cuentas, /disponibilidad, /plantillas y /perfil con un 400
  // SIN_EMPRESA_ACTIVA ajeno. Las pruebas por router nunca lo detectan
  // porque cada router se prueba con sesión válida o aislado con .handle().
  it("una petición sin cookie recibe el 401/403 propio de cada router, no un SIN_EMPRESA_ACTIVA filtrado desde paquetes/precios/cuentas/disponibilidad/ventas", async () => {
    const sinCookie = async (ruta: string) => app.handle(new Request(`http://local${ruta}`));

    const respuestaPerfil = await sinCookie("/perfil");
    expect(respuestaPerfil.status).toBe(401);
    expect(((await respuestaPerfil.json()) as RespuestaError).error.codigo).toBe("NO_AUTENTICADO");

    for (const ruta of ["/perfil/saldo", "/perfil/saldo/movimientos"]) {
      const respuesta = await sinCookie(ruta);
      expect(respuesta.status).toBe(401);
      expect(((await respuesta.json()) as RespuestaError).error.codigo).toBe("NO_AUTENTICADO");
    }

    for (const ruta of ["/cuentas", "/disponibilidad", "/plantillas", "/paquetes"]) {
      const respuesta = await sinCookie(ruta);
      expect(respuesta.status).toBe(403);
      expect(((await respuesta.json()) as RespuestaError).error.codigo).toBe("PERMISO_DENEGADO");
    }

    // Cuerpo válido en cada caso: la validación del esquema corre antes que
    // la guarda de autenticación, así que un cuerpo vacío daría 422 por la
    // razón equivocada, no 401 por falta de sesión.
    const sinCookieConMetodo = async (metodo: string, ruta: string, cuerpo?: unknown) =>
      app.handle(
        new Request(`http://local${ruta}`, {
          method: metodo,
          headers: cuerpo !== undefined ? { "content-type": "application/json" } : {},
          body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
        }),
      );

    // Mismo comportamiento que /cuentas, /disponibilidad, etc. en esta app
    // compuesta: 403 PERMISO_DENEGADO, no 401 (ver el bloque anterior).
    for (const [metodo, ruta, cuerpo] of [
      ["PATCH", `/usuarios/${vendedorId}/usar-saldo`, { usaSaldo: true }],
      ["POST", `/usuarios/${vendedorId}/saldo/cargar`, { monto: "1000" }],
      ["POST", `/usuarios/${vendedorId}/saldo/ajuste`, { monto: "1000", nota: "x" }],
      ["GET", `/usuarios/${vendedorId}/saldo/movimientos`, undefined],
    ] as const) {
      const respuesta = await sinCookieConMetodo(metodo, ruta, cuerpo);
      expect(respuesta.status).toBe(403);
      expect(((await respuesta.json()) as RespuestaError).error.codigo).toBe("PERMISO_DENEGADO");
    }
  });
});
