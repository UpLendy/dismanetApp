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

// El costo ya no vive en la celda (punto 6, camino del dinero): para
// unidades vive una vez por duración (ver CostoDuracion); para paquetes se
// calcula a partir de sus componentes (ver DetalleComponente/CeldaPaquete).
interface CeldaUnidad {
  duracionId: string;
  tipoClienteId: string;
  precioVenta: string;
  perdida: boolean;
}

interface CostoDuracion {
  duracionId: string;
  costo: string;
}

interface DetalleComponente {
  plataformaId: string;
  nombrePlataforma: string;
  cantidadPantallas: number;
  costoUnitario: string | null;
  subtotal: string | null;
}

interface CeldaPaquete extends CeldaUnidad {
  costoCalculado: string | null;
  detalle: DetalleComponente[];
}

interface MatrizUnidades {
  duraciones: Fila[];
  tiposCliente: Fila[];
  celdas: CeldaUnidad[];
  costos: CostoDuracion[];
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
}

interface CambioCelda {
  duracionId: string;
  tipoClienteId: string;
  limpiar?: boolean;
  precioVenta?: string;
}

type Tab = "unidades" | "paquetes";

function clave(duracionId: string, tipoClienteId: string): string {
  return `${duracionId}|${tipoClienteId}`;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

function formatearPesos(valor: string): string {
  const [entero, decimal] = valor.split(".");
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal ? `$${conPuntos},${decimal}` : `$${conPuntos}`;
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
      const actual = valores[k] ?? { precioVenta: "" };
      const actualVacio = actual.precioVenta.trim() === "";

      if (actualVacio) {
        if (original) resultado.push({ duracionId: duracion.id, tipoClienteId: tipoCliente.id, limpiar: true });
        continue;
      }

      if (!original || original.precioVenta !== actual.precioVenta) {
        resultado.push({
          duracionId: duracion.id,
          tipoClienteId: tipoCliente.id,
          precioVenta: actual.precioVenta,
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
          Vaciar una celda retira el precio de la venta sin borrar su histórico; volver a llenarla la reactiva.
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

// Tabla compartida entre ambas pestañas — cabeceras y primera columna fijas
// (DISENO.md §4.4) para que no se pierda el contexto al desplazarse por un
// catálogo largo. `columnaExtra` agrega una columna por renglón de duración
// (costo editable en unidades, costo calculado en paquetes): el costo ya no
// varía por tipo de cliente, así que vive fuera de las columnas de precio.
function MatrizPrecios<C extends CeldaUnidad>({
  duraciones,
  tiposCliente,
  valores,
  celdaPorClave,
  clavesModificadas,
  erroresCelda,
  onCambiarValor,
  columnaExtraEtiqueta,
  columnaExtra,
}: {
  duraciones: Fila[];
  tiposCliente: Fila[];
  valores: Record<string, ValorCelda>;
  celdaPorClave: Map<string, C>;
  clavesModificadas: Set<string>;
  erroresCelda: Record<string, string>;
  onCambiarValor: (duracionId: string, tipoClienteId: string, valor: string) => void;
  columnaExtraEtiqueta?: string;
  columnaExtra?: (duracion: Fila) => React.ReactNode;
}) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-control border border-borde">
      <table className="w-full cuerpo text-ink">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 border-b border-borde bg-superficie px-3 py-2 text-left etiqueta-dato">
              Duración
            </th>
            {columnaExtraEtiqueta ? (
              <th className="sticky top-0 z-10 min-w-48 border-b border-borde bg-superficie px-3 py-2 text-left etiqueta-dato">
                {columnaExtraEtiqueta}
              </th>
            ) : null}
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
              {columnaExtra ? <td className="px-3 py-2 align-top">{columnaExtra(duracion)}</td> : null}
              {tiposCliente.map((tipoCliente) => {
                const k = clave(duracion.id, tipoCliente.id);
                const valor = valores[k] ?? { precioVenta: "" };
                const celdaOriginal = celdaPorClave.get(k);
                const errorCelda = erroresCelda[k];
                const modificada = clavesModificadas.has(k);
                return (
                  <td key={tipoCliente.id} className={cn("px-3 py-2 align-top", modificada && "bg-secundario-suave")}>
                    <div className="space-y-1.5">
                      <EntradaCampo
                        placeholder="Precio"
                        value={valor.precioVenta}
                        onChange={(e) => onCambiarValor(duracion.id, tipoCliente.id, e.target.value)}
                        className="h-9 w-28 text-xs"
                      />
                      {celdaOriginal?.perdida ? (
                        <Pastilla tono="critico" icono={XOctagon} className="h-auto w-fit whitespace-normal py-1">
                          Estás vendiendo a pérdida
                        </Pastilla>
                      ) : null}
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

  // El costo se guarda por renglón de duración, independiente de la matriz
  // de precios (punto 6): cada fila tiene su propio campo y su propio botón.
  const [costosValores, setCostosValores] = useState<Record<string, string>>({});
  const [costosGuardando, setCostosGuardando] = useState<Record<string, boolean>>({});
  const [costosErrores, setCostosErrores] = useState<Record<string, string>>({});

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
      iniciales[clave(celda.duracionId, celda.tipoClienteId)] = { precioVenta: celda.precioVenta };
    }
    setValores(iniciales);
    setErroresCelda({});

    const costosIniciales: Record<string, string> = {};
    for (const costo of data.costos) costosIniciales[costo.duracionId] = costo.costo;
    setCostosValores(costosIniciales);
    setCostosErrores({});
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
  const clavesModificadas = useMemo(() => new Set(cambios.map((c) => clave(c.duracionId, c.tipoClienteId))), [cambios]);

  function actualizarValor(duracionId: string, tipoClienteId: string, valor: string) {
    setValores((anterior) => ({ ...anterior, [clave(duracionId, tipoClienteId)]: { precioVenta: valor } }));
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

  function actualizarCosto(duracionId: string, valor: string) {
    setCostosValores((anterior) => ({ ...anterior, [duracionId]: valor }));
  }

  async function guardarCosto(duracionId: string) {
    setCostosGuardando((anterior) => ({ ...anterior, [duracionId]: true }));
    setCostosErrores((anterior) => ({ ...anterior, [duracionId]: "" }));
    const costo = costosValores[duracionId] ?? "0";
    const { error: errorRespuesta } = await api.precios.unidades.costo.put({ plataformaId, duracionId, costo });
    setCostosGuardando((anterior) => ({ ...anterior, [duracionId]: false }));
    if (errorRespuesta) {
      setCostosErrores((anterior) => ({ ...anterior, [duracionId]: mensajeDeError(errorRespuesta) }));
      return;
    }
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

      <p className="cuerpo text-xs text-ink-muted">
        El costo se registra una sola vez por duración y es el mismo para todos los tipos de cliente.
      </p>

      {error ? <Aviso variante="critico">{error}</Aviso> : null}
      {mensaje ? <Aviso variante="aviso">{mensaje}</Aviso> : null}
      {matriz && matriz.avisoCostoCero.cantidad > 0 ? (
        <Aviso variante="aviso">
          {matriz.avisoCostoCero.cantidad} duración(es) en uso no tienen costo registrado para esta plataforma. La
          utilidad mostrada para esas ventas no será real hasta que se cargue el costo.
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
            columnaExtraEtiqueta="Costo"
            columnaExtra={(duracion) => (
              <div className="space-y-1.5">
                <EntradaCampo
                  placeholder="Costo"
                  value={costosValores[duracion.id] ?? ""}
                  onChange={(e) => actualizarCosto(duracion.id, e.target.value)}
                  className="h-9 w-28 text-xs"
                />
                <Boton
                  variante="contorno"
                  tamano="sm"
                  onClick={() => guardarCosto(duracion.id)}
                  disabled={costosGuardando[duracion.id]}
                >
                  {costosGuardando[duracion.id] ? "Guardando…" : "Guardar costo"}
                </Boton>
                {costosErrores[duracion.id] ? (
                  <Pastilla tono="critico" icono={XOctagon} className="h-auto w-fit whitespace-normal py-1">
                    {costosErrores[duracion.id]}
                  </Pastilla>
                ) : null}
              </div>
            )}
          />
          <Boton variante="principal" onClick={guardar} disabled={guardando || cambios.length === 0}>
            {guardando
              ? "Guardando…"
              : cambios.length > 0
                ? `Guardar ${cambios.length} cambio${cambios.length === 1 ? "" : "s"}`
                : "Guardar cambios"}
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
      iniciales[clave(celda.duracionId, celda.tipoClienteId)] = { precioVenta: celda.precioVenta };
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

  // El costo calculado y su desglose no varían por tipoCliente (viene de la
  // composición del paquete, no de la celda): basta tomarlos de la primera
  // celda que aparezca para cada duración.
  const costoPorDuracion = useMemo(() => {
    const mapa = new Map<string, { costoCalculado: string | null; detalle: DetalleComponente[] }>();
    for (const celda of matriz?.celdas ?? []) {
      if (!mapa.has(celda.duracionId)) {
        mapa.set(celda.duracionId, { costoCalculado: celda.costoCalculado, detalle: celda.detalle });
      }
    }
    return mapa;
  }, [matriz]);

  const cambios = useMemo(
    () => calcularCambios(matriz?.duraciones ?? [], matriz?.tiposCliente ?? [], valores, celdaPorClave),
    [matriz, valores, celdaPorClave],
  );
  const clavesModificadas = useMemo(() => new Set(cambios.map((c) => clave(c.duracionId, c.tipoClienteId))), [cambios]);

  function actualizarValor(duracionId: string, tipoClienteId: string, valor: string) {
    setValores((anterior) => ({ ...anterior, [clave(duracionId, tipoClienteId)]: { precioVenta: valor } }));
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

      <p className="cuerpo text-xs text-ink-muted">
        El costo de un paquete se calcula automáticamente a partir del costo de sus componentes; no se edita aquí.
      </p>

      {error ? <Aviso variante="critico">{error}</Aviso> : null}
      {mensaje ? <Aviso variante="aviso">{mensaje}</Aviso> : null}
      {matriz && matriz.avisoCostoCero.cantidad > 0 ? (
        <Aviso variante="aviso">
          {matriz.avisoCostoCero.cantidad} duración(es) de este paquete tienen componentes sin costo completo. La
          utilidad mostrada no será real hasta que se complete el costo de cada componente.
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
            columnaExtraEtiqueta="Costo calculado"
            columnaExtra={(duracion) => {
              const info = costoPorDuracion.get(duracion.id);
              if (!info) return null;
              if (info.costoCalculado === null) {
                const faltantes = info.detalle.filter((d) => d.subtotal === null).map((d) => d.nombrePlataforma);
                return (
                  <Pastilla tono="aviso" icono={AlertTriangle} className="h-auto w-fit whitespace-normal py-1">
                    No calculable: falta costo de {faltantes.join(", ")}
                  </Pastilla>
                );
              }
              return (
                <div className="space-y-1 text-xs">
                  <p className="font-medium text-ink">{formatearPesos(info.costoCalculado)}</p>
                  <ul className="space-y-0.5 text-ink-muted">
                    {info.detalle.map((d) => (
                      <li key={d.plataformaId}>
                        {d.nombrePlataforma} × {d.cantidadPantallas} = {d.subtotal ? formatearPesos(d.subtotal) : "—"}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }}
          />
          <Boton variante="principal" onClick={guardar} disabled={guardando || cambios.length === 0}>
            {guardando
              ? "Guardando…"
              : cambios.length > 0
                ? `Guardar ${cambios.length} cambio${cambios.length === 1 ? "" : "s"}`
                : "Guardar cambios"}
          </Boton>
        </>
      )}
    </div>
  );
}
