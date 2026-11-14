import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { leerDuracionVideo } from "./duracion-video.ts";

// jsdom/happy-dom no decodifica video de verdad: no hay forma de que un
// <video> real dispare loadedmetadata con una duración. Por eso se
// intercepta document.createElement("video") para quedarse con una
// referencia al elemento que la función crea internamente, y se simulan
// los eventos a mano.
describe("leerDuracionVideo", () => {
  let videoCreado: HTMLVideoElement | null = null;
  let crearElementoOriginal: typeof document.createElement;
  let crearObjectURLOriginal: typeof URL.createObjectURL;
  let revocarObjectURLOriginal: typeof URL.revokeObjectURL;

  beforeEach(() => {
    videoCreado = null;
    crearElementoOriginal = document.createElement.bind(document);
    document.createElement = ((etiqueta: string) => {
      const elemento = crearElementoOriginal(etiqueta);
      if (etiqueta === "video") videoCreado = elemento as HTMLVideoElement;
      return elemento;
    }) as typeof document.createElement;

    crearObjectURLOriginal = URL.createObjectURL;
    revocarObjectURLOriginal = URL.revokeObjectURL;
    URL.createObjectURL = (() => "blob:mock") as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    document.createElement = crearElementoOriginal;
    URL.createObjectURL = crearObjectURLOriginal;
    URL.revokeObjectURL = revocarObjectURLOriginal;
  });

  function dispararMetadatos(duracion: number) {
    Object.defineProperty(videoCreado!, "duration", { value: duracion, configurable: true });
    (videoCreado!.onloadedmetadata as (evento: Event) => void)(new Event("loadedmetadata"));
  }

  it("trunca a segundos enteros cuando el navegador reporta una duración real", async () => {
    const promesa = leerDuracionVideo(new File(["x"], "video.mp4", { type: "video/mp4" }));
    dispararMetadatos(185.7);
    expect(await promesa).toBe(185);
  });

  it("trunca en vez de redondear: un video de 5,6s nunca registra duración 6 (inalcanzable para quien solo tiene 5,6s que ver)", async () => {
    const promesa = leerDuracionVideo(new File(["x"], "video.mp4", { type: "video/mp4" }));
    dispararMetadatos(5.6);
    expect(await promesa).toBe(5);
  });

  it("devuelve null si duration llega como Infinity (webm sin indexar, antes de buscar dentro del archivo)", async () => {
    const promesa = leerDuracionVideo(new File(["x"], "video.webm", { type: "video/webm" }));
    dispararMetadatos(Number.POSITIVE_INFINITY);
    expect(await promesa).toBeNull();
  });

  it("devuelve null si duration llega como NaN", async () => {
    const promesa = leerDuracionVideo(new File(["x"], "video.webm", { type: "video/webm" }));
    dispararMetadatos(Number.NaN);
    expect(await promesa).toBeNull();
  });

  it("devuelve null si duration es cero o negativa", async () => {
    const promesa = leerDuracionVideo(new File(["x"], "video.mp4", { type: "video/mp4" }));
    dispararMetadatos(0);
    expect(await promesa).toBeNull();
  });

  it("devuelve null si el navegador no puede cargar los metadatos", async () => {
    const promesa = leerDuracionVideo(new File(["x"], "video.mp4", { type: "video/mp4" }));
    (videoCreado!.onerror as (evento: Event) => void)(new Event("error"));
    expect(await promesa).toBeNull();
  });
});
