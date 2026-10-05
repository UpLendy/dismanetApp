"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Plus, Pencil, Ban, CheckCircle2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { PastillaEstado } from "@/components/ui/pastilla";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Dialogo } from "@/components/ui/dialogo";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { CargandoTabla } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

interface TipoCliente {
  id: string;
  nombre: string;
  activo: boolean;
}

interface Impacto {
  preciosActivos: number;
  paquetesAfectados: { id: string; nombre: string }[];
}

type Filtro = "todos" | "activos" | "inactivos";

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "activos", etiqueta: "Activos" },
  { valor: "inactivos", etiqueta: "Inactivos" },
];

export default function PaginaTiposCliente() {
  const [tiposCliente, setTiposCliente] = useState<TipoCliente[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const [panelAbierto, setPanelAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorFila, setErrorFila] = useState<string | null>(null);

  const [confirmando, setConfirmando] = useState<{ tipoCliente: TipoCliente; impacto: Impacto | null } | null>(null);
  const [desactivando, setDesactivando] = useState(false);

  async function cargarTiposCliente() {
    setCargandoLista(true);
    setErrorLista(null);
    const { data, error: errorRespuesta } = await api["tipos-cliente"].get();
    setCargandoLista(false);
    if (errorRespuesta || !data) {
      setErrorLista(mensajeDeError(errorRespuesta));
      return;
    }
    setTiposCliente(data.tiposCliente);
  }

  useEffect(() => {
    cargarTiposCliente();
  }, []);

  function abrirCrear() {
    setEditandoId(null);
    setNombre("");
    setError(null);
    setPanelAbierto(true);
  }

  function abrirEditar(tipoCliente: TipoCliente) {
    setEditandoId(tipoCliente.id);
    setNombre(tipoCliente.nombre);
    setError(null);
    setPanelAbierto(true);
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);

    const { data, error: errorRespuesta } = editandoId
      ? await api["tipos-cliente"]({ id: editandoId }).patch({ nombre })
      : await api["tipos-cliente"].post({ nombre });

    setGuardando(false);

    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    setPanelAbierto(false);
    cargarTiposCliente();
  }

  async function activar(id: string) {
    setErrorFila(null);
    const { error: errorRespuesta } = await api["tipos-cliente"]({ id }).activar.patch();
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      return;
    }
    cargarTiposCliente();
  }

  async function pedirConfirmacionDesactivar(tipoCliente: TipoCliente) {
    setErrorFila(null);
    const { data: impacto } = await api["tipos-cliente"]({ id: tipoCliente.id })["impacto-desactivacion"].get();
    setConfirmando({ tipoCliente, impacto: impacto ?? null });
  }

  async function confirmarDesactivar() {
    if (!confirmando) return;
    setDesactivando(true);
    const { error: errorRespuesta } = await api["tipos-cliente"]({ id: confirmando.tipoCliente.id }).desactivar.patch();
    setDesactivando(false);
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      setConfirmando(null);
      return;
    }
    setConfirmando(null);
    cargarTiposCliente();
  }

  const tiposClienteFiltrados = tiposCliente.filter((t) => {
    if (filtro === "activos") return t.activo;
    if (filtro === "inactivos") return !t.activo;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Tipos de cliente</h1>
          <p className="cuerpo text-ink-muted">
            Catálogo de tipos de cliente de tu empresa. Nada se borra: desactivar un tipo de cliente lo retira de la
            venta sin afectar el histórico.
          </p>
        </div>
        <Boton variante="principal" onClick={abrirCrear}>
          <Plus />
          Nuevo tipo de cliente
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
        <Aviso variante="critico" titulo="No se pudo cargar el catálogo" accion={<Boton variante="contorno" onClick={cargarTiposCliente}>Reintentar</Boton>}>
          {errorLista}
        </Aviso>
      ) : cargandoLista ? (
        <CargandoTabla filas={5} columnas={3} />
      ) : tiposClienteFiltrados.length === 0 ? (
        <EstadoVacio
          icono={Users}
          titulo={tiposCliente.length === 0 ? "No hay tipos de cliente" : "Ningún tipo de cliente coincide con el filtro"}
          descripcion={tiposCliente.length === 0 ? "Crea el primer tipo de cliente de tu catálogo." : undefined}
          accion={
            tiposCliente.length === 0 ? (
              <Boton variante="principal" onClick={abrirCrear}>
                <Plus />
                Nuevo tipo de cliente
              </Boton>
            ) : undefined
          }
        />
      ) : (
        <Tabla>
          <TablaCabecera>
            <tr>
              <TablaCeldaCabecera>Nombre</TablaCeldaCabecera>
              <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
              <TablaCeldaCabecera></TablaCeldaCabecera>
            </tr>
          </TablaCabecera>
          <TablaCuerpo>
            {tiposClienteFiltrados.map((tipoCliente) => (
              <TablaFila key={tipoCliente.id}>
                <TablaCelda className="font-medium text-ink">{tipoCliente.nombre}</TablaCelda>
                <TablaCelda>
                  <PastillaEstado estado={tipoCliente.activo ? "activo" : "inactivo"} />
                </TablaCelda>
                <TablaCelda>
                  <div className="flex justify-end gap-2">
                    <Boton variante="contorno" tamano="sm" onClick={() => abrirEditar(tipoCliente)}>
                      <Pencil />
                      Editar
                    </Boton>
                    {tipoCliente.activo ? (
                      <Boton variante="destructivo" tamano="sm" onClick={() => pedirConfirmacionDesactivar(tipoCliente)}>
                        <Ban />
                        Desactivar
                      </Boton>
                    ) : (
                      <Boton variante="contorno" tamano="sm" onClick={() => activar(tipoCliente.id)}>
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
        titulo={editandoId ? "Editar tipo de cliente" : "Nuevo tipo de cliente"}
      >
        <form onSubmit={guardar} className="space-y-4">
          {error ? <Aviso variante="critico">{error}</Aviso> : null}

          <Campo etiqueta="Nombre" required>
            {(props) => (
              <EntradaCampo
                {...props}
                required
                placeholder='ej. "Nuevo" o "Recurrente"'
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            )}
          </Campo>

          <div className="flex gap-2 pt-2">
            <Boton type="submit" variante="principal" disabled={guardando} className="flex-1">
              {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear tipo de cliente"}
            </Boton>
          </div>
        </form>
      </PanelLateral>

      <Dialogo
        abierto={confirmando !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmando(null)}
        titulo={`Desactivar "${confirmando?.tipoCliente.nombre}"`}
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
