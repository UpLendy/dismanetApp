import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { prismaRaw } from "../lib/prisma.ts";
import { inicioSemanaBogota } from "../lib/periodos.ts";

// Doble de S3 para toda la prueba (PROMPT-F6.7, Parte 5: "no pegues contra
// un bucket real"). mock.module en Bun es global al proceso (CLAUDE.md), así
// que esta superficie cubre TODO lo que routes/instrucciones.ts importa de
// lib/s3.ts — ver el comentario en ese archivo: ningún otro archivo de
// prueba debe mockear "../lib/s3.ts" con una superficie distinta. Debe
// registrarse ANTES de importar el router, porque mock.module solo afecta
// imports que ocurran después.
const CONTENT_TYPES_PERMITIDOS = ["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"];
const EXTENSION_POR_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};
// Límite bajo a propósito: fácil de superar en la prueba sin subir nada real.
const TAMANO_MAXIMO_BYTES_PRUEBA = 10 * 1024 * 1024;

// clave -> tamaño simulado del objeto en el bucket falso. Ausente = el
// objeto no existe (tamanoDeObjeto real devuelve null en ese caso).
const objetosS3 = new Map<string, number>();
const eliminarObjetoMock = mock(async (clave: string) => {
  objetosS3.delete(clave);
});

mock.module("../lib/s3.ts", () => ({
  CONTENT_TYPES_PERMITIDOS,
  esContentTypePermitido: (valor: string) => CONTENT_TYPES_PERMITIDOS.includes(valor),
  tipoArchivoDeContentType: (contentType: string) => (contentType.startsWith("image/") ? "IMAGEN" : "VIDEO"),
  tamanoMaximoBytes: () => TAMANO_MAXIMO_BYTES_PRUEBA,
  generarClaveArchivo: (empresaId: string, instruccionId: string, contentType: string) =>
    `empresas/${empresaId}/instrucciones/${instruccionId}/${randomUUID()}.${EXTENSION_POR_CONTENT_TYPE[contentType] ?? "bin"}`,
  urlSubidaPrefirmada: async (clave: string) => `https://s3.prueba.local/subida?clave=${encodeURIComponent(clave)}`,
  urlLecturaPrefirmada: async (clave: string) => `https://s3.prueba.local/lectura?clave=${encodeURIComponent(clave)}`,
  tamanoDeObjeto: async (clave: string) => objetosS3.get(clave) ?? null,
  eliminarObjeto: eliminarObjetoMock,
}));

const { instrucciones } = await import("./instrucciones.ts");
const { auth } = await import("./auth.ts");

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

async function peticion(metodo: string, ruta: string, cookie: string, cuerpo?: unknown) {
  const respuesta = await instrucciones.handle(
    new Request(`http://local${ruta}`, {
      method: metodo,
      headers: { "content-type": "application/json", cookie },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    }),
  );
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

/** YYYY-MM-DD de una fecha, en el calendario de Bogotá, para usar como query `semana`. */
function comoFechaBogota(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(fecha);
}

const semanaActualISO = comoFechaBogota(inicioSemanaBogota(new Date()));

interface FixtureEmpresa {
  empresaId: string;
  cookieAdmin: string;
  cookieEmpleado: string;
  empleadoId: string;
  cookieVendedor: string;
  cargoSoporteId: string;
  cargoVentasId: string;
  empleadoSoporteId: string;
  cookieEmpleadoSoporte: string;
}

async function crearFixture(etiqueta: string): Promise<FixtureEmpresa> {
  const prefijo = randomUUID().slice(0, 3).toUpperCase();
  const hash = await argon2.hash(CONTRASENA, { type: argon2.argon2id });

  const empresa = await prismaRaw.empresa.create({
    data: { nombre: `Empresa instrucciones ${etiqueta}`, prefijoCodigo: prefijo },
  });
  const empresaId = empresa.id;

  const cargoSoporte = await prismaRaw.cargo.create({
    data: { empresaId, nombre: `Soporte técnico (${prefijo})` },
  });
  const cargoVentas = await prismaRaw.cargo.create({
    data: { empresaId, nombre: `Ventas (${prefijo})` },
  });

  const adminEmail = `admin-instrucciones-${randomUUID()}@test.local`;
  await prismaRaw.usuario.create({
    data: { empresaId, email: adminEmail, passwordHash: hash, nombre: "Admin", rol: "ADMIN" },
  });
  const cookieAdmin = await iniciarSesion(adminEmail);

  const empleadoEmail = `empleado-instrucciones-${randomUUID()}@test.local`;
  const empleado = await prismaRaw.usuario.create({
    data: { empresaId, email: empleadoEmail, passwordHash: hash, nombre: "Empleado", rol: "EMPLEADO" },
  });
  const cookieEmpleado = await iniciarSesion(empleadoEmail);

  const empleadoSoporteEmail = `empleado-soporte-instrucciones-${randomUUID()}@test.local`;
  const empleadoSoporte = await prismaRaw.usuario.create({
    data: {
      empresaId,
      email: empleadoSoporteEmail,
      passwordHash: hash,
      nombre: "Empleado Soporte",
      rol: "EMPLEADO",
      cargoId: cargoSoporte.id,
    },
  });
  const cookieEmpleadoSoporte = await iniciarSesion(empleadoSoporteEmail);

  const vendedorEmail = `vendedor-instrucciones-${randomUUID()}@test.local`;
  await prismaRaw.usuario.create({
    data: { empresaId, email: vendedorEmail, passwordHash: hash, nombre: "Vendedor", rol: "VENDEDOR" },
  });
  const cookieVendedor = await iniciarSesion(vendedorEmail);

  return {
    empresaId,
    cookieAdmin,
    cookieEmpleado,
    empleadoId: empleado.id,
    cookieVendedor,
    cargoSoporteId: cargoSoporte.id,
    cargoVentasId: cargoVentas.id,
    empleadoSoporteId: empleadoSoporte.id,
    cookieEmpleadoSoporte,
  };
}

async function borrarFixture(empresaId: string) {
  await prismaRaw.instruccionVisualizacion.deleteMany({ where: { empresaId } });
  await prismaRaw.instruccionCumplimiento.deleteMany({ where: { empresaId } });
  await prismaRaw.instruccionArchivo.deleteMany({ where: { empresaId } });
  await prismaRaw.instruccion.deleteMany({ where: { empresaId } });
  await prismaRaw.usuario.deleteMany({ where: { empresaId } });
  await prismaRaw.cargo.deleteMany({ where: { empresaId } });
  await prismaRaw.empresa.delete({ where: { id: empresaId } });
}

/** Sube (simulado) y registra un video ya "subido a S3", listo para reportar progreso (F6.8). */
async function crearVideo(cookieAdmin: string, instruccionId: string, duracionSegundos: number | null) {
  const urlSubida = await peticion("POST", `/instrucciones/${instruccionId}/archivos/url-subida`, cookieAdmin, {
    nombre: "video.mp4",
    contentType: "video/mp4",
    bytes: 1024,
  });
  objetosS3.set(urlSubida.cuerpo.clave, 1024);
  const registro = await peticion("POST", `/instrucciones/${instruccionId}/archivos`, cookieAdmin, {
    clave: urlSubida.cuerpo.clave,
    nombre: "video.mp4",
    contentType: "video/mp4",
    ...(duracionSegundos !== null ? { duracionSegundos } : {}),
  });
  return registro.cuerpo.archivo.id as string;
}

/** Retrocede `ultimoReporte`/`primerReporte` para simular tiempo de reloj real transcurrido, sin esperas reales en la prueba. */
async function retrocederReloj(archivoId: string, usuarioId: string, segundos: number) {
  const fila = await prismaRaw.instruccionVisualizacion.findFirst({ where: { archivoId, usuarioId } });
  if (!fila) throw new Error("No hay fila de visualización para retroceder.");
  await prismaRaw.instruccionVisualizacion.update({
    where: { id: fila.id },
    data: {
      ultimoReporte: new Date(fila.ultimoReporte.getTime() - segundos * 1000),
      primerReporte: new Date(fila.primerReporte.getTime() - segundos * 1000),
    },
  });
}

describe("Instrucciones semanales con imágenes y video (F6.7)", () => {
  let fx: FixtureEmpresa;
  let fxB: FixtureEmpresa;

  beforeAll(async () => {
    fx = await crearFixture("A");
    fxB = await crearFixture("B");
  });

  afterAll(async () => {
    await borrarFixture(fx.empresaId);
    await borrarFixture(fxB.empresaId);
  });

  describe("Generación de URL de subida: clave, tipo y tamaño", () => {
    it("la clave generada incluye el empresaId y el instruccionId, y un contentType fuera de la lista blanca se rechaza", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción con archivos",
        semana: semanaActualISO,
      });
      expect(creada.status).toBe(201);
      const instruccionId = creada.cuerpo.instruccion.id;

      const url = await peticion("POST", `/instrucciones/${instruccionId}/archivos/url-subida`, fx.cookieAdmin, {
        nombre: "foto.png",
        contentType: "image/png",
        bytes: 1024,
      });
      expect(url.status).toBe(200);
      expect(url.cuerpo.clave).toStartWith(`empresas/${fx.empresaId}/instrucciones/${instruccionId}/`);

      const rechazada = await peticion("POST", `/instrucciones/${instruccionId}/archivos/url-subida`, fx.cookieAdmin, {
        nombre: "documento.pdf",
        contentType: "application/pdf",
        bytes: 1024,
      });
      expect(rechazada.status).toBe(400);
      expect(rechazada.cuerpo.error.codigo).toBe("TIPO_NO_PERMITIDO");

      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("un bytes por encima del máximo se rechaza al pedir la URL", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción con video pesado",
        semana: semanaActualISO,
      });
      const instruccionId = creada.cuerpo.instruccion.id;

      const rechazada = await peticion("POST", `/instrucciones/${instruccionId}/archivos/url-subida`, fx.cookieAdmin, {
        nombre: "video.mp4",
        contentType: "video/mp4",
        bytes: TAMANO_MAXIMO_BYTES_PRUEBA + 1,
      });
      expect(rechazada.status).toBe(400);
      expect(rechazada.cuerpo.error.codigo).toBe("ARCHIVO_DEMASIADO_GRANDE");

      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });
  });

  describe("Registrar un archivo verifica contra S3 que el objeto existe", () => {
    it("registrar un archivo cuyo objeto no existe en S3 falla y no crea la fila", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción sin subida real",
        semana: semanaActualISO,
      });
      const instruccionId = creada.cuerpo.instruccion.id;

      const urlSubida = await peticion("POST", `/instrucciones/${instruccionId}/archivos/url-subida`, fx.cookieAdmin, {
        nombre: "foto.png",
        contentType: "image/png",
        bytes: 1024,
      });
      const clave = urlSubida.cuerpo.clave;
      // A propósito: nunca se registra `clave` en objetosS3, simulando que
      // la subida al bucket falló o nunca terminó.

      const registro = await peticion("POST", `/instrucciones/${instruccionId}/archivos`, fx.cookieAdmin, {
        clave,
        nombre: "foto.png",
        contentType: "image/png",
      });
      expect(registro.status).toBe(400);
      expect(registro.cuerpo.error.codigo).toBe("ARCHIVO_NO_ENCONTRADO_EN_S3");

      const filas = await prismaRaw.instruccionArchivo.findMany({ where: { instruccionId } });
      expect(filas.length).toBe(0);

      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("registrar un archivo cuyo objeto sí existe en S3 crea la fila con el tamaño reportado por S3, no el del cliente", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción con subida real",
        semana: semanaActualISO,
      });
      const instruccionId = creada.cuerpo.instruccion.id;

      const urlSubida = await peticion("POST", `/instrucciones/${instruccionId}/archivos/url-subida`, fx.cookieAdmin, {
        nombre: "foto.png",
        contentType: "image/png",
        bytes: 1024,
      });
      const clave = urlSubida.cuerpo.clave;
      objetosS3.set(clave, 2048); // el navegador "subió" 2048 bytes reales.

      const registro = await peticion("POST", `/instrucciones/${instruccionId}/archivos`, fx.cookieAdmin, {
        clave,
        nombre: "foto.png",
        contentType: "image/png",
      });
      expect(registro.status).toBe(201);
      expect(registro.cuerpo.archivo.bytes).toBe(2048);

      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });
  });

  describe("Visibilidad para el empleado: publicación y cargo", () => {
    it("una instrucción no publicada no sale en la consulta del empleado, ni pidiendo su id directo, y tampoco entrega URL de lectura", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción sin publicar",
        semana: semanaActualISO,
      });
      const instruccionId = creada.cuerpo.instruccion.id;

      const urlSubida = await peticion("POST", `/instrucciones/${instruccionId}/archivos/url-subida`, fx.cookieAdmin, {
        nombre: "foto.png",
        contentType: "image/png",
        bytes: 1024,
      });
      objetosS3.set(urlSubida.cuerpo.clave, 1024);
      const archivo = await peticion("POST", `/instrucciones/${instruccionId}/archivos`, fx.cookieAdmin, {
        clave: urlSubida.cuerpo.clave,
        nombre: "foto.png",
        contentType: "image/png",
      });
      const archivoId = archivo.cuerpo.archivo.id;

      const lista = await peticion("GET", `/instrucciones?semana=${semanaActualISO}`, fx.cookieEmpleado);
      expect(lista.cuerpo.instrucciones.some((i: { id: string }) => i.id === instruccionId)).toBe(false);

      const completar = await peticion("POST", `/instrucciones/${instruccionId}/completar`, fx.cookieEmpleado);
      expect(completar.status).toBe(404);
      expect(completar.cuerpo.error.codigo).toBe("INSTRUCCION_NO_ENCONTRADA");

      const url = await peticion("GET", `/instrucciones/${instruccionId}/archivos/${archivoId}/url`, fx.cookieEmpleado);
      expect(url.status).toBe(404);
      expect(url.cuerpo.error.codigo).toBe("INSTRUCCION_NO_ENCONTRADA");

      // El ADMIN sí puede verla y previsualizarla, sin publicar.
      const urlAdmin = await peticion("GET", `/instrucciones/${instruccionId}/archivos/${archivoId}/url`, fx.cookieAdmin);
      expect(urlAdmin.status).toBe(200);

      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("una instrucción con cargoId de Soporte técnico no le sale a un empleado de otro cargo; una con cargoId nulo le sale a todos", async () => {
      const paraSoporte = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción para Soporte técnico",
        semana: semanaActualISO,
        cargoId: fx.cargoSoporteId,
      });
      const idSoporte = paraSoporte.cuerpo.instruccion.id;
      await peticion("PATCH", `/instrucciones/${idSoporte}/publicar`, fx.cookieAdmin);

      const paraTodos = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción para todos",
        semana: semanaActualISO,
      });
      const idTodos = paraTodos.cuerpo.instruccion.id;
      await peticion("PATCH", `/instrucciones/${idTodos}/publicar`, fx.cookieAdmin);

      // fx.cookieEmpleado no tiene cargo asignado: no coincide con Soporte técnico.
      const listaEmpleadoSinCargo = await peticion("GET", `/instrucciones?semana=${semanaActualISO}`, fx.cookieEmpleado);
      const idsEmpleadoSinCargo = listaEmpleadoSinCargo.cuerpo.instrucciones.map((i: { id: string }) => i.id);
      expect(idsEmpleadoSinCargo).not.toContain(idSoporte);
      expect(idsEmpleadoSinCargo).toContain(idTodos);

      // fx.cookieEmpleadoSoporte sí tiene el cargo de Soporte técnico.
      const listaEmpleadoSoporte = await peticion("GET", `/instrucciones?semana=${semanaActualISO}`, fx.cookieEmpleadoSoporte);
      const idsEmpleadoSoporte = listaEmpleadoSoporte.cuerpo.instrucciones.map((i: { id: string }) => i.id);
      expect(idsEmpleadoSoporte).toContain(idSoporte);
      expect(idsEmpleadoSoporte).toContain(idTodos);

      await peticion("PATCH", `/instrucciones/${idSoporte}/despublicar`, fx.cookieAdmin);
      await peticion("PATCH", `/instrucciones/${idTodos}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${idSoporte}`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${idTodos}`, fx.cookieAdmin);
    });
  });

  describe("Borrado y cumplimiento", () => {
    it("DELETE de una instrucción publicada responde 409; tras despublicarla, se borra", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción publicada",
        semana: semanaActualISO,
      });
      const instruccionId = creada.cuerpo.instruccion.id;
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      const borrar = await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
      expect(borrar.status).toBe(409);
      expect(borrar.cuerpo.error.codigo).toBe("INSTRUCCION_PUBLICADA");

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      const borrarOk = await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
      expect(borrarOk.status).toBe(200);
    });

    it("POST /completar dos veces no duplica la fila de cumplimiento", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción para completar",
        semana: semanaActualISO,
      });
      const instruccionId = creada.cuerpo.instruccion.id;
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      const primero = await peticion("POST", `/instrucciones/${instruccionId}/completar`, fx.cookieEmpleado);
      expect(primero.status).toBe(200);
      const segundo = await peticion("POST", `/instrucciones/${instruccionId}/completar`, fx.cookieEmpleado);
      expect(segundo.status).toBe(200);

      const filas = await prismaRaw.instruccionCumplimiento.findMany({ where: { instruccionId } });
      expect(filas.length).toBe(1);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });
  });

  describe("Permisos por rol", () => {
    it("un VENDEDOR recibe 403 en todas las rutas", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción para permisos",
        semana: semanaActualISO,
      });
      const instruccionId = creada.cuerpo.instruccion.id;
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      expect((await peticion("GET", `/instrucciones?semana=${semanaActualISO}`, fx.cookieVendedor)).status).toBe(403);
      expect((await peticion("POST", `/instrucciones/${instruccionId}/completar`, fx.cookieVendedor)).status).toBe(403);
      expect((await peticion("GET", `/instrucciones/${instruccionId}/archivos/alguno/url`, fx.cookieVendedor)).status).toBe(403);
      expect((await peticion("POST", "/instrucciones", fx.cookieVendedor, { titulo: "x", semana: semanaActualISO })).status).toBe(403);
      expect((await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieVendedor)).status).toBe(403);
      expect((await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieVendedor)).status).toBe(403);
      expect((await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieVendedor)).status).toBe(403);
      expect(
        (
          await peticion("POST", `/instrucciones/${instruccionId}/archivos/url-subida`, fx.cookieVendedor, {
            nombre: "a.png",
            contentType: "image/png",
            bytes: 100,
          })
        ).status,
      ).toBe(403);
      expect((await peticion("GET", `/instrucciones/${instruccionId}/cumplimiento`, fx.cookieVendedor)).status).toBe(403);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("un EMPLEADO recibe 403 en crear, publicar, subir y ver cumplimiento", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción para empleado",
        semana: semanaActualISO,
      });
      const instruccionId = creada.cuerpo.instruccion.id;
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      expect((await peticion("POST", "/instrucciones", fx.cookieEmpleado, { titulo: "x", semana: semanaActualISO })).status).toBe(403);
      expect((await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieEmpleado)).status).toBe(403);
      expect(
        (
          await peticion("POST", `/instrucciones/${instruccionId}/archivos/url-subida`, fx.cookieEmpleado, {
            nombre: "a.png",
            contentType: "image/png",
            bytes: 100,
          })
        ).status,
      ).toBe(403);
      expect((await peticion("GET", `/instrucciones/${instruccionId}/cumplimiento`, fx.cookieEmpleado)).status).toBe(403);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });
  });

  describe("R1 — aislamiento entre empresas", () => {
    it("un empleado de la empresa B no obtiene URL de lectura de un archivo de la empresa A", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Instrucción de la empresa A",
        semana: semanaActualISO,
      });
      const instruccionId = creada.cuerpo.instruccion.id;

      const urlSubida = await peticion("POST", `/instrucciones/${instruccionId}/archivos/url-subida`, fx.cookieAdmin, {
        nombre: "foto.png",
        contentType: "image/png",
        bytes: 1024,
      });
      objetosS3.set(urlSubida.cuerpo.clave, 1024);
      const archivo = await peticion("POST", `/instrucciones/${instruccionId}/archivos`, fx.cookieAdmin, {
        clave: urlSubida.cuerpo.clave,
        nombre: "foto.png",
        contentType: "image/png",
      });
      const archivoId = archivo.cuerpo.archivo.id;
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      // El ADMIN de la empresa B tampoco ve la instrucción de A: la
      // extensión de Prisma (R1) filtra instruccion.findFirst por su propia
      // empresaId, así que el 404 llega antes de llegar al archivo.
      const comoAdminB = await peticion(
        "GET",
        `/instrucciones/${instruccionId}/archivos/${archivoId}/url`,
        fxB.cookieAdmin,
      );
      expect(comoAdminB.status).toBe(404);

      const comoEmpleadoB = await peticion(
        "GET",
        `/instrucciones/${instruccionId}/archivos/${archivoId}/url`,
        fxB.cookieEmpleado,
      );
      expect(comoEmpleadoB.status).toBe(404);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });
  });

  describe("Video y registro de visualización (F6.8)", () => {
    it("un empleado no puede reportar progreso de una instrucción no publicada ni de una que no le aplica", async () => {
      const noPublicada = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Sin publicar",
        semana: semanaActualISO,
      });
      const videoNoPublicado = await crearVideo(fx.cookieAdmin, noPublicada.cuerpo.instruccion.id, 100);
      const reporteNoPublicada = await peticion(
        "POST",
        `/instrucciones/${noPublicada.cuerpo.instruccion.id}/archivos/${videoNoPublicado}/progreso`,
        fx.cookieEmpleado,
        { desde: 0, hasta: 10 },
      );
      expect(reporteNoPublicada.status).toBe(404);
      expect(reporteNoPublicada.cuerpo.error.codigo).toBe("INSTRUCCION_NO_ENCONTRADA");

      const paraSoporte = await peticion("POST", "/instrucciones", fx.cookieAdmin, {
        titulo: "Solo soporte",
        semana: semanaActualISO,
        cargoId: fx.cargoSoporteId,
      });
      const videoSoporte = await crearVideo(fx.cookieAdmin, paraSoporte.cuerpo.instruccion.id, 100);
      await peticion("PATCH", `/instrucciones/${paraSoporte.cuerpo.instruccion.id}/publicar`, fx.cookieAdmin);
      // fx.cookieEmpleado no tiene el cargo de Soporte técnico.
      const reporteNoAplica = await peticion(
        "POST",
        `/instrucciones/${paraSoporte.cuerpo.instruccion.id}/archivos/${videoSoporte}/progreso`,
        fx.cookieEmpleado,
        { desde: 0, hasta: 10 },
      );
      expect(reporteNoAplica.status).toBe(404);

      await peticion("PATCH", `/instrucciones/${paraSoporte.cuerpo.instruccion.id}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${noPublicada.cuerpo.instruccion.id}`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${paraSoporte.cuerpo.instruccion.id}`, fx.cookieAdmin);
    });

    it("cada empleado reporta su propio progreso de forma aislada: el de uno no pisa el del otro", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, { titulo: "Video compartido", semana: semanaActualISO });
      const instruccionId = creada.cuerpo.instruccion.id;
      const videoId = await crearVideo(fx.cookieAdmin, instruccionId, 100);
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, { desde: 0, hasta: 5 });
      await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleadoSoporte, {
        desde: 0,
        hasta: 80,
      });

      const progresoEmpleado = await peticion("GET", `/instrucciones/${instruccionId}/progreso`, fx.cookieEmpleado);
      const progresoSoporte = await peticion("GET", `/instrucciones/${instruccionId}/progreso`, fx.cookieEmpleadoSoporte);
      expect(progresoEmpleado.cuerpo.progreso[0].segundosVistos).toBe(5);
      expect(progresoSoporte.cuerpo.progreso[0].segundosVistos).toBe(80);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("un solo reporte del tramo final (arrastrar la barra) no completa: cobertura mínima", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, { titulo: "Arrastrar al final", semana: semanaActualISO });
      const instruccionId = creada.cuerpo.instruccion.id;
      const videoId = await crearVideo(fx.cookieAdmin, instruccionId, 600);
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      const reporte = await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, {
        desde: 599,
        hasta: 600,
      });
      expect(reporte.status).toBe(200);
      expect(reporte.cuerpo.completado).toBe(false);
      expect(reporte.cuerpo.cobertura).toBeLessThan(0.95);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("un reporte que pide 600 segundos nuevos con solo 5 de reloj transcurrido se recorta: la cobertura lo refleja", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, { titulo: "Reporte imposible", semana: semanaActualISO });
      const instruccionId = creada.cuerpo.instruccion.id;
      const videoId = await crearVideo(fx.cookieAdmin, instruccionId, 600);
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, { desde: 0, hasta: 1 });
      await retrocederReloj(videoId, fx.empleadoId, 5);
      const reporte = await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, {
        desde: 1,
        hasta: 601,
      });
      expect(reporte.status).toBe(200);
      // presupuesto ≈ 5s × 2 = 10s nuevos; acreditado total ≈ 1 + 10 = 11 de
      // 600 (no exacto: entre el retroceso simulado y la petición pasan
      // milisegundos reales de ejecución de la prueba).
      expect(reporte.cuerpo.segundosVistos).toBeGreaterThanOrEqual(11);
      expect(reporte.cuerpo.segundosVistos).toBeLessThan(15);
      expect(reporte.cuerpo.completado).toBe(false);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("reproducción normal, con tiempo real suficiente desde el primer reporte, completa", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, { titulo: "Reproducción normal", semana: semanaActualISO });
      const instruccionId = creada.cuerpo.instruccion.id;
      const videoId = await crearVideo(fx.cookieAdmin, instruccionId, 60);
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, { desde: 0, hasta: 30 });
      // Retrocede el reloj guardado 55s: simula que, en la realidad, ya
      // pasaron 55s desde el primer reporte cuando llega el segundo.
      await retrocederReloj(videoId, fx.empleadoId, 55);
      const reporte = await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, {
        desde: 30,
        hasta: 60,
      });
      expect(reporte.status).toBe(200);
      expect(reporte.cuerpo.cobertura).toBeGreaterThanOrEqual(0.95);
      expect(reporte.cuerpo.completado).toBe(true);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("visualización en dos sesiones (hoy la mitad, mañana el resto) completa", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, { titulo: "Dos sesiones", semana: semanaActualISO });
      const instruccionId = creada.cuerpo.instruccion.id;
      const videoId = await crearVideo(fx.cookieAdmin, instruccionId, 100);
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, { desde: 0, hasta: 50 });
      await retrocederReloj(videoId, fx.empleadoId, 24 * 60 * 60); // "al día siguiente"
      const reporte = await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, {
        desde: 50,
        hasta: 100,
      });
      expect(reporte.cuerpo.completado).toBe(true);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("tramos solapados se fusionan y no inflan segundosVistos; más de 50 tramos sueltos se rechaza", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, { titulo: "Tramos", semana: semanaActualISO });
      const instruccionId = creada.cuerpo.instruccion.id;
      const videoId = await crearVideo(fx.cookieAdmin, instruccionId, 10_000);
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, { desde: 0, hasta: 100 });
      // Se solapa con lo anterior: no debe sumar otros 50, solo ampliar hasta 150.
      await retrocederReloj(videoId, fx.empleadoId, 60);
      const solapado = await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, {
        desde: 50,
        hasta: 150,
      });
      expect(solapado.cuerpo.segundosVistos).toBe(150);

      // Ahora manda tramos sueltos, muy separados para que no se fusionen
      // entre sí, hasta exceder el máximo de 50.
      let ultimoStatus = 200;
      for (let i = 0; i < 55; i++) {
        await retrocederReloj(videoId, fx.empleadoId, 10);
        const resultado = await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, {
          desde: 1000 + i * 20,
          hasta: 1000 + i * 20 + 1,
        });
        ultimoStatus = resultado.status;
        if (resultado.status !== 200) break;
      }
      expect(ultimoStatus).toBe(400);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("un video sin duracionSegundos nunca completa por sí solo y se reporta como pendiente", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, { titulo: "Sin duración", semana: semanaActualISO });
      const instruccionId = creada.cuerpo.instruccion.id;
      const videoId = await crearVideo(fx.cookieAdmin, instruccionId, null);
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, { desde: 0, hasta: 100 });
      await retrocederReloj(videoId, fx.empleadoId, 24 * 60 * 60);
      const reporte = await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, {
        desde: 0,
        hasta: 100,
      });
      expect(reporte.cuerpo.completado).toBe(false);

      const cumplimiento = await peticion("GET", `/instrucciones/${instruccionId}/cumplimiento`, fx.cookieAdmin);
      const filaEmpleado = cumplimiento.cuerpo.cumplimiento.find((f: { id: string }) => f.id === fx.empleadoId);
      expect(filaEmpleado.videos[0].completado).toBe(false);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("POST /completar en una instrucción con video responde 409; una instrucción con dos videos completa sola cuando ambos terminan", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, { titulo: "Dos videos", semana: semanaActualISO });
      const instruccionId = creada.cuerpo.instruccion.id;
      const video1 = await crearVideo(fx.cookieAdmin, instruccionId, 10);
      const video2 = await crearVideo(fx.cookieAdmin, instruccionId, 10);
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      const completarTemprano = await peticion("POST", `/instrucciones/${instruccionId}/completar`, fx.cookieEmpleado);
      expect(completarTemprano.status).toBe(409);
      expect(completarTemprano.cuerpo.error.codigo).toBe("INSTRUCCION_CON_VIDEO");

      // Completa el primer video (dos reportes separados por tiempo real suficiente).
      await peticion("POST", `/instrucciones/${instruccionId}/archivos/${video1}/progreso`, fx.cookieEmpleado, { desde: 0, hasta: 5 });
      await retrocederReloj(video1, fx.empleadoId, 9);
      const reporteVideo1 = await peticion("POST", `/instrucciones/${instruccionId}/archivos/${video1}/progreso`, fx.cookieEmpleado, {
        desde: 5,
        hasta: 10,
      });
      expect(reporteVideo1.cuerpo.completado).toBe(true);

      // Con un solo video completo, la instrucción todavía no está cumplida.
      const cumplimientoAMedias = await peticion("GET", `/instrucciones/${instruccionId}/cumplimiento`, fx.cookieAdmin);
      const filaAMedias = cumplimientoAMedias.cuerpo.cumplimiento.find((f: { id: string }) => f.id === fx.empleadoId);
      expect(filaAMedias.cumplio).toBe(false);

      // Completa el segundo video: ahora sí se autocompleta la instrucción.
      await peticion("POST", `/instrucciones/${instruccionId}/archivos/${video2}/progreso`, fx.cookieEmpleado, { desde: 0, hasta: 5 });
      await retrocederReloj(video2, fx.empleadoId, 9);
      const reporteVideo2 = await peticion("POST", `/instrucciones/${instruccionId}/archivos/${video2}/progreso`, fx.cookieEmpleado, {
        desde: 5,
        hasta: 10,
      });
      expect(reporteVideo2.cuerpo.completado).toBe(true);

      const cumplimientoFinal = await peticion("GET", `/instrucciones/${instruccionId}/cumplimiento`, fx.cookieAdmin);
      const filaFinal = cumplimientoFinal.cuerpo.cumplimiento.find((f: { id: string }) => f.id === fx.empleadoId);
      expect(filaFinal.cumplio).toBe(true);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });

    it("R1 — un video, su progreso y su cumplimiento no cruzan empresas", async () => {
      const creada = await peticion("POST", "/instrucciones", fx.cookieAdmin, { titulo: "R1 video", semana: semanaActualISO });
      const instruccionId = creada.cuerpo.instruccion.id;
      const videoId = await crearVideo(fx.cookieAdmin, instruccionId, 10);
      await peticion("PATCH", `/instrucciones/${instruccionId}/publicar`, fx.cookieAdmin);

      await peticion("POST", `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`, fx.cookieEmpleado, { desde: 0, hasta: 10 });

      // La empresa B ni siquiera ve que la instrucción exista.
      const reporteDesdeB = await peticion(
        "POST",
        `/instrucciones/${instruccionId}/archivos/${videoId}/progreso`,
        fxB.cookieEmpleado,
        { desde: 0, hasta: 10 },
      );
      expect(reporteDesdeB.status).toBe(404);

      const progresoDesdeB = await peticion("GET", `/instrucciones/${instruccionId}/progreso`, fxB.cookieEmpleado);
      expect(progresoDesdeB.status).toBe(404);

      const cumplimientoDesdeB = await peticion("GET", `/instrucciones/${instruccionId}/cumplimiento`, fxB.cookieAdmin);
      expect(cumplimientoDesdeB.status).toBe(404);

      await peticion("PATCH", `/instrucciones/${instruccionId}/despublicar`, fx.cookieAdmin);
      await peticion("DELETE", `/instrucciones/${instruccionId}`, fx.cookieAdmin);
    });
  });
});
