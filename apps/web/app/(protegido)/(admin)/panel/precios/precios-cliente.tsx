"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, XOctagon } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Pastilla } from "@/components/ui/pastilla";
import { CargandoTabla } from "@/components/ui/cargando";

interface Fila {
  id: string;
  nombre: string;
}

interface CeldaUnidad {
  duracionId: string;
  tipoClienteId: string;
  precioVenta: string;
  costo: string;
  perdida: boolean;
}

interface CeldaPaquete extends CeldaUnidad {
  sumaComponentes: string | null;
  componentesFaltantes: string[];
  costoNoCoincide: boolean;
}

interface MatrizUnidades {
  duraciones: Fila[];
  tiposCliente: Fila[];
  celdas: CeldaUnidad[];
  avisoCostoCero: { cantidad: number };
}

interface MatrizPaquetes {
  duraciones: Fila[];
  tiposCliente: Fila[];
  celdas: CeldaPaquete[];
  avisoCostoCero: { cantidad: number };
}

interface ValorCelda {
  precioVenta: string;
  costo: string;
}

interface CambioCelda {
  duracionId: string;
  tipoClienteId: string;
  limpiar?: boolean;
  precioVenta?: string;
  costo?: string;
}

type Tab = "unidades" | "paquetes";

function clave(duracionId: string, tipoClienteId: string): string {
  return `${duracionId}|${tipoClienteId}`;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

// Extraído de guardar() para que el mismo cálculo alimente tanto el envío
// al API como el contador de cambios pendientes que se ve antes de guardar.
function calcularCambios<C extends CeldaUnidad>(
  duraciones: Fila[],
  tiposCliente: Fila[],
  valores: Record<string, ValorCelda>,
  celdaPorClave: Map<string, C>,
): CambioCelda[] {
  const resultado: CambioCelda[] = [];
  for (const duracion of duraciones) {
    for (const tipoCliente of tiposCliente) {
      const k = clave(duracion.id, tipoCliente.id);
      const original = celdaPorClave.get(k);
      const actual = valores[k] ?? { precioVenta: "", costo: "" };
      const actualVacio = actual.precioVenta.trim() === "" && actual.costo.trim() === "";

      if (actualVacio) {
        if (original) resultado.push({ duracionId: duracion.id, tipoClienteId: tipoCliente.id, limpiar: true });
        continue;
      }

      if (!original || original.precioVenta !== actual.precioVenta || original.costo !== actual.costo) {
        resultado.push({
          duracionId: duracion.id,
          tipoClienteId: tipoCliente.id,
          precioVenta: actual.precioVenta,
          costo: actual.costo,
        });
      }
    }
  }
  return resultado;
}

const TABS: { valor: Tab; etiqueta: string }[] = [
  { valor: "unidades", etiqueta: "Unidades" },
  { valor: "paquetes", etiqueta: "Paquetes" },
];

export default function PreciosCliente() {
  const [tab, setTab] = useState<Tab>("unidades");

  const [plataformas, setPlataformas] = useState<{ id: string; nombre: string; activa: boolean }[]>([]);
  const [plataformaId, setPlataformaId] = useState("");
  const [paquetes, setPaquetes] = useState<{ id: string; nombre: string; activo: boolean }[]>([]);
  const [paqueteId, setPaqueteId] = useState("");

  useEffect(() => {
    api.plataformas.get().then(({ data }) => {
      if (!data) return;
      const activas = data.plataformas.filter((p) => p.activa);
      setPlataformas(activas);
      if (activas.length > 0) setPlataformaId(activas[0]!.id);
    });
    api.paquetes.get().then(({ data }) => {
      if (!data) return;
      const activos = data.paquetes.filter((p) => p.activo);
      setPaquetes(activos);
      if (activos.length > 0) setPaqueteId(activos[0]!.id);
    });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina text-ink">Precios</h1>
        <p className="cuerpo text-ink-muted">
          Vaciar una celda la retira de la venta sin borrar su histórico; volver a llenarla la reactiva.
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

      {tab === "unidades" ? (
        <TabUnidades plataformas={plataformas} plataformaId={plataformaId} onCambiarPlataforma={setPlataformaId} />
      ) : (
        <TabPaquetes paquetes={paquetes} paqueteId={paqueteId} onCambiarPaquete={setPaqueteId} />
      )}
    </div>
  );
}

// Matriz duraciones×tiposCliente compartida por ambas pestañas — cabeceras
// y primera columna fijas (DISENO.md §4.4) para que no se pierda el
// contexto al desplazarse por un catálogo largo. `renderExtra` agrega los
// avisos propios de paquetes (componentes faltantes, costo que no coincide)
// sin duplicar el resto del marcado.
function MatrizPrecios<C extends CeldaUnidad>({
  duraciones,
  tiposCliente,
  valores,
  celdaPorClave,
  clavesModificadas,
  erroresCelda,
  onCambiarValor,
  renderExtra,
}: {
  duraciones: Fila[];
  tiposCliente: Fila[];
  valores: Record<string, ValorCelda>;
  celdaPorClave: Map<string, C>;
  clavesModificadas: Set<string>;
  erroresCelda: Record<string, string>;
  onCambiarValor: (duracionId: string, tipoClienteId: string, campo: keyof ValorCelda, valor: string) => void;
  renderExtra?: (celda: C | undefined) => React.ReactNode;
}) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-control border border-borde">
      <table className="w-full cuerpo text-ink">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 border-b border-borde bg-superficie px-3 py-2 text-left etiqueta-dato">
              Duración
            </th>
            {tiposCliente.map((tc) => (
              <th
                key={tc.id}
                className="sticky top-0 z-10 min-w-44 border-b border-borde bg-superficie px-3 py-2 text-left etiqueta-dato"
              >
                {tc.nombre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {duraciones.map((duracion) => (
            <tr key={duracion.id} className="border-b border-borde last:border-0">
              <td className="sticky left-0 z-10 bg-superficie px-3 py-2 align-top font-medium">{duracion.nombre}</td>
              {tiposCliente.map((tipoCliente) => {
                const k = clave(duracion.id, tipoCliente.id);
                const valor = valores[k] ?? { precioVenta: "", costo: "" };
                const celdaOriginal = celdaPorClave.get(k);
                const errorCelda = erroresCelda[k];
                const modificada = clavesModificadas.has(k);
                return (
                  <td
                    key={tipoCliente.id}
                    className={cn("px-3 py-2 align-top", modificada && "bg-secundario-suave")}
                  >
                    <div className="space-y-1.5">
                      <EntradaCampo
                        placeholder="Precio"
                        value={valor.precioVenta}
                        onChange={(e) => onCambiarValor(duracion.id, tipoCliente.id, "precioVenta", e.target.value)}
                        className="h-9 w-28 text-xs"
                      />
                      <EntradaCampo
                        placeholder="Costo"
                        value={valor.costo}
                        onChange={(e) => onCambiarValor(duracion.id, tipoCliente.id, "costo", e.target.value)}
                        className="h-9 w-28 text-xs"
                      />
                      {celdaOriginal?.perdida ? (
                        <Pastilla tono="critico" icono={XOctagon} className="h-auto w-fit whitespace-normal py-1">
                          Estás vendiendo a pérdida
                        </Pastilla>
                      ) : null}
                      {renderExtra ? renderExtra(celdaOriginal) : null}
                      {errorCelda ? (
                        <Pastilla tono="critico" icono={XOctagon} className="h-auto w-fit whitespace-normal py-1">
                          {errorCelda}
                        </Pastilla>
                      ) : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EtiquetaCambios({ cantidad }: { cantidad: number }) {
  if (cantidad === 0) return null;
  return (
    <Pastilla tono="secundario">
      {cantidad} cambio{cantidad === 1 ? "" : "s"} sin guardar
    </Pastilla>
  );
}

function TabUnidades({
  plataformas,
  plataformaId,
  onCambiarPlataforma,
}: {
  plataformas: { id: string; nombre: string }[];
  plataformaId: string;
  onCambiarPlataforma: (id: string) => void;
}) {
  const [matriz, setMatriz] = useState<MatrizUnidades | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [valores, setValores] = useState<Record<string, ValorCelda>>({});
  const [erroresCelda, setErroresCelda] = useState<Record<string, string>>({});

  async function cargar() {
    if (!plataformaId) return;
    setCargando(true);
    setError(null);
    setMensaje(null);
    const { data, error: errorRespuesta } = await api.precios.unidades.get({ query: { plataformaId } });
    setCargando(false);
    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      setMatriz(null);
      return;
    }
    setMatriz(data);
    const iniciales: Record<string, ValorCelda> = {};
    for (const celda of data.celdas) {
      iniciales[clave(celda.duracionId, celda.tipoClienteId)] = { precioVenta: celda.precioVenta, costo: celda.costo };
    }
    setValores(iniciales);
    setErroresCelda({});
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plataformaId]);

  const celdaPorClave = useMemo(() => {
    const mapa = new Map<string, CeldaUnidad>();
    for (const celda of matriz?.celdas ?? []) mapa.set(clave(celda.duracionId, celda.tipoClienteId), celda);
    return mapa;
  }, [matriz]);

  const cambios = useMemo(
    () => calcularCambios(matriz?.duraciones ?? [], matriz?.tiposCliente ?? [], valores, celdaPorClave),
    [matriz, valores, celdaPorClave],
  );
  const clavesModificadas = useMemo(
    () => new Set(cambios.map((c) => clave(c.duracionId, c.tipoClienteId))),
    [cambios],
  );

  function actualizarValor(duracionId: string, tipoClienteId: string, campo: keyof ValorCelda, valor: string) {
    setValores((anterior) => ({
      ...anterior,
      [clave(duracionId, tipoClienteId)]: { ...(anterior[clave(duracionId, tipoClienteId)] ?? { precioVenta: "", costo: "" }), [campo]: valor },
    }));
  }

  async function guardar() {
    if (!matriz) return;
    setGuardando(true);
    setError(null);
    setMensaje(null);
    setErroresCelda({});

    if (cambios.length === 0) {
      setGuardando(false);
      setMensaje("No hay cambios para guardar.");
      return;
    }

    const { data, error: errorRespuesta } = await api.precios.unidades.put({ plataformaId, celdas: cambios });
    setGuardando(false);

    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    const errores: Record<string, string> = {};
    let huboError = false;
    for (const resultado of data.resultados) {
      if (!resultado.ok && resultado.error) {
        errores[clave(resultado.duracionId, resultado.tipoClienteId)] = resultado.error;
        huboError = true;
      }
    }
    setErroresCelda(errores);
    setMensaje(huboError ? "Se guardaron los cambios válidos; revisa las celdas marcadas en rojo." : "Cambios guardados.");
    await cargar();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Campo etiqueta="Plataforma" className="max-w-xs">
          {(props) => (
            <SelectCampo {...props} value={plataformaId} onChange={(e) => onCambiarPlataforma(e.target.value)}>
              {plataformas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </SelectCampo>
          )}
        </Campo>
        <EtiquetaCambios cantidad={cambios.length} />
      </div>

      {error ? <Aviso variante="critico">{error}</Aviso> : null}
      {mensaje ? <Aviso variante="aviso">{mensaje}</Aviso> : null}
      {matriz && matriz.avisoCostoCero.cantidad > 0 ? (
        <Aviso variante="aviso">
          {matriz.avisoCostoCero.cantidad} precio(s) activo(s) tienen costo en 0. La utilidad mostrada para esas
          ventas no será real hasta que se cargue el costo correcto.
        </Aviso>
      ) : null}

      {cargando || !matriz ? (
        <CargandoTabla filas={6} columnas={5} />
      ) : (
        <>
          <MatrizPrecios
            duraciones={matriz.duraciones}
            tiposCliente={matriz.tiposCliente}
            valores={valores}
            celdaPorClave={celdaPorClave}
            clavesModificadas={clavesModificadas}
            erroresCelda={erroresCelda}
            onCambiarValor={actualizarValor}
          />
          <Boton variante="principal" onClick={guardar} disabled={guardando || cambios.length === 0}>
            {guardando ? "Guardando…" : cambios.length > 0 ? `Guardar ${cambios.length} cambio${cambios.length === 1 ? "" : "s"}` : "Guardar cambios"}
          </Boton>
        </>
      )}
    </div>
  );
}

function TabPaquetes({
  paquetes,
  paqueteId,
  onCambiarPaquete,
}: {
  paquetes: { id: string; nombre: string }[];
  paqueteId: string;
  onCambiarPaquete: (id: string) => void;
}) {
  const [matriz, setMatriz] = useState<MatrizPaquetes | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [valores, setValores] = useState<Record<string, ValorCelda>>({});
  const [erroresCelda, setErroresCelda] = useState<Record<string, string>>({});

  async function cargar() {
    if (!paqueteId) return;
    setCargando(true);
    setError(null);
    setMensaje(null);
    const { data, error: errorRespuesta } = await api.precios.paquetes.get({ query: { paqueteId } });
    setCargando(false);
    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      setMatriz(null);
      return;
    }
    setMatriz(data);
    const iniciales: Record<string, ValorCelda> = {};
    for (const celda of data.celdas) {
      iniciales[clave(celda.duracionId, celda.tipoClienteId)] = { precioVenta: celda.precioVenta, costo: celda.costo };
    }
    setValores(iniciales);
    setErroresCelda({});
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paqueteId]);

  const celdaPorClave = useMemo(() => {
    const mapa = new Map<string, CeldaPaquete>();
    for (const celda of matriz?.celdas ?? []) mapa.set(clave(celda.duracionId, celda.tipoClienteId), celda);
    return mapa;
  }, [matriz]);

  const cambios = useMemo(
    () => calcularCambios(matriz?.duraciones ?? [], matriz?.tiposCliente ?? [], valores, celdaPorClave),
    [matriz, valores, celdaPorClave],
  );
  const clavesModificadas = useMemo(
    () => new Set(cambios.map((c) => clave(c.duracionId, c.tipoClienteId))),
    [cambios],
  );

  function actualizarValor(duracionId: string, tipoClienteId: string, campo: keyof ValorCelda, valor: string) {
    setValores((anterior) => ({
      ...anterior,
      [clave(duracionId, tipoClienteId)]: { ...(anterior[clave(duracionId, tipoClienteId)] ?? { precioVenta: "", costo: "" }), [campo]: valor },
    }));
  }

  async function guardar() {
    if (!matriz) return;
    setGuardando(true);
    setError(null);
    setMensaje(null);
    setErroresCelda({});

    if (cambios.length === 0) {
      setGuardando(false);
      setMensaje("No hay cambios para guardar.");
      return;
    }

    const { data, error: errorRespuesta } = await api.precios.paquetes.put({ paqueteId, celdas: cambios });
    setGuardando(false);

    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    const errores: Record<string, string> = {};
    let huboError = false;
    for (const resultado of data.resultados) {
      if (!resultado.ok && resultado.error) {
        errores[clave(resultado.duracionId, resultado.tipoClienteId)] = resultado.error;
        huboError = true;
      }
    }
    setErroresCelda(errores);
    setMensaje(huboError ? "Se guardaron los cambios válidos; revisa las celdas marcadas en rojo." : "Cambios guardados.");
    await cargar();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Campo etiqueta="Paquete" className="max-w-xs">
          {(props) => (
            <SelectCampo {...props} value={paqueteId} onChange={(e) => onCambiarPaquete(e.target.value)}>
              {paquetes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </SelectCampo>
          )}
        </Campo>
        <EtiquetaCambios cantidad={cambios.length} />
      </div>

      {error ? <Aviso variante="critico">{error}</Aviso> : null}
      {mensaje ? <Aviso variante="aviso">{mensaje}</Aviso> : null}
      {matriz && matriz.avisoCostoCero.cantidad > 0 ? (
        <Aviso variante="aviso">
          {matriz.avisoCostoCero.cantidad} precio(s) activo(s) tienen costo en 0. La utilidad mostrada para esas
          ventas no será real hasta que se cargue el costo correcto.
        </Aviso>
      ) : null}

      {cargando || !matriz ? (
        <CargandoTabla filas={6} columnas={5} />
      ) : (
        <>
          <MatrizPrecios
            duraciones={matriz.duraciones}
            tiposCliente={matriz.tiposCliente}
            valores={valores}
            celdaPorClave={celdaPorClave}
            clavesModificadas={clavesModificadas}
            erroresCelda={erroresCelda}
            onCambiarValor={actualizarValor}
            renderExtra={(celda) => (
              <>
                {celda?.componentesFaltantes && celda.componentesFaltantes.length > 0 ? (
                  <Pastilla tono="aviso" icono={AlertTriangle} className="h-auto w-fit whitespace-normal py-1">
                    No calculable: falta {celda.componentesFaltantes.join(", ")}
                  </Pastilla>
                ) : celda?.costoNoCoincide ? (
                  <Pastilla tono="aviso" icono={AlertTriangle} className="h-auto w-fit whitespace-normal py-1">
                    El costo digitado no coincide con la suma de sus componentes
                    {celda.sumaComponentes ? ` (suma: ${celda.sumaComponentes})` : ""}.
                  </Pastilla>
                ) : null}
              </>
            )}
          />
          <Boton variante="principal" onClick={guardar} disabled={guardando || cambios.length === 0}>
            {guardando ? "Guardando…" : cambios.length > 0 ? `Guardar ${cambios.length} cambio${cambios.length === 1 ? "" : "s"}` : "Guardar cambios"}
          </Boton>
        </>
      )}
    </div>
  );
}
