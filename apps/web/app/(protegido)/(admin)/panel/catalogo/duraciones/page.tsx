"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { addDays, addMonths, format } from "date-fns";
import { es } from "date-fns/locale";
import { Plus, Pencil, Ban, CheckCircle2, CalendarClock } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { PastillaEstado } from "@/components/ui/pastilla";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Dialogo } from "@/components/ui/dialogo";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { CargandoTabla } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

type Unidad = "DIAS" | "MESES";

interface Duracion {
  id: string;
  nombre: string;
  cantidad: number;
  unidad: Unidad;
  activa: boolean;
}

interface Impacto {
  preciosActivos: number;
  paquetesAfectados: { id: string; nombre: string }[];
}

type Filtro = "todas" | "activas" | "inactivas";

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

// Misma lógica que apps/api/src/lib/duracion.ts (calcularVencimiento):
// MESES usa addMonths de date-fns, que recorta al último día del mes
// destino cuando este es más corto (31 de enero + 1 mes = 28 de febrero).
// No se implementa la suma de meses a mano (ver CLAUDE.md).
function calcularVencimiento(fechaVenta: Date, cantidad: number, unidad: Unidad): Date {
  return unidad === "DIAS" ? addDays(fechaVenta, cantidad) : addMonths(fechaVenta, cantidad);
}

// 31 de enero es el ejemplo que hace visible el recorte de fin de mes antes
// de que sorprenda en producción.
const FECHA_EJEMPLO = new Date(new Date().getFullYear(), 0, 31);

const FORMULARIO_VACIO = { nombre: "", cantidad: "30", unidad: "DIAS" as Unidad };

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas" },
  { valor: "activas", etiqueta: "Activas" },
  { valor: "inactivas", etiqueta: "Inactivas" },
];

export default function PaginaDuraciones() {
  const [duraciones, setDuraciones] = useState<Duracion[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");

  const [panelAbierto, setPanelAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorFila, setErrorFila] = useState<string | null>(null);

  const [confirmando, setConfirmando] = useState<{ duracion: Duracion; impacto: Impacto | null } | null>(null);
  const [desactivando, setDesactivando] = useState(false);

  async function cargarDuraciones() {
    setCargandoLista(true);
    setErrorLista(null);
    const { data, error: errorRespuesta } = await api.duraciones.get();
    setCargandoLista(false);
    if (errorRespuesta || !data) {
      setErrorLista(mensajeDeError(errorRespuesta));
      return;
    }
    setDuraciones(data.duraciones);
  }

  useEffect(() => {
    cargarDuraciones();
  }, []);

  function abrirCrear() {
    setEditandoId(null);
    setFormulario(FORMULARIO_VACIO);
    setError(null);
    setPanelAbierto(true);
  }

  function abrirEditar(duracion: Duracion) {
    setEditandoId(duracion.id);
    setFormulario({ nombre: duracion.nombre, cantidad: String(duracion.cantidad), unidad: duracion.unidad });
    setError(null);
    setPanelAbierto(true);
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);

    const cuerpo = { nombre: formulario.nombre, cantidad: Number(formulario.cantidad), unidad: formulario.unidad };

    const { data, error: errorRespuesta } = editandoId
      ? await api.duraciones({ id: editandoId }).patch(cuerpo)
      : await api.duraciones.post(cuerpo);

    setGuardando(false);

    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    setPanelAbierto(false);
    cargarDuraciones();
  }

  async function activar(id: string) {
    setErrorFila(null);
    const { error: errorRespuesta } = await api.duraciones({ id }).activar.patch();
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      return;
    }
    cargarDuraciones();
  }

  async function pedirConfirmacionDesactivar(duracion: Duracion) {
    setErrorFila(null);
    const { data: impacto } = await api.duraciones({ id: duracion.id })["impacto-desactivacion"].get();
    setConfirmando({ duracion, impacto: impacto ?? null });
  }

  async function confirmarDesactivar() {
    if (!confirmando) return;
    setDesactivando(true);
    const { error: errorRespuesta } = await api.duraciones({ id: confirmando.duracion.id }).desactivar.patch();
    setDesactivando(false);
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      setConfirmando(null);
      return;
    }
    setConfirmando(null);
    cargarDuraciones();
  }

  const duracionesFiltradas = duraciones.filter((d) => {
    if (filtro === "activas") return d.activa;
    if (filtro === "inactivas") return !d.activa;
    return true;
  });

  const cantidadPreview = Number(formulario.cantidad);
  const previewValido = Number.isFinite(cantidadPreview) && cantidadPreview > 0;
  const vencimientoPreview = useMemo(() => {
    if (!previewValido) return null;
    return calcularVencimiento(FECHA_EJEMPLO, cantidadPreview, formulario.unidad);
  }, [previewValido, cantidadPreview, formulario.unidad]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Duraciones</h1>
          <p className="cuerpo text-ink-muted">
            Catálogo de duraciones de tu empresa. Nada se borra: desactivar una duración la retira de la venta sin
            afectar el histórico.
          </p>
        </div>
        <Boton variante="principal" onClick={abrirCrear}>
          <Plus />
          Nueva duración
        </Boton>
      </div>

      <div className="flex gap-1.5">
        {FILTROS.map((opcion) => (
          <button
            key={opcion.valor}
            type="button"
            onClick={() => setFiltro(opcion.valor)}
            className={cn(
              "rounded-control border px-3 py-1.5 text-xs font-medium transition-colors",
              filtro === opcion.valor
                ? "border-primario-suave bg-primario-suave text-primario-texto"
                : "border-borde text-ink-2 hover:bg-black/4 dark:hover:bg-white/5",
            )}
          >
            {opcion.etiqueta}
          </button>
        ))}
      </div>

      {errorFila ? <Aviso variante="critico">{errorFila}</Aviso> : null}

      {errorLista ? (
        <Aviso variante="critico" titulo="No se pudo cargar el catálogo" accion={<Boton variante="contorno" onClick={cargarDuraciones}>Reintentar</Boton>}>
          {errorLista}
        </Aviso>
      ) : cargandoLista ? (
        <CargandoTabla filas={5} columnas={5} />
      ) : duracionesFiltradas.length === 0 ? (
        <EstadoVacio
          icono={CalendarClock}
          titulo={duraciones.length === 0 ? "No hay duraciones" : "Ninguna duración coincide con el filtro"}
          descripcion={duraciones.length === 0 ? "Crea la primera duración de tu catálogo." : undefined}
          accion={
            duraciones.length === 0 ? (
              <Boton variante="principal" onClick={abrirCrear}>
                <Plus />
                Nueva duración
              </Boton>
            ) : undefined
          }
        />
      ) : (
        <Tabla>
          <TablaCabecera>
            <tr>
              <TablaCeldaCabecera>Nombre</TablaCeldaCabecera>
              <TablaCeldaCabecera className="text-right">Cantidad</TablaCeldaCabecera>
              <TablaCeldaCabecera>Unidad</TablaCeldaCabecera>
              <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
              <TablaCeldaCabecera></TablaCeldaCabecera>
            </tr>
          </TablaCabecera>
          <TablaCuerpo>
            {duracionesFiltradas.map((duracion) => (
              <TablaFila key={duracion.id}>
                <TablaCelda className="font-medium text-ink">{duracion.nombre}</TablaCelda>
                <TablaCelda className="text-right tabular-nums">{duracion.cantidad}</TablaCelda>
                <TablaCelda>{duracion.unidad === "DIAS" ? "Días" : "Meses"}</TablaCelda>
                <TablaCelda>
                  <PastillaEstado estado={duracion.activa ? "activo" : "inactivo"} />
                </TablaCelda>
                <TablaCelda>
                  <div className="flex justify-end gap-2">
                    <Boton variante="contorno" tamano="sm" onClick={() => abrirEditar(duracion)}>
                      <Pencil />
                      Editar
                    </Boton>
                    {duracion.activa ? (
                      <Boton variante="destructivo" tamano="sm" onClick={() => pedirConfirmacionDesactivar(duracion)}>
                        <Ban />
                        Desactivar
                      </Boton>
                    ) : (
                      <Boton variante="contorno" tamano="sm" onClick={() => activar(duracion.id)}>
                        <CheckCircle2 />
                        Activar
                      </Boton>
                    )}
                  </div>
                </TablaCelda>
              </TablaFila>
            ))}
          </TablaCuerpo>
        </Tabla>
      )}

      <PanelLateral
        abierto={panelAbierto}
        onCambiarAbierto={setPanelAbierto}
        titulo={editandoId ? "Editar duración" : "Nueva duración"}
      >
        <form onSubmit={guardar} className="space-y-4">
          {error ? <Aviso variante="critico">{error}</Aviso> : null}

          <Campo etiqueta="Nombre" required>
            {(props) => (
              <EntradaCampo
                {...props}
                required
                placeholder='ej. "30 días" o "3 meses"'
                value={formulario.nombre}
                onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })}
              />
            )}
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Cantidad" required>
              {(props) => (
                <EntradaCampo
                  {...props}
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={formulario.cantidad}
                  onChange={(e) => setFormulario({ ...formulario, cantidad: e.target.value })}
                />
              )}
            </Campo>
            <Campo etiqueta="Unidad" required>
              {(props) => (
                <SelectCampo
                  {...props}
                  value={formulario.unidad}
                  onChange={(e) => setFormulario({ ...formulario, unidad: e.target.value as Unidad })}
                >
                  <option value="DIAS">Días</option>
                  <option value="MESES">Meses</option>
                </SelectCampo>
              )}
            </Campo>
          </div>

          <div className="rounded-control border border-dashed border-borde bg-plano px-3 py-2 text-xs text-ink-muted">
            {vencimientoPreview ? (
              <>
                Una venta del <strong className="text-ink-2">{format(FECHA_EJEMPLO, "d 'de' MMMM", { locale: es })}</strong> vencería el{" "}
                <strong className="text-ink-2">{format(vencimientoPreview, "d 'de' MMMM", { locale: es })}</strong>.
                {formulario.unidad === "MESES" ? (
                  <> Si el mes destino es más corto, la fecha se recorta a su último día (no se suma a mano).</>
                ) : null}
              </>
            ) : (
              "Ingresa una cantidad mayor a 0 para ver el ejemplo de vencimiento."
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Boton type="submit" variante="principal" disabled={guardando} className="flex-1">
              {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear duración"}
            </Boton>
          </div>
        </form>
      </PanelLateral>

      <Dialogo
        abierto={confirmando !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmando(null)}
        titulo={`Desactivar "${confirmando?.duracion.nombre}"`}
        descripcion={
          confirmando?.impacto ? (
            <>
              Quedan {confirmando.impacto.preciosActivos} precio(s) sin poder venderse.
              {confirmando.impacto.paquetesAfectados.length > 0
                ? ` Paquetes afectados: ${confirmando.impacto.paquetesAfectados.map((p) => p.nombre).join(", ")}.`
                : ""}
            </>
          ) : undefined
        }
        textoConfirmar="Desactivar"
        confirmando={desactivando}
        onConfirmar={confirmarDesactivar}
      />
    </div>
  );
}
