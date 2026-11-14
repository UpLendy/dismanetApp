import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// Hueco entre F6.7 y F6.8: el frontend nunca calculaba duracionSegundos al
// subir un video, así que ningún video registraba cumplimiento automático.
// Estas pruebas cubren: que una imagen no intenta leer duración, que un
// video con duración ilegible no rompe la subida (se manda sin el campo,
// nunca null — el esquema del API no acepta null), y que el campo manual
// del ADMIN corrige un archivo ya registrado sin duración.

const INSTRUCCION_SIN_VIDEO = {
  id: "instr-1",
  titulo: "Instrucción de prueba",
  descripcion: null,
  semanaInicio: "2026-11-09",
  cargoId: null,
  publicada: false,
  archivos: [] as Array<Record<string, unknown>>,
};

const VIDEO_SIN_DURACION = {
  id: "archivo-1",
  tipo: "VIDEO",
  nombre: "capacitacion.mp4",
  contentType: "video/mp4",
  bytes: 12345,
  duracionSegundos: null,
  orden: 0,
  createdAt: "2026-11-10T00:00:00.000Z",
};

const mockInstruccionesGet = mock(() => Promise.resolve<any>({ data: { instrucciones: [] }, error: null }));
const mockCargosGet = mock(() => Promise.resolve<any>({ data: { cargos: [] }, error: null }));
const mockUrlSubidaPost = mock(() =>
  Promise.resolve<any>({ data: { clave: "clave-1", url: "https://s3.test/subir" }, error: null }),
);
const mockArchivosPost = mock((_body: { duracionSegundos?: number }) =>
  Promise.resolve<any>({
    data: { archivo: { ...VIDEO_SIN_DURACION, id: "archivo-nuevo" } },
    error: null,
  }),
);
const mockArchivoUrlGet = mock(() => Promise.resolve<any>({ data: { url: "https://s3.test/ver" }, error: null }));
const mockArchivoPatch = mock(() => Promise.resolve<any>({ data: { archivo: {}, visualizacionesCompletadas: 0 }, error: null }));
const mockArchivoDelete = mock(() => Promise.resolve<any>({ data: {}, error: null }));
const mockLeerDuracionVideo = mock(() => Promise.resolve<number | null>(120));

mock.module("@/lib/api", () => ({
  api: {
    instrucciones: Object.assign(
      (_params: { id: string }) => ({
        archivos: Object.assign(
          (_archivoParams: { archivoId: string }) => ({
            url: { get: mockArchivoUrlGet },
            patch: mockArchivoPatch,
            delete: mockArchivoDelete,
          }),
          {
            "url-subida": { post: mockUrlSubidaPost },
            post: mockArchivosPost,
          },
        ),
        patch: mock(() => Promise.resolve<any>({ data: { instruccion: INSTRUCCION_SIN_VIDEO }, error: null })),
        publicar: { patch: mock(() => Promise.resolve<any>({ data: { instruccion: INSTRUCCION_SIN_VIDEO }, error: null })) },
        despublicar: { patch: mock(() => Promise.resolve<any>({ data: { instruccion: INSTRUCCION_SIN_VIDEO }, error: null })) },
      }),
      {
        get: mockInstruccionesGet,
        post: mock(() => Promise.resolve<any>({ data: { instruccion: INSTRUCCION_SIN_VIDEO }, error: null })),
      },
    ),
    cargos: { get: mockCargosGet },
  },
}));

mock.module("@/lib/duracion-video", () => ({
  leerDuracionVideo: mockLeerDuracionVideo,
}));

const { InstruccionesContenido } = await import("./instrucciones-contenido.tsx");

// jsdom/happy-dom no implementan XMLHttpRequest con un backend real: la
// subida a S3 (subirArchivoAS3) usa XHR directo porque fetch no expone
// progreso de subida. Se sustituye por una versión que completa sola.
let xhrOriginal: typeof XMLHttpRequest;
class XHRFalso {
  upload: { onprogress: ((evento: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  open(_metodo: string, _url: string) {}
  setRequestHeader(_nombre: string, _valor: string) {}
  send(_cuerpo: unknown) {
    queueMicrotask(() => this.onload?.());
  }
}

beforeEach(() => {
  mockInstruccionesGet.mockReset().mockResolvedValue({ data: { instrucciones: [] }, error: null });
  mockCargosGet.mockReset().mockResolvedValue({ data: { cargos: [] }, error: null });
  mockUrlSubidaPost.mockReset().mockResolvedValue({ data: { clave: "clave-1", url: "https://s3.test/subir" }, error: null });
  mockArchivosPost
    .mockReset()
    .mockResolvedValue({ data: { archivo: { ...VIDEO_SIN_DURACION, id: "archivo-nuevo" } }, error: null });
  mockArchivoUrlGet.mockReset().mockResolvedValue({ data: { url: "https://s3.test/ver" }, error: null });
  mockArchivoPatch.mockReset().mockResolvedValue({ data: { archivo: {}, visualizacionesCompletadas: 0 }, error: null });
  mockArchivoDelete.mockReset().mockResolvedValue({ data: {}, error: null });
  mockLeerDuracionVideo.mockReset().mockResolvedValue(120);

  xhrOriginal = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = XHRFalso as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  globalThis.XMLHttpRequest = xhrOriginal;
  cleanup();
});

describe("Subida de archivos — duracionSegundos (hueco F6.7/F6.8)", () => {
  test("una imagen no intenta leer duración, y se registra sin el campo", async () => {
    mockInstruccionesGet.mockResolvedValue({ data: { instrucciones: [INSTRUCCION_SIN_VIDEO] }, error: null });

    render(<InstruccionesContenido rol="ADMIN" />);

    const input = await screen.findByLabelText("Subir imagen o video");
    const archivo = new File(["x"], "foto.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [archivo] } });

    await waitFor(() => expect(mockArchivosPost).toHaveBeenCalledTimes(1));

    expect(mockLeerDuracionVideo).not.toHaveBeenCalled();
    const cuerpoEnviado = mockArchivosPost.mock.calls[0][0];
    expect(cuerpoEnviado.duracionSegundos).toBeUndefined();
  });

  test("un video con duración ilegible (null) no rompe la subida, y se manda sin el campo", async () => {
    mockInstruccionesGet.mockResolvedValue({ data: { instrucciones: [INSTRUCCION_SIN_VIDEO] }, error: null });
    mockLeerDuracionVideo.mockResolvedValue(null);

    render(<InstruccionesContenido rol="ADMIN" />);

    const input = await screen.findByLabelText("Subir imagen o video");
    const video = new File(["x"], "capacitacion.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [video] } });

    await waitFor(() => expect(mockArchivosPost).toHaveBeenCalledTimes(1));

    expect(mockLeerDuracionVideo).toHaveBeenCalledTimes(1);
    const cuerpoEnviado = mockArchivosPost.mock.calls[0][0];
    expect(cuerpoEnviado.duracionSegundos).toBeUndefined();
    expect(screen.queryByText(/se interrumpió/)).toBeNull();
  });

  test("un video con duración legible la manda tal cual la reportó la lectura", async () => {
    mockInstruccionesGet.mockResolvedValue({ data: { instrucciones: [INSTRUCCION_SIN_VIDEO] }, error: null });
    mockLeerDuracionVideo.mockResolvedValue(185);

    render(<InstruccionesContenido rol="ADMIN" />);

    const input = await screen.findByLabelText("Subir imagen o video");
    const video = new File(["x"], "capacitacion.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [video] } });

    await waitFor(() => expect(mockArchivosPost).toHaveBeenCalledTimes(1));

    const cuerpoEnviado = mockArchivosPost.mock.calls[0][0];
    expect(cuerpoEnviado.duracionSegundos).toBe(185);
  });
});

describe("Corrección manual de duración — visible solo cuando falta (hueco F6.7/F6.8)", () => {
  test("el campo manual actualiza duracionSegundos de un archivo ya registrado", async () => {
    mockInstruccionesGet.mockResolvedValue({
      data: { instrucciones: [{ ...INSTRUCCION_SIN_VIDEO, archivos: [VIDEO_SIN_DURACION] }] },
      error: null,
    });
    mockArchivoPatch.mockResolvedValue({
      data: { archivo: { ...VIDEO_SIN_DURACION, duracionSegundos: 185 }, visualizacionesCompletadas: 0 },
      error: null,
    });

    render(<InstruccionesContenido rol="ADMIN" />);

    const campoDuracion = await screen.findByLabelText("Duración en segundos");
    fireEvent.change(campoDuracion, { target: { value: "185" } });
    fireEvent.click(screen.getByRole("button", { name: "Fijar duración" }));

    await waitFor(() => expect(mockArchivoPatch).toHaveBeenCalledTimes(1));
    expect(mockArchivoPatch).toHaveBeenCalledWith({ duracionSegundos: 185 });

    // Corregida la duración, el campo manual deja de ser visible: la
    // condición que lo muestra (duracionSegundos == null) ya no se cumple.
    await waitFor(() => expect(screen.queryByLabelText("Duración en segundos")).toBeNull());
  });

  test("si el video ya tenía visualizaciones completadas, avisa cuántas al corregir la duración", async () => {
    mockInstruccionesGet.mockResolvedValue({
      data: { instrucciones: [{ ...INSTRUCCION_SIN_VIDEO, archivos: [VIDEO_SIN_DURACION] }] },
      error: null,
    });
    mockArchivoPatch.mockResolvedValue({
      data: { archivo: { ...VIDEO_SIN_DURACION, duracionSegundos: 30 }, visualizacionesCompletadas: 2 },
      error: null,
    });

    render(<InstruccionesContenido rol="ADMIN" />);

    const campoDuracion = await screen.findByLabelText("Duración en segundos");
    fireEvent.change(campoDuracion, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Fijar duración" }));

    await screen.findByText("2 empleados ya habían cumplido este video con la duración anterior.");
  });

  test("no aparece el campo manual cuando el video ya tiene duración", async () => {
    mockInstruccionesGet.mockResolvedValue({
      data: { instrucciones: [{ ...INSTRUCCION_SIN_VIDEO, archivos: [{ ...VIDEO_SIN_DURACION, duracionSegundos: 90 }] }] },
      error: null,
    });

    render(<InstruccionesContenido rol="ADMIN" />);

    await screen.findByText(INSTRUCCION_SIN_VIDEO.titulo);
    expect(screen.queryByLabelText("Duración en segundos")).toBeNull();
  });
});
