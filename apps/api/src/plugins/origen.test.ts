import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { validarOrigen } from "./origen.ts";

// Monta un endpoint de cada tipo de método: GET nunca se bloquea (no cambia
// estado), POST sí — exactamente lo que valida esta prueba.
const app = new Elysia()
  .use(validarOrigen)
  .get("/ruta", () => ({ ok: true }))
  .post("/ruta", () => ({ ok: true }));

function peticion(metodo: string, origen?: string) {
  return app.handle(
    new Request("http://local/ruta", {
      method: metodo,
      headers: origen ? { origin: origen } : {},
    }),
  );
}

describe("validarOrigen — defensa en profundidad contra CSRF", () => {
  const ORIGINAL_WEB_URL = process.env.WEB_URL;
  const ORIGINAL_ORIGENES_PERMITIDOS = process.env.ORIGENES_PERMITIDOS;

  beforeEach(() => {
    process.env.WEB_URL = "https://app.dismanet.com";
    delete process.env.ORIGENES_PERMITIDOS;
  });

  afterEach(() => {
    if (ORIGINAL_WEB_URL === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = ORIGINAL_WEB_URL;
    if (ORIGINAL_ORIGENES_PERMITIDOS === undefined) delete process.env.ORIGENES_PERMITIDOS;
    else process.env.ORIGENES_PERMITIDOS = ORIGINAL_ORIGENES_PERMITIDOS;
  });

  it("un POST con Origin ajeno recibe 403", async () => {
    const respuesta = await peticion("POST", "https://sitio-ajeno.com");
    expect(respuesta.status).toBe(403);
    const cuerpo = (await respuesta.json()) as { error: { codigo: string } };
    expect(cuerpo.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
  });

  it("un POST con el Origin permitido (WEB_URL) pasa", async () => {
    const respuesta = await peticion("POST", "https://app.dismanet.com");
    expect(respuesta.status).toBe(200);
  });

  it("un POST sin encabezado Origin pasa (petición servidor-a-servidor, no la gobierna el navegador)", async () => {
    const respuesta = await peticion("POST");
    expect(respuesta.status).toBe(200);
  });

  it("un GET con Origin ajeno pasa (no cambia estado)", async () => {
    const respuesta = await peticion("GET", "https://sitio-ajeno.com");
    expect(respuesta.status).toBe(200);
  });

  it("ORIGENES_PERMITIDOS admite varios orígenes separados por coma y gana sobre WEB_URL", async () => {
    process.env.ORIGENES_PERMITIDOS = "https://app.dismanet.com,https://preview.dismanet.com";
    const respuestaPreview = await peticion("POST", "https://preview.dismanet.com");
    expect(respuestaPreview.status).toBe(200);
    const respuestaAjena = await peticion("POST", "https://otra-cosa.com");
    expect(respuestaAjena.status).toBe(403);
  });
});
