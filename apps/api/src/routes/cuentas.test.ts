import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
// prismaRaw en este archivo: excepción explícita — arma la fixture (empresa,
// usuarios, plataformas, venta de prueba) fuera de cualquier contexto de
// empresa autenticado, igual que en catalogo-permisos.test.ts.
import { prismaRaw } from "../lib/prisma.ts";
import { cifrar, descifrar } from "../lib/cifrado.ts";
import { auth } from "./auth.ts";
import { cuentas } from "./cuentas.ts";
import { disponibilidad } from "./disponibilidad.ts";
import { plataformas } from "./plataformas.ts";

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

describe("Cuentas, pantallas, perfiles y pines", () => {
  let empresaId: string;
  let cookieAdmin: string;
  let cookieVendedor: string;
  // Capacidad ahora es de la PLATAFORMA (su plantilla), no de la cuenta que
  // se crea — cada escenario que necesita un número distinto de pantallas
  // usa su propia plataforma con su propia plantilla.
  let plataformaConPerfilId: string; // alias de plataformaPerfil4Id, usado por (f)/(g), que no dependen del tamaño.
  let plataformaPerfil4Id: string;
  let plataformaSinPerfilId: string;
  let plataformaPerfil1Id: string;
  let plataformaPerfil2Id: string;
  let plataformaPerfil3Id: string;
  let plataformaSinPlantillaId: string;
  let plataformaCamposId: string;
  let plataformaPropagacionId: string;

  async function crearPlantilla(plataformaId: string, filas: { perfil: string | null; pin: string | null }[]) {
    await prismaRaw.plataformaPantalla.createMany({
      data: filas.map((f, i) => ({
        empresaId,
        plataformaId,
        numero: i + 1,
        perfil: f.perfil,
        pin: f.pin ? cifrar(f.pin) : null,
      })),
    });
    await prismaRaw.plataforma.update({ where: { id: plataformaId }, data: { capacidadPantallas: filas.length } });
  }

  beforeAll(async () => {
    const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

    const empresa = await prismaRaw.empresa.create({
      data: { nombre: "Empresa cuentas (cuentas.test)", prefijoCodigo: "CTA" },
    });
    empresaId = empresa.id;

    const adminEmail = `admin-cuentas-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
    });
    cookieAdmin = await iniciarSesion(adminEmail);

    const vendedorEmail = `vendedor-cuentas-${randomUUID()}@test.local`;
    await prismaRaw.usuario.create({
      data: { empresaId, email: vendedorEmail, passwordHash: hash, nombre: "Vendedor", rol: "VENDEDOR" },
    });
    cookieVendedor = await iniciarSesion(vendedorEmail);

    const plataformaPerfil4 = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix 4 pantallas (cuentas.test)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaPerfil4Id = plataformaPerfil4.id;
    plataformaConPerfilId = plataformaPerfil4Id;
    await crearPlantilla(plataformaPerfil4Id, [
      { perfil: "A", pin: "1111" },
      { perfil: "B", pin: "2222" },
      { perfil: "C", pin: "3333" },
      { perfil: "D", pin: "4444" },
    ]);

    const plataformaSinPerfil = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "YouTube Premium (cuentas.test)", capacidadPantallas: 1, usaPerfilPin: false },
    });
    plataformaSinPerfilId = plataformaSinPerfil.id;
    await crearPlantilla(plataformaSinPerfilId, [
      { perfil: null, pin: null },
      { perfil: null, pin: null },
    ]);

    const plataformaPerfil1 = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix 1 pantalla (cuentas.test)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaPerfil1Id = plataformaPerfil1.id;
    await crearPlantilla(plataformaPerfil1Id, [{ perfil: "A", pin: "9999" }]);

    const plataformaPerfil2 = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix 2 pantallas (cuentas.test)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaPerfil2Id = plataformaPerfil2.id;
    await crearPlantilla(plataformaPerfil2Id, [
      { perfil: "A", pin: "1212" },
      { perfil: "B", pin: "3434" },
    ]);

    const plataformaPerfil3 = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Netflix 3 pantallas (cuentas.test)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaPerfil3Id = plataformaPerfil3.id;
    await crearPlantilla(plataformaPerfil3Id, [
      { perfil: "A", pin: "5656" },
      { perfil: "B", pin: "7878" },
      { perfil: "C", pin: "9090" },
    ]);

    // A propósito, SIN plantilla: para el caso de negocio de la Parte 2
    // ("crear una cuenta en una plataforma sin plantilla falla con error de
    // negocio, no 500, y no deja la cuenta creada sin pantallas").
    const plataformaSinPlantilla = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Disney sin plantilla (cuentas.test)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaSinPlantillaId = plataformaSinPlantilla.id;

    // F4.2 parte 1 — plataforma con una combinación de campos distinta a la
    // predeterminada (usuario/código sí, correo/enlace no) para probar
    // validarCamposDeAcceso con algo que no sea el caso por defecto.
    const plataformaCampos = await prismaRaw.plataforma.create({
      data: {
        empresaId,
        nombre: "Plataforma usuario+codigo (cuentas.test)",
        capacidadPantallas: 1,
        usaPerfilPin: false,
        usaCorreo: false,
        usaUsuario: true,
        usaCodigo: true,
        usaEnlace: false,
      },
    });
    plataformaCamposId = plataformaCampos.id;
    await crearPlantilla(plataformaCamposId, [{ perfil: null, pin: null }]);

    // F4.2 parte 2.1 — dos pantallas con el MISMO perfil en la misma cuenta,
    // para probar la propagación de PIN entre hermanas (PATCH /pantallas).
    const plataformaPropagacion = await prismaRaw.plataforma.create({
      data: { empresaId, nombre: "Plataforma propagación PIN (cuentas.test)", capacidadPantallas: 1, usaPerfilPin: true },
    });
    plataformaPropagacionId = plataformaPropagacion.id;
    await crearPlantilla(plataformaPropagacionId, [
      { perfil: "A", pin: "1111" },
      { perfil: "A", pin: "1111" },
      { perfil: "B", pin: "2222" },
    ]);
  });

  afterAll(async () => {
    await prismaRaw.ventaDetalle.deleteMany({ where: { empresaId } });
    await prismaRaw.venta.deleteMany({ where: { empresaId } });
    await prismaRaw.pantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.cuenta.deleteMany({ where: { empresaId } });
    await prismaRaw.duracion.deleteMany({ where: { empresaId } });
    await prismaRaw.tipoCliente.deleteMany({ where: { empresaId } });
    await prismaRaw.plataformaPantalla.deleteMany({ where: { empresaId } });
    await prismaRaw.plataforma.deleteMany({ where: { empresaId } });
    await prismaRaw.usuario.deleteMany({ where: { empresaId } });
    await prismaRaw.empresa.delete({ where: { id: empresaId } });
  });

  async function post(ruta: string, body: unknown, cookie: string = cookieAdmin) {
    return cuentas.handle(
      new Request(`http://local${ruta}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  async function patch(ruta: string, body: unknown, cookie: string = cookieAdmin) {
    return cuentas.handle(
      new Request(`http://local${ruta}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    );
  }

  async function get(ruta: string, cookie: string = cookieAdmin) {
    return cuentas.handle(new Request(`http://local${ruta}`, { headers: { cookie } }));
  }

  it("(a) crear una cuenta en una plataforma con usaPerfilPin genera N pantallas con perfiles A, B, C... y PINes de 4 dígitos distintos", async () => {
    const respuesta = await post("/cuentas", {
      plataformaId: plataformaPerfil4Id,
      correo: `cuenta-perfil-${randomUUID()}@cuentas.test`,
      password: "Secreto#1",
    });
    expect(respuesta.status).toBe(201);
    const { cuenta } = (await respuesta.json()) as { cuenta: { id: string } };

    const credenciales = await get(`/cuentas/${cuenta.id}/credenciales`);
    const { pantallas } = (await credenciales.json()) as {
      pantallas: { numero: number; pin: string | null }[];
    };

    const detalle = await get(`/cuentas/${cuenta.id}`);
    const { pantallas: pantallasDetalle } = (await detalle.json()) as {
      pantallas: { numero: number; perfil: string | null }[];
    };

    expect(pantallasDetalle.map((p) => p.perfil).sort()).toEqual(["A", "B", "C", "D"]);
    expect(pantallas).toHaveLength(4);
    for (const p of pantallas) {
      expect(p.pin).toMatch(/^[0-9]{4}$/);
    }
    expect(new Set(pantallas.map((p) => p.pin)).size).toBe(4);
  });

  it("(b) crear una cuenta en una plataforma sin perfiles deja perfil y pin en null", async () => {
    const respuesta = await post("/cuentas", {
      plataformaId: plataformaSinPerfilId,
      correo: `cuenta-sin-perfil-${randomUUID()}@cuentas.test`,
      password: "Secreto#2",
    });
    expect(respuesta.status).toBe(201);
    const { cuenta } = (await respuesta.json()) as { cuenta: { id: string } };

    const detalle = await get(`/cuentas/${cuenta.id}`);
    const { pantallas } = (await detalle.json()) as { pantallas: { perfil: string | null }[] };
    expect(pantallas.every((p) => p.perfil === null)).toBe(true);

    const credenciales = await get(`/cuentas/${cuenta.id}/credenciales`);
    const { pantallas: pantallasCredenciales } = (await credenciales.json()) as {
      pantallas: { pin: string | null }[];
    };
    expect(pantallasCredenciales.every((p) => p.pin === null)).toBe(true);
  });

  it("(c) password y pin quedan cifrados en la BD y se recuperan correctamente", async () => {
    const correo = `cuenta-cifrado-${randomUUID()}@cuentas.test`;
    const respuesta = await post("/cuentas", {
      plataformaId: plataformaPerfil1Id,
      correo,
      password: "Secreto#Cifrado3",
    });
    const { cuenta } = (await respuesta.json()) as { cuenta: { id: string } };

    const filaCruda = await prismaRaw.cuenta.findUnique({ where: { id: cuenta.id } });
    expect(filaCruda?.password).not.toBe("Secreto#Cifrado3");

    const pantallaCruda = await prismaRaw.pantalla.findFirst({ where: { cuentaId: cuenta.id } });
    expect(pantallaCruda?.pin).not.toBeNull();
    expect(pantallaCruda?.pin).not.toMatch(/^[0-9]{4}$/);

    const credenciales = await get(`/cuentas/${cuenta.id}/credenciales`);
    const { password, pantallas } = (await credenciales.json()) as {
      password: string;
      pantallas: { pin: string | null }[];
    };
    expect(password).toBe("Secreto#Cifrado3");
    expect(pantallas[0]?.pin).toMatch(/^[0-9]{4}$/);
  });

  it("(d) subir la capacidad genera solo las pantallas faltantes, sin tocar las existentes ni reiniciar la numeración", async () => {
    const respuesta = await post("/cuentas", {
      plataformaId: plataformaPerfil2Id,
      correo: `cuenta-subir-${randomUUID()}@cuentas.test`,
      password: "Secreto#4",
    });
    const { cuenta } = (await respuesta.json()) as { cuenta: { id: string } };

    const antes = await get(`/cuentas/${cuenta.id}`);
    const { pantallas: pantallasAntes } = (await antes.json()) as { pantallas: { id: string; numero: number }[] };
    const idsOriginales = new Map(pantallasAntes.map((p) => [p.numero, p.id]));

    const subir = await patch(`/cuentas/${cuenta.id}`, { capacidadPantallas: 4 });
    expect(subir.status).toBe(200);

    const despues = await get(`/cuentas/${cuenta.id}`);
    const { pantallas: pantallasDespues } = (await despues.json()) as {
      pantallas: { id: string; numero: number; activa: boolean }[];
    };

    expect(pantallasDespues.map((p) => p.numero).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(pantallasDespues.every((p) => p.activa)).toBe(true);
    // Las dos originales no se tocan: mismo id que antes.
    for (const p of pantallasDespues.filter((p) => p.numero <= 2)) {
      expect(idsOriginales.has(p.numero)).toBe(true);
      expect(p.id).toBe(idsOriginales.get(p.numero) as string);
    }
  });

  it("(e) bajar la capacidad con una pantalla ocupada se rechaza; con todas libres funciona", async () => {
    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (cuentas.test)", cantidad: 30, unidad: "DIAS" },
    });
    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Normal (cuentas.test)" },
    });
    const vendedor = await prismaRaw.usuario.findFirstOrThrow({ where: { empresaId, rol: "VENDEDOR" } });

    const respuesta = await post("/cuentas", {
      plataformaId: plataformaPerfil3Id,
      correo: `cuenta-bajar-${randomUUID()}@cuentas.test`,
      password: "Secreto#5",
    });
    const { cuenta } = (await respuesta.json()) as { cuenta: { id: string } };

    const detalle = await get(`/cuentas/${cuenta.id}`);
    const { pantallas } = (await detalle.json()) as { pantallas: { id: string; numero: number }[] };
    const pantalla3 = pantallas.find((p) => p.numero === 3)!;

    const venta = await prismaRaw.venta.create({
      data: {
        empresaId,
        vendedorId: vendedor.id,
        codigoCompra: `CTA-${randomUUID()}`,
        tipoVenta: "UNIDAD",
        plataformaId: plataformaPerfil3Id,
        duracionId: duracion.id,
        tipoClienteId: tipoCliente.id,
        nombreItem: "Netflix",
        nombreDuracion: duracion.nombre,
        cantidadDuracion: duracion.cantidad,
        unidadDuracion: duracion.unidad,
        nombreTipoCliente: tipoCliente.nombre,
        precioVenta: "10000",
        precioSugerido: "10000",
        costo: "5000",
        utilidad: "5000",
        fechaVencimientoMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        mensajeGenerado: "mensaje de prueba",
      },
    });
    await prismaRaw.ventaDetalle.create({
      data: {
        empresaId,
        ventaId: venta.id,
        pantallaId: pantalla3.id,
        cuentaId: cuenta.id,
        plataformaId: plataformaPerfil3Id,
        nombrePlataforma: "Netflix",
        correoCuenta: "correo@cuenta.test",
        passwordCuenta: "cifrado",
        duracionId: duracion.id,
        cantidadDuracion: duracion.cantidad,
        unidadDuracion: duracion.unidad,
        fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const bajarConOcupada = await patch(`/cuentas/${cuenta.id}`, { capacidadPantallas: 1 });
    expect(bajarConOcupada.status).toBe(400);
    const cuerpoError = (await bajarConOcupada.json()) as { error: { codigo: string; mensaje: string } };
    expect(cuerpoError.error.codigo).toBe("PANTALLAS_OCUPADAS");
    expect(cuerpoError.error.mensaje).toContain("#3");

    // Libera la pantalla ocupada y reintenta: ahora todas están libres.
    await prismaRaw.venta.update({ where: { id: venta.id }, data: { anulada: true } });

    const bajarConTodasLibres = await patch(`/cuentas/${cuenta.id}`, { capacidadPantallas: 1 });
    expect(bajarConTodasLibres.status).toBe(200);

    const detalleFinal = await get(`/cuentas/${cuenta.id}`);
    const { pantallas: pantallasFinal } = (await detalleFinal.json()) as {
      pantallas: { numero: number; activa: boolean }[];
    };
    expect(pantallasFinal.find((p) => p.numero === 1)?.activa).toBe(true);
    expect(pantallasFinal.find((p) => p.numero === 2)?.activa).toBe(false);
    expect(pantallasFinal.find((p) => p.numero === 3)?.activa).toBe(false);
  });

  it("(f) un VENDEDOR obtiene 403 en todos los endpoints de cuentas, y disponibilidad no expone ningún campo de credenciales", async () => {
    const respuestaListado = await get("/cuentas", cookieVendedor);
    expect(respuestaListado.status).toBe(403);

    const respuestaCrear = await post(
      "/cuentas",
      { plataformaId: plataformaConPerfilId, correo: "x@x.com", password: "x" },
      cookieVendedor,
    );
    expect(respuestaCrear.status).toBe(403);

    const respuestaDisponibilidad = await disponibilidad.handle(
      new Request("http://local/disponibilidad", { headers: { cookie: cookieVendedor } }),
    );
    expect(respuestaDisponibilidad.status).toBe(200);
    const cuerpo = (await respuestaDisponibilidad.json()) as { disponibilidad: Record<string, unknown>[] };
    for (const fila of cuerpo.disponibilidad) {
      expect(Object.keys(fila).sort()).toEqual([
        "capacidadPantallas",
        "libres",
        "nombre",
        "plataformaId",
        "total",
        "usaCodigo",
        "usaCorreo",
        "usaEnlace",
        "usaPerfilPin",
        "usaUsuario",
      ]);
    }
  });

  it("(g) ningún listado de cuentas incluye password ni pin en la respuesta", async () => {
    const respuesta = await get("/cuentas");
    const texto = await respuesta.text();
    expect(texto).not.toContain("password");
    expect(texto).not.toContain("pin");

    const detalle = await get(`/cuentas?plataformaId=${plataformaConPerfilId}`);
    const textoDetalle = await detalle.text();
    expect(textoDetalle).not.toContain("password");
    expect(textoDetalle).not.toContain('"pin"');
  });

  it("(h) crear una cuenta en una plataforma sin plantilla configurada falla con error de negocio, no 500, y no deja la cuenta creada", async () => {
    const antes = await prismaRaw.cuenta.count({ where: { plataformaId: plataformaSinPlantillaId } });

    const respuesta = await post("/cuentas", {
      plataformaId: plataformaSinPlantillaId,
      correo: `cuenta-sin-plantilla-${randomUUID()}@cuentas.test`,
      password: "Secreto#6",
    });
    expect(respuesta.status).toBe(400);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string; mensaje: string } };
    expect(cuerpo.error.codigo).toBe("PLANTILLA_NO_CONFIGURADA");
    expect(cuerpo.error.mensaje).toContain("Disney sin plantilla");

    const despues = await prismaRaw.cuenta.count({ where: { plataformaId: plataformaSinPlantillaId } });
    expect(despues).toBe(antes);
  });

  it("(i) editar la plantilla de una plataforma no cambia las pantallas de una cuenta ya creada", async () => {
    const respuestaCrear = await post("/cuentas", {
      plataformaId: plataformaPerfil1Id,
      correo: `cuenta-plantilla-fija-${randomUUID()}@cuentas.test`,
      password: "Secreto#7",
    });
    expect(respuestaCrear.status).toBe(201);
    const { cuenta } = (await respuestaCrear.json()) as { cuenta: { id: string } };

    const pantallaAntes = await prismaRaw.pantalla.findFirstOrThrow({ where: { cuentaId: cuenta.id } });
    expect(pantallaAntes.perfil).toBe("A");
    expect(descifrar(pantallaAntes.pin!)).toBe("9999");

    const respuestaPut = await plataformas.handle(
      new Request(`http://local/plataformas/${plataformaPerfil1Id}/pantallas`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: cookieAdmin },
        body: JSON.stringify({ pantallas: [{ perfil: "Z", pin: "0000" }] }),
      }),
    );
    expect(respuestaPut.status).toBe(200);

    const pantallaDespues = await prismaRaw.pantalla.findFirstOrThrow({ where: { id: pantallaAntes.id } });
    expect(pantallaDespues.perfil).toBe("A");
    expect(descifrar(pantallaDespues.pin!)).toBe("9999");
  });

  it("(j) crear cuenta: falla si falta un campo que la plataforma exige, o si llega uno que no usa", async () => {
    const sinUsuario = await post("/cuentas", {
      plataformaId: plataformaCamposId,
      codigo: "ABC123",
      password: "Secreto#8",
    });
    expect(sinUsuario.status).toBe(409);
    expect(((await sinUsuario.json()) as { error: { codigo: string } }).error.codigo).toBe("CAMPO_REQUERIDO_POR_PLATAFORMA");

    const sinCodigo = await post("/cuentas", {
      plataformaId: plataformaCamposId,
      usuario: "usuario_prime",
      password: "Secreto#8",
    });
    expect(sinCodigo.status).toBe(409);
    expect(((await sinCodigo.json()) as { error: { codigo: string } }).error.codigo).toBe("CAMPO_REQUERIDO_POR_PLATAFORMA");

    const conCorreoNoUsado = await post("/cuentas", {
      plataformaId: plataformaCamposId,
      usuario: "usuario_prime",
      codigo: "ABC123",
      correo: "no-deberia-llegar@cuentas.test",
      password: "Secreto#8",
    });
    expect(conCorreoNoUsado.status).toBe(409);
    expect(((await conCorreoNoUsado.json()) as { error: { codigo: string } }).error.codigo).toBe(
      "CAMPO_REQUERIDO_POR_PLATAFORMA",
    );

    const correcta = await post("/cuentas", {
      plataformaId: plataformaCamposId,
      usuario: "usuario_prime",
      codigo: "ABC123",
      password: "Secreto#8",
    });
    expect(correcta.status).toBe(201);
    const { cuenta } = (await correcta.json()) as { cuenta: { id: string; correo: string | null; usuario: string | null } };
    expect(cuenta.correo).toBeNull();
    expect(cuenta.usuario).toBe("usuario_prime");

    const credenciales = await get(`/cuentas/${cuenta.id}/credenciales`);
    const cuerpoCredenciales = (await credenciales.json()) as { codigo: string | null };
    expect(cuerpoCredenciales.codigo).toBe("ABC123");
  });

  it("(k) editar cuenta: el PATCH solo valida los campos de acceso que de verdad vienen en el body", async () => {
    const creada = await post("/cuentas", {
      plataformaId: plataformaCamposId,
      usuario: "usuario_original",
      codigo: "CODIGO_ORIGINAL",
      password: "Secreto#9",
    });
    const { cuenta } = (await creada.json()) as { cuenta: { id: string } };

    // No manda usuario ni codigo: no debe exigirlos de nuevo, aunque la
    // plataforma los requiera — "editar" solo valida lo presente en el body.
    const soloNotas = await patch(`/cuentas/${cuenta.id}`, { notas: "nota de prueba", capacidadPantallas: 1 });
    expect(soloNotas.status).toBe(200);

    // Manda usuario vacío explícitamente: ahora sí está presente, y la
    // plataforma lo exige -> 409.
    const usuarioVacio = await patch(`/cuentas/${cuenta.id}`, { usuario: "", capacidadPantallas: 1 });
    expect(usuarioVacio.status).toBe(409);
    expect(((await usuarioVacio.json()) as { error: { codigo: string } }).error.codigo).toBe(
      "CAMPO_REQUERIDO_POR_PLATAFORMA",
    );

    // Manda correo, que esta plataforma no usa -> 409, aunque no toque usuario/codigo.
    const correoNoUsado = await patch(`/cuentas/${cuenta.id}`, { correo: "nuevo@cuentas.test", capacidadPantallas: 1 });
    expect(correoNoUsado.status).toBe(409);
    expect(((await correoNoUsado.json()) as { error: { codigo: string } }).error.codigo).toBe(
      "CAMPO_REQUERIDO_POR_PLATAFORMA",
    );
  });

  it("(l) PATCH de pantalla: cambiar el PIN de una pantalla propaga el mismo PIN a sus hermanas de perfil", async () => {
    const creada = await post("/cuentas", {
      plataformaId: plataformaPropagacionId,
      correo: `cuenta-propagacion-${randomUUID()}@cuentas.test`,
      password: "Secreto#10",
    });
    const { cuenta } = (await creada.json()) as { cuenta: { id: string } };

    const detalle = await get(`/cuentas/${cuenta.id}`);
    const { pantallas } = (await detalle.json()) as { pantallas: { id: string; numero: number; perfil: string | null }[] };
    const hermanasPerfilA = pantallas.filter((p) => p.perfil === "A").sort((a, b) => a.numero - b.numero);
    expect(hermanasPerfilA).toHaveLength(2);
    const [pantallaA1, pantallaA2] = hermanasPerfilA;

    const respuesta = await patch(`/cuentas/${cuenta.id}/pantallas/${pantallaA1.id}`, { perfil: "A", pin: "7777" });
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as { pantallasHermanasActualizadas: number[] };
    expect(cuerpo.pantallasHermanasActualizadas).toEqual([pantallaA2.numero]);

    const credenciales = await get(`/cuentas/${cuenta.id}/credenciales`);
    const { pantallas: pantallasCredenciales } = (await credenciales.json()) as {
      pantallas: { numero: number; pin: string | null }[];
    };
    expect(pantallasCredenciales.find((p) => p.numero === pantallaA1.numero)?.pin).toBe("7777");
    expect(pantallasCredenciales.find((p) => p.numero === pantallaA2.numero)?.pin).toBe("7777");
    // La hermana de perfil B no se toca.
    const pantallaB = pantallas.find((p) => p.perfil === "B")!;
    expect(pantallasCredenciales.find((p) => p.numero === pantallaB.numero)?.pin).toBe("2222");
  });

  // F4.7, arreglo 5 — cambiar el perfil de una pantalla sin mandar un pin
  // propio debe adoptar el pin que ya tienen las hermanas del perfil
  // destino. Antes de este arreglo la propagación solo corría si
  // body.pin !== undefined: perfil A pin 1111 (x2) y perfil B pin 2222 (x1)
  // → mover la de B a A sin pin dejaba dos pines para el mismo perfil.
  it("(l2) PATCH de pantalla: mover el perfil sin mandar pin adopta el pin de las hermanas del perfil destino", async () => {
    const creada = await post("/cuentas", {
      plataformaId: plataformaPropagacionId,
      correo: `cuenta-mueve-perfil-${randomUUID()}@cuentas.test`,
      password: "Secreto#12",
    });
    const { cuenta } = (await creada.json()) as { cuenta: { id: string } };

    const detalle = await get(`/cuentas/${cuenta.id}`);
    const { pantallas } = (await detalle.json()) as { pantallas: { id: string; numero: number; perfil: string | null }[] };
    const pantallaB = pantallas.find((p) => p.perfil === "B")!;

    const respuesta = await patch(`/cuentas/${cuenta.id}/pantallas/${pantallaB.id}`, { perfil: "A" });
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as { pantalla: { perfil: string | null } };
    expect(cuerpo.pantalla.perfil).toBe("A");

    const detalleDespues = await get(`/cuentas/${cuenta.id}`);
    const { pantallas: pantallasDespues } = (await detalleDespues.json()) as {
      pantallas: { numero: number; perfil: string | null }[];
    };
    const numerosPerfilA = pantallasDespues.filter((p) => p.perfil === "A").map((p) => p.numero);
    expect(numerosPerfilA).toHaveLength(3);

    const credenciales = await get(`/cuentas/${cuenta.id}/credenciales`);
    const { pantallas: pantallasCredenciales } = (await credenciales.json()) as {
      pantallas: { numero: number; pin: string | null }[];
    };
    // Las tres pantallas de perfil A (las dos originales + la que se mudó)
    // comparten el mismo pin: ya no hay dos pines para la misma puerta.
    for (const numero of numerosPerfilA) {
      expect(pantallasCredenciales.find((p) => p.numero === numero)?.pin).toBe("1111");
    }
  });

  it("(m) PATCH de pantalla: una pantalla vendida bloquea el cambio salvo confirmarPantallaVendida", async () => {
    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (cuentas.test, pantalla vendida)", cantidad: 30, unidad: "DIAS" },
    });
    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Normal (cuentas.test, pantalla vendida)" },
    });
    const vendedor = await prismaRaw.usuario.findFirstOrThrow({ where: { empresaId, rol: "VENDEDOR" } });

    const creada = await post("/cuentas", {
      plataformaId: plataformaPerfil1Id,
      correo: `cuenta-vendida-${randomUUID()}@cuentas.test`,
      password: "Secreto#11",
    });
    const { cuenta } = (await creada.json()) as { cuenta: { id: string } };
    const detalle = await get(`/cuentas/${cuenta.id}`);
    const { pantallas } = (await detalle.json()) as { pantallas: { id: string; numero: number }[] };
    const pantalla = pantallas[0];

    const codigoCompra = `CTA-PV-${randomUUID()}`;
    const venta = await prismaRaw.venta.create({
      data: {
        empresaId,
        vendedorId: vendedor.id,
        codigoCompra,
        tipoVenta: "UNIDAD",
        plataformaId: plataformaPerfil1Id,
        duracionId: duracion.id,
        tipoClienteId: tipoCliente.id,
        nombreItem: "Netflix",
        nombreDuracion: duracion.nombre,
        cantidadDuracion: duracion.cantidad,
        unidadDuracion: duracion.unidad,
        nombreTipoCliente: tipoCliente.nombre,
        precioVenta: "10000",
        precioSugerido: "10000",
        costo: "5000",
        utilidad: "5000",
        fechaVencimientoMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        mensajeGenerado: "mensaje de prueba",
      },
    });
    await prismaRaw.ventaDetalle.create({
      data: {
        empresaId,
        ventaId: venta.id,
        pantallaId: pantalla.id,
        cuentaId: cuenta.id,
        plataformaId: plataformaPerfil1Id,
        nombrePlataforma: "Netflix",
        correoCuenta: "correo@cuenta.test",
        passwordCuenta: "cifrado",
        duracionId: duracion.id,
        cantidadDuracion: duracion.cantidad,
        unidadDuracion: duracion.unidad,
        fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const bloqueada = await patch(`/cuentas/${cuenta.id}/pantallas/${pantalla.id}`, { perfil: "A", pin: "8888" });
    expect(bloqueada.status).toBe(409);
    const cuerpoBloqueada = (await bloqueada.json()) as {
      error: { codigo: string };
      codigosCompraAfectados: string[];
    };
    expect(cuerpoBloqueada.error.codigo).toBe("PANTALLA_VENDIDA");
    expect(cuerpoBloqueada.codigosCompraAfectados).toEqual([codigoCompra]);

    // R3: la copia histórica en VentaDetalle nunca se toca, pase lo que pase.
    const ventaDetalleAntes = await prismaRaw.ventaDetalle.findFirstOrThrow({ where: { ventaId: venta.id } });

    const confirmada = await patch(`/cuentas/${cuenta.id}/pantallas/${pantalla.id}`, {
      perfil: "A",
      pin: "8888",
      confirmarPantallaVendida: true,
    });
    expect(confirmada.status).toBe(200);

    const credenciales = await get(`/cuentas/${cuenta.id}/credenciales`);
    const { pantallas: pantallasCredenciales } = (await credenciales.json()) as {
      pantallas: { numero: number; pin: string | null }[];
    };
    expect(pantallasCredenciales.find((p) => p.numero === pantalla.numero)?.pin).toBe("8888");

    const ventaDetalleDespues = await prismaRaw.ventaDetalle.findFirstOrThrow({ where: { ventaId: venta.id } });
    expect(ventaDetalleDespues.passwordCuenta).toBe(ventaDetalleAntes.passwordCuenta);
  });

  it("(m2) PATCH de pantalla: el 409 PANTALLA_VENDIDA nombra a TODOS los compradores, no solo al más reciente", async () => {
    const duracion = await prismaRaw.duracion.create({
      data: { empresaId, nombre: "30 días (cuentas.test, sobreventa)", cantidad: 30, unidad: "DIAS" },
    });
    const tipoCliente = await prismaRaw.tipoCliente.create({
      data: { empresaId, nombre: "Normal (cuentas.test, sobreventa)" },
    });
    const vendedor = await prismaRaw.usuario.findFirstOrThrow({ where: { empresaId, rol: "VENDEDOR" } });

    const creada = await post("/cuentas", {
      plataformaId: plataformaPerfil1Id,
      correo: `cuenta-sobrevendida-${randomUUID()}@cuentas.test`,
      password: "Secreto#11",
    });
    const { cuenta } = (await creada.json()) as { cuenta: { id: string } };
    const detalle = await get(`/cuentas/${cuenta.id}`);
    const { pantallas } = (await detalle.json()) as { pantallas: { id: string; numero: number }[] };
    const pantalla = pantallas[0];

    // El cliente sobrevende a propósito: dos ventas vigentes y no anuladas
    // ocupan la MISMA pantalla al mismo tiempo.
    const codigoCompraUno = `CTA-SV1-${randomUUID()}`;
    const codigoCompraDos = `CTA-SV2-${randomUUID()}`;
    for (const codigoCompra of [codigoCompraUno, codigoCompraDos]) {
      const venta = await prismaRaw.venta.create({
        data: {
          empresaId,
          vendedorId: vendedor.id,
          codigoCompra,
          tipoVenta: "UNIDAD",
          plataformaId: plataformaPerfil1Id,
          duracionId: duracion.id,
          tipoClienteId: tipoCliente.id,
          nombreItem: "Netflix",
          nombreDuracion: duracion.nombre,
          cantidadDuracion: duracion.cantidad,
          unidadDuracion: duracion.unidad,
          nombreTipoCliente: tipoCliente.nombre,
          precioVenta: "10000",
          precioSugerido: "10000",
          costo: "5000",
          utilidad: "5000",
          fechaVencimientoMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          mensajeGenerado: "mensaje de prueba",
        },
      });
      await prismaRaw.ventaDetalle.create({
        data: {
          empresaId,
          ventaId: venta.id,
          pantallaId: pantalla.id,
          cuentaId: cuenta.id,
          plataformaId: plataformaPerfil1Id,
          nombrePlataforma: "Netflix",
          correoCuenta: "correo@cuenta.test",
          passwordCuenta: "cifrado",
          duracionId: duracion.id,
          cantidadDuracion: duracion.cantidad,
          unidadDuracion: duracion.unidad,
          fechaVencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }

    const bloqueada = await patch(`/cuentas/${cuenta.id}/pantallas/${pantalla.id}`, { perfil: "A", pin: "8888" });
    expect(bloqueada.status).toBe(409);
    const cuerpoBloqueada = (await bloqueada.json()) as { error: { codigo: string }; codigosCompraAfectados: string[] };
    expect(cuerpoBloqueada.error.codigo).toBe("PANTALLA_VENDIDA");
    expect(cuerpoBloqueada.codigosCompraAfectados.sort()).toEqual([codigoCompraUno, codigoCompraDos].sort());
  });
});
