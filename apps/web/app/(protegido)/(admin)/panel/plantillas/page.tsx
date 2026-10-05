"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";
import { Campo, AreaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { CargandoTabla } from "@/components/ui/cargando";
import { XOctagon } from "lucide-react";

type TipoPlantilla = "UNIDAD" | "PAQUETE";

interface Plantilla {
  tipo: TipoPlantilla;
  contenido: string;
  actualizadaEn: string;
}

interface MarcadorInvalido {
  marcador: string;
  razon: "desconocido" | "no_aplica";
}

const TABS: { valor: TipoPlantilla; etiqueta: string }[] = [
  { valor: "UNIDAD", etiqueta: "Unidad" },
  { valor: "PAQUETE", etiqueta: "Paquete" },
];

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

export default function PaginaPlantillas() {
  const [tab, setTab] = useState<TipoPlantilla>("UNIDAD");
  const [cargando, setCargando] = useState(true);
  const [errorGlobal, setErrorGlobal] = useState<string | null>(null);

  const [plantillas, setPlantillas] = useState<Record<TipoPlantilla, Plantilla | null>>({
    UNIDAD: null,
    PAQUETE: null,
  });
  const [marcadoresPermitidos, setMarcadoresPermitidos] = useState<Record<TipoPlantilla, string[]>>({
    UNIDAD: [],
    PAQUETE: [],
  });

  const [contenidoEnEdicion, setContenidoEnEdicion] = useState<string>("");
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [marcadoresInvalidos, setMarcadoresInvalidos] = useState<MarcadorInvalido[]>([]);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [cargandoVistaPrevia, setCargandoVistaPrevia] = useState(false);

  async function cargar() {
    setCargando(true);
    setErrorGlobal(null);
    const { data, error: errorRespuesta } = await api.plantillas.get();
    setCargando(false);

    if (errorRespuesta || !data) {
      setErrorGlobal(mensajeDeError(errorRespuesta));
      return;
    }

    const map = { UNIDAD: null, PAQUETE: null } as Record<TipoPlantilla, Plantilla | null>;
    for (const p of data.plantillas) {
      map[p.tipo] = p;
    }
    setPlantillas(map);
    setMarcadoresPermitidos({
      UNIDAD: data.marcadoresPorTipo.UNIDAD,
      PAQUETE: data.marcadoresPorTipo.PAQUETE,
    });
    
    // Set initial content for the active tab
    setContenidoEnEdicion(map[tab]?.contenido ?? "");
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync state when tab changes
  useEffect(() => {
    setContenidoEnEdicion(plantillas[tab]?.contenido ?? "");
    setVistaPrevia(null);
    setErrorGuardar(null);
    setMarcadoresInvalidos([]);
    setMensajeExito(null);
  }, [tab, plantillas]);

  async function manejarVistaPrevia() {
    setCargandoVistaPrevia(true);
    setErrorGuardar(null);
    setMarcadoresInvalidos([]);
    setMensajeExito(null);

    const { data, error: errorRespuesta } = await api.plantillas({ tipo: tab })["vista-previa"].post({
      contenido: contenidoEnEdicion,
    });

    setCargandoVistaPrevia(false);

    if (errorRespuesta || !data) {
      setErrorGuardar(mensajeDeError(errorRespuesta));
      return;
    }

    setVistaPrevia(data.mensaje);
    if (data.marcadoresInvalidos.length > 0) {
      setMarcadoresInvalidos(data.marcadoresInvalidos);
    }
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setGuardando(true);
    setErrorGuardar(null);
    setMarcadoresInvalidos([]);
    setMensajeExito(null);
    setVistaPrevia(null);

    const { data, error: errorRespuesta } = await api.plantillas({ tipo: tab }).put({
      contenido: contenidoEnEdicion,
    });

    setGuardando(false);

    if (errorRespuesta || !data) {
      setErrorGuardar(mensajeDeError(errorRespuesta));
      const valor = (errorRespuesta as any)?.value;
      if (valor?.marcadoresInvalidos) {
        setMarcadoresInvalidos(valor.marcadoresInvalidos);
      }
      return;
    }

    setMensajeExito("Plantilla guardada correctamente.");
    setPlantillas((prev) => ({ ...prev, [tab]: data.plantilla }));
  }

  async function restaurar() {
    if (!confirm("¿Seguro que quieres restaurar la plantilla a su valor por defecto?")) return;
    
    setGuardando(true);
    setErrorGuardar(null);
    setMensajeExito(null);
    setVistaPrevia(null);

    const { data, error: errorRespuesta } = await api.plantillas({ tipo: tab }).restaurar.post();
    setGuardando(false);

    if (errorRespuesta || !data) {
      setErrorGuardar(mensajeDeError(errorRespuesta));
      return;
    }

    setMensajeExito("Plantilla restaurada correctamente.");
    setPlantillas((prev) => ({ ...prev, [tab]: data.plantilla }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina text-ink">Plantillas de WhatsApp</h1>
        <p className="cuerpo text-ink-muted">
          Edita el texto del mensaje que se generará al registrar una venta. Los cambios aplicarán a las nuevas ventas, no a las ya registradas.
        </p>
      </div>

      <div className="flex gap-1.5">
        {TABS.map((opcion) => (
          <button
            key={opcion.valor}
            type="button"
            onClick={() => setTab(opcion.valor)}
            className={cn(
              "rounded-control border px-3 py-1.5 text-xs font-medium transition-colors",
              tab === opcion.valor
                ? "border-primario-suave bg-primario-suave text-primario-texto"
                : "border-borde text-ink-2 hover:bg-black/4 dark:hover:bg-white/5",
            )}
          >
            {opcion.etiqueta}
          </button>
        ))}
      </div>

      {errorGlobal ? (
        <Aviso variante="critico">{errorGlobal}</Aviso>
      ) : cargando ? (
        <CargandoTabla filas={3} columnas={1} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <form onSubmit={guardar} className="space-y-4">
              <Campo etiqueta="Contenido de la plantilla" required>
                {(props) => (
                  <AreaCampo
                    {...props}
                    required
                    className="h-96 font-mono text-sm leading-relaxed"
                    value={contenidoEnEdicion}
                    onChange={(e) => setContenidoEnEdicion(e.target.value)}
                  />
                )}
              </Campo>

              {errorGuardar ? <Aviso variante="critico">{errorGuardar}</Aviso> : null}
              {mensajeExito ? <Aviso variante="info">{mensajeExito}</Aviso> : null}

              {marcadoresInvalidos.length > 0 ? (
                <div className="rounded-control border border-peligro/20 bg-peligro/10 p-3">
                  <div className="flex items-start gap-2">
                    <XOctagon className="h-5 w-5 text-peligro shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-peligro">Marcadores inválidos detectados:</p>
                      <ul className="text-sm text-peligro-texto list-disc list-inside">
                        {marcadoresInvalidos.map((m, i) => (
                          <li key={i}>
                            <code className="font-mono bg-peligro/10 px-1 rounded">{`{{${m.marcador}}}`}</code>:{" "}
                            {m.razon === "desconocido" ? "No existe este marcador" : "No aplica a este tipo de venta"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="flex gap-2">
                <Boton type="submit" variante="principal" disabled={guardando || contenidoEnEdicion === plantillas[tab]?.contenido}>
                  {guardando ? "Guardando…" : "Guardar"}
                </Boton>
                <Boton type="button" variante="secundario" disabled={cargandoVistaPrevia} onClick={manejarVistaPrevia}>
                  Vista previa
                </Boton>
                <div className="flex-1" />
                <Boton type="button" variante="destructivo" onClick={restaurar}>
                  Restaurar por defecto
                </Boton>
              </div>
            </form>

            <div className="rounded-control border border-borde bg-plano p-4 space-y-2">
              <h3 className="font-medium text-sm text-ink">Marcadores permitidos</h3>
              <p className="text-xs text-ink-muted">Usa estas etiquetas para inyectar datos reales de la venta:</p>
              <div className="flex flex-wrap gap-2 pt-2">
                {marcadoresPermitidos[tab].map((marcador) => (
                  <code key={marcador} className="text-xs font-mono bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded border border-borde/50">
                    {`{{${marcador}}}`}
                  </code>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-medium text-sm text-ink px-1">Vista previa renderizada</h3>
            {vistaPrevia ? (
              <div className="rounded-control border border-borde bg-[#e5ddd5] dark:bg-[#111b21] p-4 relative min-h-[400px]">
                <div className="bg-white dark:bg-[#202c33] rounded-lg p-3 text-sm whitespace-pre-wrap font-sans text-black dark:text-white shadow-sm inline-block max-w-[85%]">
                  {vistaPrevia}
                </div>
              </div>
            ) : (
              <div className="rounded-control border border-dashed border-borde p-8 flex flex-col items-center justify-center text-center h-96">
                <p className="text-sm text-ink-muted">
                  Escribe en el editor y presiona <br/> <strong className="font-medium">Vista previa</strong> para ver cómo se verá en WhatsApp.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
