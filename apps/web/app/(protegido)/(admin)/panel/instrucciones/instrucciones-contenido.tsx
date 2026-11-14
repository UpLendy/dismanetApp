"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  Loader2,
  Megaphone,
  Pencil,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { satisfaceRol, type Rol } from "@/lib/rol";
import { hoyBogotaISO, sumarDiasISO } from "@/lib/bogota";
import { Boton } from "@/components/ui/boton";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { Campo, AreaCampo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Esqueleto } from "@/components/ui/cargando";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { Pastilla } from "@/components/ui/pastilla";
import { Dialogo } from "@/components/ui/dialogo";

interface ArchivoInstruccion {
  id: string;
  tipo: "IMAGEN" | "VIDEO";
  nombre: string;
  contentType: string;
  bytes: number;
  duracionSegundos: number | null;
  orden: number;
  createdAt: string;
}

interface Instruccion {
  id: string;
  titulo: string;
  descripcion: string | null;
  semanaInicio: string;
  cargoId: string | null;
  publicada: boolean;
  archivos: ArchivoInstruccion[];
  cumplida?: boolean;
}

interface Cargo {
  id: string;
  nombre: string;
}

interface ProgresoVideo {
  archivoId: string;
  duracionSegundos: number | null;
  segundosVistos: number;
  cobertura: number;
  completado: boolean;
}

interface VideoPersona {
  archivoId: string;
  cobertura: number;
  completado: boolean;
}

interface FilaCumplimiento {
  id: string;
  nombre: string;
  cumplio: boolean;
  completadoEn: string | null;
  videos: VideoPersona[];
}

interface VideoResumen {
  id: string;
  nombre: string;
  duracionSegundos: number | null;
}

// Misma lista blanca que lib/s3.ts (CLAUDE.md: validar antes no reemplaza
// la validación real del servidor — esto es solo para no dejar que el
// navegador intente subir algo que el API va a rechazar de todos modos).
const TIPOS_ACEPTADOS = "image/png,image/jpeg,image/webp,video/mp4,video/webm";

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

/** Lunes (YYYY-MM-DD, calendario Bogotá) de la semana a la que pertenece `fechaISO`. Mismo cálculo que reportes-contenido.tsx. */
function lunesDeSemanaISO(fechaISO: string): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  const diasDesdeLunes = (diaSemana + 6) % 7;
  return sumarDiasISO(fechaISO, -diasDesdeLunes);
}

/** "15 jun – 21 jun" a partir del lunes de la semana. */
function rangoSemanaLegible(lunesISO: string): string {
  const domingoISO = sumarDiasISO(lunesISO, 6);
  const formato = (iso: string) => {
    const [, mes, dia] = iso.split("-").map(Number);
    const nombreMes = new Date(Date.UTC(2000, mes - 1, 1)).toLocaleDateString("es-CO", { month: "short" });
    return `${dia} ${nombreMes}`;
  };
  return `${formato(lunesISO)} – ${formato(domingoISO)}`;
}

/**
 * Sube `archivo` directo a `url` (prefirmada de S3) con progreso: fetch no
 * expone eventos de subida, por eso XMLHttpRequest. El API nunca ve estos
 * bytes (PROMPT-F6.7, Parte 1).
 */
function subirArchivoAS3(url: string, archivo: File, onProgreso: (fraccion: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", archivo.type);
    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable) onProgreso(evento.loaded / evento.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`La subida a S3 falló (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("La subida a S3 falló."));
    xhr.send(archivo);
  });
}

export function InstruccionesContenido({ rol }: { rol: Rol }) {
  const esAdmin = satisfaceRol(rol, "ADMIN");
  return esAdmin ? <VistaAdmin /> : <VistaEmpleado />;
}

function SelectorSemana({
  lunesActual,
  semana,
  onCambiar,
}: {
  lunesActual: string;
  semana: string;
  onCambiar: (semana: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Boton variante="contorno" tamano="sm" onClick={() => onCambiar(sumarDiasISO(semana, -7))} aria-label="Semana anterior">
        <ChevronLeft />
      </Boton>
      <Boton variante="contorno" tamano="sm" onClick={() => onCambiar(lunesActual)} disabled={semana === lunesActual}>
        {rangoSemanaLegible(semana)}
      </Boton>
      <Boton
        variante="contorno"
        tamano="sm"
        onClick={() => onCambiar(sumarDiasISO(semana, 7))}
        disabled={semana === lunesActual}
        aria-label="Semana siguiente"
      >
        <ChevronRight />
      </Boton>
    </div>
  );
}

function ArchivoVista({ instruccionId, archivo }: { instruccionId: string; archivo: ArchivoInstruccion }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const { data } = await api.instrucciones({ id: instruccionId }).archivos({ archivoId: archivo.id }).url.get();
      if (vigente && data) setUrl(data.url);
    })();
    return () => {
      vigente = false;
    };
  }, [instruccionId, archivo.id]);

  if (!url) return <Esqueleto className="h-40 w-full max-w-sm" />;

  if (archivo.tipo === "VIDEO") {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video src={url} controls className="max-h-80 w-full max-w-sm rounded-control border border-borde" />
    );
  }
  return <img src={url} alt={archivo.nombre} className="max-h-80 w-full max-w-sm rounded-control border border-borde object-contain" />;
}

/**
 * Video del EMPLEADO: reporta progreso al servidor mientras se reproduce
 * (PROMPT-F6.8, Parte 1 y 4). El control que de verdad decide si cuenta es
 * el reloj del servidor en aplicarProgreso — esto solo junta los tramos
 * jugados y los manda cada ~10s, al pausar, al cambiar de pestaña y al
 * terminar. Nunca en cada `timeupdate`: son varias veces por segundo.
 */
function VideoEmpleado({
  instruccionId,
  archivo,
  progreso,
  onProgreso,
}: {
  instruccionId: string;
  archivo: ArchivoInstruccion;
  progreso: ProgresoVideo | undefined;
  onProgreso: (progreso: ProgresoVideo) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tramoInicioRef = useRef<number | null>(null);
  const reportandoRef = useRef(false);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const { data } = await api.instrucciones({ id: instruccionId }).archivos({ archivoId: archivo.id }).url.get();
      if (vigente && data) setUrl(data.url);
    })();
    return () => {
      vigente = false;
    };
  }, [instruccionId, archivo.id]);

  const reportar = useCallback(
    async (desde: number, hasta: number) => {
      if (hasta <= desde || reportandoRef.current) return;
      reportandoRef.current = true;
      const { data } = await api
        .instrucciones({ id: instruccionId })
        .archivos({ archivoId: archivo.id })
        .progreso.post({ desde, hasta });
      reportandoRef.current = false;
      if (data) {
        onProgreso({
          archivoId: archivo.id,
          duracionSegundos: archivo.duracionSegundos,
          segundosVistos: data.segundosVistos,
          cobertura: data.cobertura,
          completado: data.completado,
        });
      }
    },
    [instruccionId, archivo.id, archivo.duracionSegundos, onProgreso],
  );

  // Cierra el tramo abierto desde tramoInicioRef hasta `hasta` y lo reporta.
  // `continuar` decide si el siguiente tramo arranca en `hasta` (sigue
  // reproduciendo) o queda cerrado (pausó / terminó / cambió de pestaña).
  const flush = useCallback(
    (hasta: number, continuar: boolean) => {
      const desde = tramoInicioRef.current;
      if (desde != null && hasta > desde) reportar(desde, hasta);
      tramoInicioRef.current = continuar ? hasta : null;
    },
    [reportar],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function alReproducir() {
      if (tramoInicioRef.current == null) tramoInicioRef.current = video!.currentTime;
    }
    function alPausar() {
      flush(video!.currentTime, false);
    }
    function alTerminar() {
      flush(video!.currentTime, false);
    }
    function alCambiarPestana() {
      flush(video!.currentTime, !video!.paused);
    }

    video.addEventListener("play", alReproducir);
    video.addEventListener("pause", alPausar);
    video.addEventListener("ended", alTerminar);
    document.addEventListener("visibilitychange", alCambiarPestana);
    const intervalo = window.setInterval(() => {
      if (!video.paused) flush(video.currentTime, true);
    }, 10_000);

    return () => {
      video.removeEventListener("play", alReproducir);
      video.removeEventListener("pause", alPausar);
      video.removeEventListener("ended", alTerminar);
      document.removeEventListener("visibilitychange", alCambiarPestana);
      window.clearInterval(intervalo);
    };
  }, [flush, url]);

  if (!url) return <Esqueleto className="h-40 w-full max-w-sm" />;

  const cobertura = progreso?.cobertura ?? 0;
  const porcentaje = Math.min(100, Math.round(cobertura * 100));

  return (
    <div className="w-full max-w-sm space-y-2">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} src={url} controls className="max-h-80 w-full rounded-control border border-borde" />
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>Cumplimiento</span>
          <span>{porcentaje}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-plano"
          role="progressbar"
          aria-valuenow={porcentaje}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-[width] ${progreso?.completado ? "bg-bien" : "bg-primario"}`}
            style={{ width: `${porcentaje}%` }}
          />
        </div>
        {archivo.duracionSegundos == null ? (
          <p className="text-xs text-aviso">Este video no tiene duración registrada: no cuenta para el cumplimiento automático.</p>
        ) : null}
      </div>
    </div>
  );
}

function VistaEmpleado() {
  const lunesActual = useMemo(() => lunesDeSemanaISO(hoyBogotaISO()), []);
  const [semana, setSemana] = useState(lunesActual);

  const [instrucciones, setInstrucciones] = useState<Instruccion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [completando, setCompletando] = useState<string | null>(null);
  const [progresoPorArchivo, setProgresoPorArchivo] = useState<Record<string, ProgresoVideo>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    const { data, error } = await api.instrucciones.get({ query: { semana } });
    if (error || !data) {
      setErrorCarga(mensajeDeError(error));
      setCargando(false);
      return;
    }
    setInstrucciones(data.instrucciones);
    setCargando(false);

    // Progreso propio de cada video, para la barra de cumplimiento y para
    // saber de entrada qué instrucciones ya quedaron completas solas.
    const conVideo = data.instrucciones.filter((i) => i.archivos.some((a) => a.tipo === "VIDEO"));
    const respuestas = await Promise.all(conVideo.map((i) => api.instrucciones({ id: i.id }).progreso.get()));
    const mapa: Record<string, ProgresoVideo> = {};
    for (const { data: respuesta } of respuestas) {
      if (!respuesta) continue;
      for (const p of respuesta.progreso) mapa[p.archivoId] = p;
    }
    setProgresoPorArchivo((previo) => ({ ...previo, ...mapa }));
  }, [semana]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function marcarCumplida(id: string) {
    setCompletando(id);
    const { error } = await api.instrucciones({ id }).completar.post();
    setCompletando(null);
    if (!error) {
      setInstrucciones((lista) => lista.map((i) => (i.id === id ? { ...i, cumplida: true } : i)));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Instrucciones semanales</h1>
          <p className="cuerpo text-ink-muted">Lo que tu equipo publicó para esta semana.</p>
        </div>
        <SelectorSemana lunesActual={lunesActual} semana={semana} onCambiar={setSemana} />
      </div>

      {errorCarga ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar"
          accion={
            <Boton variante="contorno" onClick={cargar}>
              Reintentar
            </Boton>
          }
        >
          {errorCarga}
        </Aviso>
      ) : null}

      {cargando ? (
        <div className="space-y-3">
          <Esqueleto className="h-40 w-full" />
          <Esqueleto className="h-40 w-full" />
        </div>
      ) : instrucciones.length === 0 ? (
        <EstadoVacio icono={Megaphone} titulo="Sin instrucciones" descripcion="No hay nada publicado para esta semana." />
      ) : (
        <div className="space-y-4">
          {instrucciones.map((instruccion) => {
            // Una instrucción con video se completa sola cuando todos sus
            // videos quedan completos (PROMPT-F6.8, Parte 2): no depende de
            // "Marcar como visto", que para esos archivos responde 409.
            const videos = instruccion.archivos.filter((a) => a.tipo === "VIDEO");
            const tieneVideo = videos.length > 0;
            const todosLosVideosVistos = tieneVideo && videos.every((v) => progresoPorArchivo[v.id]?.completado);
            const cumplida = instruccion.cumplida || todosLosVideosVistos;

            return (
              <Tarjeta key={instruccion.id}>
                <TarjetaCabecera
                  titulo={instruccion.titulo}
                  accion={
                    cumplida ? (
                      <Pastilla tono="bien" icono={CheckCircle2}>
                        Visto
                      </Pastilla>
                    ) : (
                      <Pastilla tono="aviso" icono={Circle}>
                        Pendiente
                      </Pastilla>
                    )
                  }
                />
                {instruccion.descripcion ? <p className="cuerpo mb-4 whitespace-pre-wrap text-ink-2">{instruccion.descripcion}</p> : null}
                {instruccion.archivos.length > 0 ? (
                  <div className="mb-4 flex flex-wrap gap-3">
                    {instruccion.archivos.map((archivo) =>
                      archivo.tipo === "VIDEO" ? (
                        <VideoEmpleado
                          key={archivo.id}
                          instruccionId={instruccion.id}
                          archivo={archivo}
                          progreso={progresoPorArchivo[archivo.id]}
                          onProgreso={(p) => setProgresoPorArchivo((previo) => ({ ...previo, [archivo.id]: p }))}
                        />
                      ) : (
                        <ArchivoVista key={archivo.id} instruccionId={instruccion.id} archivo={archivo} />
                      ),
                    )}
                  </div>
                ) : null}
                {!cumplida && !tieneVideo ? (
                  <div className="flex justify-end">
                    <Boton variante="principal" onClick={() => marcarCumplida(instruccion.id)} disabled={completando === instruccion.id}>
                      {completando === instruccion.id ? "Marcando…" : "Marcar como visto"}
                    </Boton>
                  </div>
                ) : null}
              </Tarjeta>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FormularioInstruccion({
  semana,
  cargos,
  onCreada,
  onCancelar,
}: {
  semana: string;
  cargos: Cargo[];
  onCreada: (instruccion: Instruccion) => void;
  onCancelar: () => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [cargoId, setCargoId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!titulo.trim()) {
      setError("El título es obligatorio.");
      return;
    }
    setGuardando(true);
    setError(null);
    const { data, error: errorRespuesta } = await api.instrucciones.post({
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      semana,
      cargoId: cargoId || null,
    });
    setGuardando(false);
    // "instruccion" in data, no solo !data: api.instrucciones.post convive
    // con api.instrucciones({ id }) en el mismo nodo de Eden Treaty, y esa
    // doble naturaleza (ruta literal + llamada dinámica) amplía el tipo de
    // `data` a la unión de TODAS las respuestas del recurso, sin que
    // TypeScript lo reduzca con un simple `if (!data)`.
    if (errorRespuesta || !data || !("instruccion" in data)) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    onCreada(data.instruccion as Instruccion);
  }

  return (
    <Tarjeta>
      <TarjetaCabecera titulo="Nueva instrucción" />
      <div className="space-y-4">
        <Campo etiqueta="Título" required>
          {(p) => <EntradaCampo {...p} value={titulo} onChange={(e) => setTitulo(e.target.value)} />}
        </Campo>
        <Campo etiqueta="Descripción">
          {(p) => <AreaCampo {...p} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />}
        </Campo>
        <Campo etiqueta="Cargo" ayuda="Vacío = todos los empleados.">
          {(p) => (
            <SelectCampo {...p} value={cargoId} onChange={(e) => setCargoId(e.target.value)}>
              <option value="">Todos los cargos</option>
              {cargos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </SelectCampo>
          )}
        </Campo>
        {error ? <Aviso variante="critico">{error}</Aviso> : null}
        <div className="flex justify-end gap-2">
          <Boton variante="contorno" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="principal" onClick={guardar} disabled={guardando}>
            {guardando ? "Creando…" : "Crear"}
          </Boton>
        </div>
      </div>
    </Tarjeta>
  );
}

function SubidaArchivo({ instruccionId, onSubido }: { instruccionId: string; onSubido: (archivo: ArchivoInstruccion) => void }) {
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function manejarArchivo(archivo: File | undefined) {
    if (!archivo) return;
    setSubiendo(true);
    setProgreso(0);
    setError(null);

    const urlSubida = await api.instrucciones({ id: instruccionId }).archivos["url-subida"].post({
      nombre: archivo.name,
      contentType: archivo.type,
      bytes: archivo.size,
    });
    if (urlSubida.error || !urlSubida.data) {
      setError(mensajeDeError(urlSubida.error));
      setSubiendo(false);
      return;
    }

    try {
      await subirArchivoAS3(urlSubida.data.url, archivo, setProgreso);
    } catch {
      setError("La subida se interrumpió. Vuelve a intentarlo.");
      setSubiendo(false);
      return;
    }

    const registro = await api.instrucciones({ id: instruccionId }).archivos.post({
      clave: urlSubida.data.clave,
      nombre: archivo.name,
      contentType: archivo.type,
    });
    setSubiendo(false);
    // Mismo motivo que en FormularioInstruccion.guardar: "archivos" es a la
    // vez ruta literal (.post aquí) y nodo dinámico (.archivos({archivoId})
    // en otra ruta), así que Eden Treaty amplía el tipo de `data`.
    if (registro.error || !registro.data || !("archivo" in registro.data)) {
      setError(mensajeDeError(registro.error));
      return;
    }
    onSubido(registro.data.archivo as ArchivoInstruccion);
  }

  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-control border border-borde bg-superficie px-3 py-2 text-sm font-medium text-ink hover:bg-plano">
        <Upload className="size-4" />
        Subir imagen o video
        <input
          type="file"
          accept={TIPOS_ACEPTADOS}
          className="hidden"
          disabled={subiendo}
          onChange={(e) => {
            const archivo = e.target.files?.[0];
            e.target.value = "";
            manejarArchivo(archivo);
          }}
        />
      </label>
      {subiendo ? (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <Loader2 className="size-3.5 animate-spin" />
          Subiendo… {Math.round(progreso * 100)}%
        </div>
      ) : null}
      {error ? <Aviso variante="critico">{error}</Aviso> : null}
    </div>
  );
}

function PanelCumplimiento({ instruccionId }: { instruccionId: string }) {
  const [filas, setFilas] = useState<FilaCumplimiento[] | null>(null);
  const [videos, setVideos] = useState<VideoResumen[]>([]);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const { data } = await api.instrucciones({ id: instruccionId }).cumplimiento.get();
      if (vigente && data) {
        setFilas(data.cumplimiento);
        setVideos(data.videos);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [instruccionId]);

  if (!filas) return <Esqueleto className="h-16 w-full" />;
  if (filas.length === 0) return <p className="cuerpo text-ink-muted">Ningún empleado activo tiene esta instrucción asignada.</p>;

  return (
    <ul className="space-y-3">
      {filas.map((fila) => (
        <li key={fila.id} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink">{fila.nombre}</span>
            {fila.cumplio ? (
              <Pastilla tono="bien" icono={CheckCircle2}>
                Visto
              </Pastilla>
            ) : (
              <Pastilla tono="aviso" icono={Circle}>
                Pendiente
              </Pastilla>
            )}
          </div>
          {videos.length > 0 ? (
            <ul className="space-y-1 pl-3">
              {videos.map((video) => {
                const deEsteVideo = fila.videos.find((v) => v.archivoId === video.id);
                const porcentaje = Math.round((deEsteVideo?.cobertura ?? 0) * 100);
                return (
                  <li key={video.id} className="flex items-center justify-between gap-3 text-xs text-ink-muted">
                    <span className="truncate">{video.nombre}</span>
                    <span>{video.duracionSegundos == null ? "sin duración" : deEsteVideo?.completado ? "completo" : `${porcentaje}%`}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function TarjetaInstruccionAdmin({
  instruccion,
  cargos,
  onCambiada,
  onBorrada,
}: {
  instruccion: Instruccion;
  cargos: Cargo[];
  onCambiada: (instruccion: Instruccion) => void;
  onBorrada: (id: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(instruccion.titulo);
  const [descripcion, setDescripcion] = useState(instruccion.descripcion ?? "");
  const [cargoId, setCargoId] = useState(instruccion.cargoId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cambiandoPublicacion, setCambiandoPublicacion] = useState(false);
  const [mostrarCumplimiento, setMostrarCumplimiento] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [errorBorrado, setErrorBorrado] = useState<string | null>(null);

  const cargo = cargos.find((c) => c.id === instruccion.cargoId);

  async function guardarEdicion() {
    setGuardando(true);
    setError(null);
    const { data, error: errorRespuesta } = await api.instrucciones({ id: instruccion.id }).patch({
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      cargoId: cargoId || null,
    });
    setGuardando(false);
    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    onCambiada(data.instruccion);
    setEditando(false);
  }

  async function alternarPublicacion() {
    setCambiandoPublicacion(true);
    const llamada = instruccion.publicada
      ? api.instrucciones({ id: instruccion.id }).despublicar.patch()
      : api.instrucciones({ id: instruccion.id }).publicar.patch();
    const { data } = await llamada;
    setCambiandoPublicacion(false);
    if (data) onCambiada(data.instruccion);
  }

  async function confirmarBorrado() {
    setBorrando(true);
    setErrorBorrado(null);
    const { error } = await api.instrucciones({ id: instruccion.id }).delete();
    setBorrando(false);
    if (error) {
      setErrorBorrado(mensajeDeError(error));
      return;
    }
    setConfirmandoBorrado(false);
    onBorrada(instruccion.id);
  }

  function archivoSubido(archivo: ArchivoInstruccion) {
    onCambiada({ ...instruccion, archivos: [...instruccion.archivos, archivo] });
  }

  async function borrarArchivo(archivoId: string) {
    const { error } = await api.instrucciones({ id: instruccion.id }).archivos({ archivoId }).delete();
    if (!error) {
      onCambiada({ ...instruccion, archivos: instruccion.archivos.filter((a) => a.id !== archivoId) });
    }
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={editando ? "Editando instrucción" : instruccion.titulo}
        accion={
          <div className="flex items-center gap-2">
            {instruccion.publicada ? (
              <Pastilla tono="bien" icono={CheckCircle2}>
                Publicada
              </Pastilla>
            ) : (
              <Pastilla tono="secundario" icono={Circle}>
                Borrador
              </Pastilla>
            )}
            {!editando ? (
              <Boton variante="fantasma" tamano="sm" onClick={() => setEditando(true)} aria-label="Editar">
                <Pencil />
              </Boton>
            ) : null}
          </div>
        }
      />

      {editando ? (
        <div className="space-y-4">
          <Campo etiqueta="Título" required>
            {(p) => <EntradaCampo {...p} value={titulo} onChange={(e) => setTitulo(e.target.value)} />}
          </Campo>
          <Campo etiqueta="Descripción">
            {(p) => <AreaCampo {...p} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />}
          </Campo>
          <Campo etiqueta="Cargo" ayuda="Vacío = todos los empleados.">
            {(p) => (
              <SelectCampo {...p} value={cargoId} onChange={(e) => setCargoId(e.target.value)}>
                <option value="">Todos los cargos</option>
                {cargos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </SelectCampo>
            )}
          </Campo>
          {error ? <Aviso variante="critico">{error}</Aviso> : null}
          <div className="flex justify-end gap-2">
            <Boton variante="contorno" onClick={() => setEditando(false)} disabled={guardando}>
              Cancelar
            </Boton>
            <Boton variante="principal" onClick={guardarEdicion} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </Boton>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <Pastilla tono="neutral">{cargo ? cargo.nombre : "Todos los cargos"}</Pastilla>
          </div>
          {instruccion.descripcion ? <p className="cuerpo mb-4 whitespace-pre-wrap text-ink-2">{instruccion.descripcion}</p> : null}

          {instruccion.archivos.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-3">
              {instruccion.archivos.map((archivo) => (
                <div key={archivo.id} className="space-y-1">
                  <ArchivoVista instruccionId={instruccion.id} archivo={archivo} />
                  <Boton variante="fantasma" tamano="sm" onClick={() => borrarArchivo(archivo.id)}>
                    <Trash2 className="text-primario-texto" /> Quitar
                  </Boton>
                </div>
              ))}
            </div>
          ) : (
            <p className="cuerpo mb-4 text-ink-muted">Sin imágenes ni video todavía.</p>
          )}

          <div className="mb-4">
            <SubidaArchivo instruccionId={instruccion.id} onSubido={archivoSubido} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-borde pt-4">
            <Boton variante="fantasma" tamano="sm" onClick={() => setMostrarCumplimiento((v) => !v)}>
              <Users /> {mostrarCumplimiento ? "Ocultar cumplimiento" : "Ver cumplimiento"}
            </Boton>
            <div className="flex items-center gap-2">
              <Boton variante="contorno" tamano="sm" onClick={alternarPublicacion} disabled={cambiandoPublicacion}>
                {instruccion.publicada ? "Despublicar" : "Publicar"}
              </Boton>
              <Boton
                variante="destructivo"
                tamano="sm"
                onClick={() => setConfirmandoBorrado(true)}
                disabled={instruccion.publicada}
                title={instruccion.publicada ? "Despublica primero para poder borrarla." : undefined}
              >
                <Trash2 /> Borrar
              </Boton>
            </div>
          </div>

          {mostrarCumplimiento ? (
            <div className="mt-4 rounded-control border border-borde p-3">
              <PanelCumplimiento instruccionId={instruccion.id} />
            </div>
          ) : null}
        </>
      )}

      <Dialogo
        abierto={confirmandoBorrado}
        onCambiarAbierto={setConfirmandoBorrado}
        titulo="Borrar instrucción"
        descripcion={`Se borrará "${instruccion.titulo}" junto con sus archivos. Esta acción no se puede deshacer.`}
        textoConfirmar="Borrar"
        confirmando={borrando}
        onConfirmar={confirmarBorrado}
      >
        {errorBorrado ? <Aviso variante="critico">{errorBorrado}</Aviso> : null}
      </Dialogo>
    </Tarjeta>
  );
}

function VistaAdmin() {
  const lunesActual = useMemo(() => lunesDeSemanaISO(hoyBogotaISO()), []);
  const [semana, setSemana] = useState(lunesActual);

  const [instrucciones, setInstrucciones] = useState<Instruccion[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    const [resInstrucciones, resCargos] = await Promise.all([
      api.instrucciones.get({ query: { semana } }),
      api.cargos.get(),
    ]);
    if (resInstrucciones.error || !resInstrucciones.data) {
      setErrorCarga(mensajeDeError(resInstrucciones.error));
      setCargando(false);
      return;
    }
    setInstrucciones(resInstrucciones.data.instrucciones);
    if (resCargos.data) setCargos(resCargos.data.cargos);
    setCargando(false);
  }, [semana]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function instruccionCreada(instruccion: Instruccion) {
    setInstrucciones((lista) => [...lista, instruccion]);
    setCreando(false);
  }

  function instruccionCambiada(instruccion: Instruccion) {
    setInstrucciones((lista) => lista.map((i) => (i.id === instruccion.id ? instruccion : i)));
  }

  function instruccionBorrada(id: string) {
    setInstrucciones((lista) => lista.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Instrucciones semanales</h1>
          <p className="cuerpo text-ink-muted">Crea, publica y da seguimiento a las instrucciones del equipo.</p>
        </div>
        <div className="flex items-center gap-2">
          <SelectorSemana lunesActual={lunesActual} semana={semana} onCambiar={setSemana} />
          {!creando ? (
            <Boton variante="principal" onClick={() => setCreando(true)}>
              Nueva instrucción
            </Boton>
          ) : null}
        </div>
      </div>

      {errorCarga ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar"
          accion={
            <Boton variante="contorno" onClick={cargar}>
              Reintentar
            </Boton>
          }
        >
          {errorCarga}
        </Aviso>
      ) : null}

      {creando ? (
        <FormularioInstruccion semana={semana} cargos={cargos} onCreada={instruccionCreada} onCancelar={() => setCreando(false)} />
      ) : null}

      {cargando ? (
        <div className="space-y-3">
          <Esqueleto className="h-40 w-full" />
          <Esqueleto className="h-40 w-full" />
        </div>
      ) : instrucciones.length === 0 && !creando ? (
        <EstadoVacio
          icono={ClipboardList}
          titulo="Sin instrucciones esta semana"
          descripcion="Crea la primera instrucción para el equipo."
          accion={
            <Boton variante="principal" onClick={() => setCreando(true)}>
              Nueva instrucción
            </Boton>
          }
        />
      ) : (
        <div className="space-y-4">
          {instrucciones.map((instruccion) => (
            <TarjetaInstruccionAdmin
              key={instruccion.id}
              instruccion={instruccion}
              cargos={cargos}
              onCambiada={instruccionCambiada}
              onBorrada={instruccionBorrada}
            />
          ))}
        </div>
      )}
    </div>
  );
}
