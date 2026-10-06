"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Save, XOctagon } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";
import { Aviso } from "@/components/ui/aviso";
import { AreaCampo } from "@/components/ui/campo";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { Pastilla } from "@/components/ui/pastilla";
import { CargandoTarjeta } from "@/components/ui/cargando";

type Tipo = "UNIDAD" | "PAQUETE";

interface Plantilla {
  tipo: Tipo;
  contenido: string;
  actualizadaEn: string;
}

interface MarcadorInvalido {
  marcador: string;
  razon: "desconocido" | "no_aplica";
}

const TABS: { valor: Tipo; etiqueta: string }[] = [
  { valor: "UNIDAD", etiqueta: "Venta unitaria" },
  { valor: "PAQUETE", etiqueta: "Venta de paquete" },
];

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

function razonLegible(razon: MarcadorInvalido["razon"]): string {
  return razon === "desconocido" ? "no existe" : "no aplica a esta pestaña";
}

export default function PaginaMensajes() {
  const [tab, setTab] = useState<Tipo>("UNIDAD");
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  // Contenido guardado (lo que hay en BD) y contenido en edición, por
  // pestaña — cambiar de pestaña no debe perder lo que se estaba escribiendo
  // en la otra.
  const [guardado, setGuardado] = useState<Record<Tipo, Plantilla | null>>({ UNIDAD: null, PAQUETE: null });
  const [enEdicion, setEnEdicion] = useState<Record<Tipo, string>>({ UNIDAD: "", PAQUETE: "" });
  const [marcadoresPorTipo, setMarcadoresPorTipo] = useState<Record<Tipo, string[]>>({ UNIDAD: [], PAQUETE: [] });

  const [vistaPrevia, setVistaPrevia] = useState<string>("");
  const [marcadoresInvalidos, setMarcadoresInvalidos] = useState<MarcadorInvalido[]>([]);
  const [cargandoVistaPrevia, setCargandoVistaPrevia] = useState(false);

  const [guardando, setGuardando] = useState(false);
  const [restaurando, setRestaurando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  const areaRef = useRef<HTMLTextAreaElement>(null);

  async function cargar() {
    setCargando(true);
    setErrorCarga(null);
    const { data, error: errorRespuesta } = await api.plantillas.get();
    setCargando(false);

    if (errorRespuesta || !data) {
      setErrorCarga(mensajeDeError(errorRespuesta));
      return;
    }

    const porTipo = { UNIDAD: null, PAQUETE: null } as Record<Tipo, Plantilla | null>;
    const edicion = { UNIDAD: "", PAQUETE: "" };
    for (const plantilla of data.plantillas) {
      porTipo[plantilla.tipo] = plantilla;
      edicion[plantilla.tipo] = plantilla.contenido;
    }
    setGuardado(porTipo);
    setEnEdicion(edicion);
    setMarcadoresPorTipo({ UNIDAD: data.marcadoresPorTipo.UNIDAD, PAQUETE: data.marcadoresPorTipo.PAQUETE });
  }

  useEffect(() => {
    cargar();
  }, []);

  // Vista previa en vivo: el mismo endpoint que renderiza con
  // renderizarMensajeDeVenta — la función que también usa la venta real
  // (lib/mensaje-venta.ts) — así que nunca puede mostrar algo distinto a lo
  // que recibiría un comprador real. Debounce para no disparar una petición
  // por cada tecla.
  useEffect(() => {
    const contenido = enEdicion[tab];
    if (!guardado[tab] && contenido === "") return;

    const temporizador = setTimeout(async () => {
      setCargandoVistaPrevia(true);
      const { data, error: errorRespuesta } = await api.plantillas({ tipo: tab })["vista-previa"].post({ contenido });
      setCargandoVistaPrevia(false);
      if (errorRespuesta || !data) return;
      setVistaPrevia(data.mensaje);
      setMarcadoresInvalidos(data.marcadoresInvalidos);
    }, 400);

    return () => clearTimeout(temporizador);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, enEdicion[tab]]);

  function insertarMarcador(marcador: string) {
    const textoAInsertar = `{{${marcador}}}`;
    const area = areaRef.current;
    const contenidoActual = enEdicion[tab];

    if (!area) {
      setEnEdicion((prev) => ({ ...prev, [tab]: prev[tab] + textoAInsertar }));
      return;
    }

    const inicio = area.selectionStart ?? contenidoActual.length;
    const fin = area.selectionEnd ?? contenidoActual.length;
    const nuevoContenido = contenidoActual.slice(0, inicio) + textoAInsertar + contenidoActual.slice(fin);

    setEnEdicion((prev) => ({ ...prev, [tab]: nuevoContenido }));

    // El cursor debe quedar justo después del marcador insertado, no al
    // final del texto — permite encadenar varios clics en el mismo punto.
    requestAnimationFrame(() => {
      const posicion = inicio + textoAInsertar.length;
      area.focus();
      area.setSelectionRange(posicion, posicion);
    });
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    setMensajeExito(null);

    const { data, error: errorRespuesta } = await api.plantillas({ tipo: tab }).put({ contenido: enEdicion[tab] });
    setGuardando(false);

    if (errorRespuesta || !data) {
      const valor = errorRespuesta?.value as { error?: { mensaje?: string }; marcadoresInvalidos?: MarcadorInvalido[] } | undefined;
      setError(valor?.error?.mensaje ?? "No se pudo guardar la plantilla.");
      if (valor?.marcadoresInvalidos) setMarcadoresInvalidos(valor.marcadoresInvalidos);
      return;
    }

    setGuardado((prev) => ({ ...prev, [tab]: data.plantilla }));
    setMensajeExito("Plantilla guardada. Los mensajes de ventas ya registradas no cambian.");
  }

  async function restaurar() {
    setRestaurando(true);
    setError(null);
    setMensajeExito(null);

    const { data, error: errorRespuesta } = await api.plantillas({ tipo: tab }).restaurar.post();
    setRestaurando(false);

    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    setGuardado((prev) => ({ ...prev, [tab]: data.plantilla }));
    setEnEdicion((prev) => ({ ...prev, [tab]: data.plantilla.contenido }));
    setMensajeExito("Plantilla restaurada a su versión por defecto.");
  }

  function cambiarContenido(valor: string) {
    setEnEdicion((prev) => ({ ...prev, [tab]: valor }));
    setMensajeExito(null);
  }

  function cambiarTab(nuevoTab: Tipo) {
    setTab(nuevoTab);
    setError(null);
    setMensajeExito(null);
    setMarcadoresInvalidos([]);
  }

  const sinGuardar = enEdicion[tab] !== (guardado[tab]?.contenido ?? "");
  const invalidosDeDesconocido = marcadoresInvalidos.filter((m) => m.razon === "desconocido");
  const invalidosDeNoAplica = marcadoresInvalidos.filter((m) => m.razon === "no_aplica");

  if (cargando) {
    return (
      <div className="space-y-6">
        <CargandoTarjeta />
        <CargandoTarjeta />
      </div>
    );
  }

  if (errorCarga) {
    return <Aviso variante="critico">{errorCarga}</Aviso>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina text-ink">Plantillas de mensaje</h1>
        <p className="cuerpo text-ink-muted">
          El texto que recibe el comprador por WhatsApp. Editar aquí solo afecta a las ventas que se registren a
          partir de ahora — el mensaje de una venta ya hecha queda congelado para siempre.
        </p>
      </div>

      <div className="flex gap-1.5">
        {TABS.map((opcion) => (
          <button
            key={opcion.valor}
            type="button"
            onClick={() => cambiarTab(opcion.valor)}
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

      {error ? <Aviso variante="critico">{error}</Aviso> : null}
      {mensajeExito ? <Aviso variante="info">{mensajeExito}</Aviso> : null}
      {invalidosDeDesconocido.length > 0 ? (
        <Aviso variante="critico" titulo="Marcadores que no existen">
          {invalidosDeDesconocido.map((m) => `{{${m.marcador}}}`).join(", ")} — revisa si hay un error de escritura.
        </Aviso>
      ) : null}
      {invalidosDeNoAplica.length > 0 ? (
        <Aviso variante="aviso" titulo="Marcadores que no aplican a esta pestaña">
          {invalidosDeNoAplica.map((m) => `{{${m.marcador}}}`).join(", ")} se van a mostrar tal cual, sin
          reemplazar — son de la otra pestaña.
        </Aviso>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Tarjeta>
            <TarjetaCabecera
              titulo="Editor"
              accion={sinGuardar ? <Pastilla tono="secundario">Sin guardar</Pastilla> : null}
            />
            <AreaCampo
              ref={areaRef}
              value={enEdicion[tab]}
              onChange={(e) => cambiarContenido(e.target.value)}
              className="h-80 font-mono text-sm leading-relaxed"
              spellCheck={false}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <Boton variante="principal" tamano="sm" onClick={guardar} disabled={guardando || !sinGuardar}>
                <Save />
                {guardando ? "Guardando…" : "Guardar"}
              </Boton>
              <Boton variante="contorno" tamano="sm" onClick={restaurar} disabled={restaurando}>
                <RotateCcw />
                {restaurando ? "Restaurando…" : "Restaurar plantilla por defecto"}
              </Boton>
            </div>
          </Tarjeta>

          <Tarjeta>
            <TarjetaCabecera titulo="Marcadores disponibles" />
            <p className="cuerpo mb-3 text-ink-muted">
              Haz clic para insertar en la posición del cursor del editor.
            </p>
            <div className="flex flex-wrap gap-2">
              {marcadoresPorTipo[tab].map((marcador) => (
                <button
                  key={marcador}
                  type="button"
                  onClick={() => insertarMarcador(marcador)}
                  className="rounded-control border border-borde bg-plano px-2 py-1 font-mono text-xs text-ink transition-colors hover:border-secundario hover:bg-secundario-suave"
                >
                  {`{{${marcador}}}`}
                </button>
              ))}
            </div>
          </Tarjeta>
        </div>

        <div className="space-y-4">
          <Tarjeta>
            <TarjetaCabecera
              titulo="Vista previa"
              accion={cargandoVistaPrevia ? <span className="text-xs text-ink-muted">Actualizando…</span> : null}
            />
            <p className="cuerpo mb-3 text-ink-muted">Con datos de ejemplo, no con datos reales.</p>
            <div className="rounded-control border border-borde bg-plano p-4">
              <div className="inline-block max-w-full rounded-lg bg-white p-3 text-sm whitespace-pre-wrap text-black shadow-sm">
                {vistaPrevia || <span className="text-ink-muted">Escribe en el editor para ver la vista previa.</span>}
              </div>
            </div>
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}
