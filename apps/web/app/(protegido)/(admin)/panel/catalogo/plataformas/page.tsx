"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Plus, Pencil, Ban, CheckCircle2, Tv, Building2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { esSinEmpresaActiva } from "@/lib/error-api";
import { useSelectorEmpresa } from "@/components/navegacion/selector-empresa-contexto";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo, AreaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { PastillaEstado } from "@/components/ui/pastilla";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Dialogo } from "@/components/ui/dialogo";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { CargandoTabla } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

interface Plataforma {
  id: string;
  nombre: string;
  nombreMensaje: string | null;
  condiciones: string | null;
  capacidadPantallas: number;
  usaPerfilPin: boolean;
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

const FORMULARIO_VACIO = {
  nombre: "",
  nombreMensaje: "",
  condiciones: "",
  capacidadPantallas: "1",
  usaPerfilPin: false,
};

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas" },
  { valor: "activas", etiqueta: "Activas" },
  { valor: "inactivas", etiqueta: "Inactivas" },
];

export default function PaginaPlataformas() {
  const { abrir: abrirSelectorEmpresa } = useSelectorEmpresa();
  const [plataformas, setPlataformas] = useState<Plataforma[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [sinEmpresa, setSinEmpresa] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todas");

  const [panelAbierto, setPanelAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorFila, setErrorFila] = useState<string | null>(null);

  const [confirmando, setConfirmando] = useState<{ plataforma: Plataforma; impacto: Impacto | null } | null>(null);
  const [desactivando, setDesactivando] = useState(false);

  async function cargarPlataformas() {
    setCargandoLista(true);
    setErrorLista(null);
    const { data, error: errorRespuesta } = await api.plataformas.get();
    setCargandoLista(false);
    if (errorRespuesta || !data) {
      setErrorLista(mensajeDeError(errorRespuesta));
      return;
    }
    setPlataformas(data.plataformas);
  }

  useEffect(() => {
    cargarPlataformas();
  }, []);

  function abrirCrear() {
    setEditandoId(null);
    setFormulario(FORMULARIO_VACIO);
    setError(null);
    setPanelAbierto(true);
  }

  function abrirEditar(plataforma: Plataforma) {
    setEditandoId(plataforma.id);
    setFormulario({
      nombre: plataforma.nombre,
      nombreMensaje: plataforma.nombreMensaje ?? "",
      condiciones: plataforma.condiciones ?? "",
      capacidadPantallas: String(plataforma.capacidadPantallas),
      usaPerfilPin: plataforma.usaPerfilPin,
    });
    setError(null);
    setPanelAbierto(true);
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);

    const cuerpo = {
      nombre: formulario.nombre,
      ...(formulario.nombreMensaje ? { nombreMensaje: formulario.nombreMensaje } : {}),
      ...(formulario.condiciones ? { condiciones: formulario.condiciones } : {}),
      capacidadPantallas: Number(formulario.capacidadPantallas),
      usaPerfilPin: formulario.usaPerfilPin,
    };

    const { data, error: errorRespuesta } = editandoId
      ? await api.plataformas({ id: editandoId }).patch(cuerpo)
      : await api.plataformas.post(cuerpo);

    setGuardando(false);

    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    setPanelAbierto(false);
    cargarPlataformas();
  }

  async function activar(id: string) {
    setErrorFila(null);
    const { error: errorRespuesta } = await api.plataformas({ id }).activar.patch();
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      return;
    }
    cargarPlataformas();
  }

  async function pedirConfirmacionDesactivar(plataforma: Plataforma) {
    setErrorFila(null);
    const { data: impacto } = await api.plataformas({ id: plataforma.id })["impacto-desactivacion"].get();
    setConfirmando({ plataforma, impacto: impacto ?? null });
  }

  async function confirmarDesactivar() {
    if (!confirmando) return;
    setDesactivando(true);
    const { error: errorRespuesta } = await api.plataformas({ id: confirmando.plataforma.id }).desactivar.patch();
    setDesactivando(false);
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      setConfirmando(null);
      return;
    }
    setConfirmando(null);
    cargarPlataformas();
  }

  const plataformasFiltradas = plataformas.filter((p) => {
    if (filtro === "activas") return p.activa;
    if (filtro === "inactivas") return !p.activa;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Plataformas</h1>
          <p className="cuerpo text-ink-muted">
            Catálogo de plataformas de tu empresa. Nada se borra: desactivar una plataforma la retira de la venta sin
            afectar el histórico.
          </p>
        </div>
        <Boton variante="principal" onClick={abrirCrear}>
          <Plus />
          Nueva plataforma
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
        <Aviso variante="critico" titulo="No se pudo cargar el catálogo" accion={<Boton variante="contorno" onClick={cargarPlataformas}>Reintentar</Boton>}>
          {errorLista}
        </Aviso>
      ) : cargandoLista ? (
        <CargandoTabla filas={5} columnas={5} />
      ) : plataformasFiltradas.length === 0 ? (
        <EstadoVacio
          icono={Tv}
          titulo={plataformas.length === 0 ? "No hay plataformas" : "Ninguna plataforma coincide con el filtro"}
          descripcion={plataformas.length === 0 ? "Crea la primera plataforma de tu catálogo." : undefined}
          accion={
            plataformas.length === 0 ? (
              <Boton variante="principal" onClick={abrirCrear}>
                <Plus />
                Nueva plataforma
              </Boton>
            ) : undefined
          }
        />
      ) : (
        <Tabla>
          <TablaCabecera>
            <tr>
              <TablaCeldaCabecera>Nombre</TablaCeldaCabecera>
              <TablaCeldaCabecera className="text-right">Capacidad</TablaCeldaCabecera>
              <TablaCeldaCabecera>Perfil/PIN</TablaCeldaCabecera>
              <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
              <TablaCeldaCabecera></TablaCeldaCabecera>
            </tr>
          </TablaCabecera>
          <TablaCuerpo>
            {plataformasFiltradas.map((plataforma) => (
              <TablaFila key={plataforma.id}>
                <TablaCelda className="font-medium text-ink">{plataforma.nombre}</TablaCelda>
                <TablaCelda className="text-right tabular-nums">{plataforma.capacidadPantallas}</TablaCelda>
                <TablaCelda>{plataforma.usaPerfilPin ? "Sí" : "No"}</TablaCelda>
                <TablaCelda>
                  <PastillaEstado estado={plataforma.activa ? "activo" : "inactivo"} />
                </TablaCelda>
                <TablaCelda>
                  <div className="flex justify-end gap-2">
                    <Boton variante="contorno" tamano="sm" onClick={() => abrirEditar(plataforma)}>
                      <Pencil />
                      Editar
                    </Boton>
                    {plataforma.activa ? (
                      <Boton variante="destructivo" tamano="sm" onClick={() => pedirConfirmacionDesactivar(plataforma)}>
                        <Ban />
                        Desactivar
                      </Boton>
                    ) : (
                      <Boton variante="contorno" tamano="sm" onClick={() => activar(plataforma.id)}>
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
        titulo={editandoId ? "Editar plataforma" : "Nueva plataforma"}
      >
        <form onSubmit={guardar} className="space-y-4">
          {error ? <Aviso variante="critico">{error}</Aviso> : null}

          <Campo etiqueta="Nombre" required>
            {(props) => (
              <EntradaCampo
                {...props}
                required
                value={formulario.nombre}
                onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })}
              />
            )}
          </Campo>

          <Campo etiqueta="Nombre decorado para el mensaje" ayuda='Ej. "N.E.T.F.L.I.X" — si se deja vacío, se usa el nombre normal.'>
            {(props) => (
              <EntradaCampo
                {...props}
                value={formulario.nombreMensaje}
                onChange={(e) => setFormulario({ ...formulario, nombreMensaje: e.target.value })}
              />
            )}
          </Campo>

          <Campo etiqueta="Condiciones" ayuda="Se muestra al vendedor antes de vender esta plataforma.">
            {(props) => (
              <AreaCampo
                {...props}
                rows={2}
                placeholder='Ej. "1 pantalla, solo TV. Incluye ESPN y Hulu."'
                value={formulario.condiciones}
                onChange={(e) => setFormulario({ ...formulario, condiciones: e.target.value })}
              />
            )}
          </Campo>

          <Campo
            etiqueta="Capacidad de pantallas por defecto"
            required
            ayuda="Solo se usa como valor propuesto al crear una cuenta nueva de esta plataforma. No modifica las cuentas existentes."
          >
            {(props) => (
              <EntradaCampo
                {...props}
                type="number"
                min={1}
                step={1}
                required
                value={formulario.capacidadPantallas}
                onChange={(e) => setFormulario({ ...formulario, capacidadPantallas: e.target.value })}
              />
            )}
          </Campo>

          <label className="flex items-center gap-2 cuerpo text-ink">
            <input
              type="checkbox"
              checked={formulario.usaPerfilPin}
              onChange={(e) => setFormulario({ ...formulario, usaPerfilPin: e.target.checked })}
              className="size-4 rounded accent-primario"
            />
            Usa perfil y PIN
          </label>

          <div className="flex gap-2 pt-2">
            <Boton type="submit" variante="principal" disabled={guardando} className="flex-1">
              {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear plataforma"}
            </Boton>
          </div>
        </form>
      </PanelLateral>

      <Dialogo
        abierto={confirmando !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmando(null)}
        titulo={`Desactivar "${confirmando?.plataforma.nombre}"`}
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
