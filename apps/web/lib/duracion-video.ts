/**
 * Duración real de un video, leída en el navegador antes de registrarlo.
 * Hueco entre F6.7 y F6.8: el API acepta `duracionSegundos` desde siempre,
 * pero nadie la calculaba, así que ningún video registraba cumplimiento
 * automático. En algunos webm, `video.duration` llega como Infinity o NaN
 * hasta que se busca dentro del archivo — en ese caso se devuelve null; el
 * aviso de "sin duración registrada" ya existente en la pantalla del
 * empleado se encarga del resto.
 *
 * Extraída a su propio módulo (en vez de vivir en el componente) para que
 * las pruebas puedan sustituirla con mock.module: jsdom/happy-dom no decodifica
 * video de verdad, así que no hay forma de disparar loadedmetadata con una
 * duración real dentro de una prueba de componente.
 */
export function leerDuracionVideo(archivo: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(archivo);

    function terminar(duracion: number | null) {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(duracion);
    }

    video.onloadedmetadata = () => {
      // Trunca, no redondea: duracionSegundos es Int igual que segundosVistos
      // (ambos capturados del mismo reloj del video), así que redondear hacia
      // arriba registra una duración que el video nunca puede entregar por
      // completo — un video de 5,6s pasaría a "duración 6", con cobertura
      // máxima real de 5/6 = 83%, inalcanzable contra cualquier umbral alto.
      const duracion = Math.floor(video.duration);
      terminar(Number.isFinite(duracion) && duracion > 0 ? duracion : null);
    };
    video.onerror = () => terminar(null);
    video.src = url;
  });
}
