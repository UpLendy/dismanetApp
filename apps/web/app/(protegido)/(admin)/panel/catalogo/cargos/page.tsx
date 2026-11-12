"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Plus, Pencil, Ban, CheckCircle2, Briefcase } from "lucide-react";
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

interface Cargo {
  id: string;
  nombre: string;
  activo: boolean;
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

export default function PaginaCargos() {
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const [panelAbierto, setPanelAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorFila, setErrorFila] = useState<string | null>(null);

  const [confirmando, setConfirmando] = useState<Cargo | null>(null);
  const [desactivando, setDesactivando] = useState(false);

  async function cargarCargos() {
    setCargandoLista(true);
    setErrorLista(null);
    const { data, error: errorRespuesta } = await api.cargos.get();
    setCargandoLista(false);
    if (errorRespuesta || !data) {
      setErrorLista(mensajeDeError(errorRespuesta));
      return;
    }
    setCargos(data.cargos);
  }

  useEffect(() => {
    cargarCargos();
  }, []);

  function abrirCrear() {
    setEditandoId(null);
    setNombre("");
    setError(null);
    setPanelAbierto(true);
  }

  function abrirEditar(cargo: Cargo) {
    setEditandoId(cargo.id);
    setNombre(cargo.nombre);
    setError(null);
    setPanelAbierto(true);
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);

    const { data, error: errorRespuesta } = editandoId
      ? await api.cargos({ id: editandoId }).patch({ nombre })
      : await api.cargos.post({ nombre });

    setGuardando(false);

    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    setPanelAbierto(false);
    cargarCargos();
  }

  async function activar(id: string) {
    setErrorFila(null);
    const { error: errorRespuesta } = await api.cargos({ id }).activar.patch();
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      return;
    }
    cargarCargos();
  }

  function pedirConfirmacionDesactivar(cargo: Cargo) {
    setErrorFila(null);
    setConfirmando(cargo);
  }

  async function confirmarDesactivar() {
    if (!confirmando) return;
    setDesactivando(true);
    const { error: errorRespuesta } = await api.cargos({ id: confirmando.id }).desactivar.patch();
    setDesactivando(false);
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      setConfirmando(null);
      return;
    }
    setConfirmando(null);
    cargarCargos();
  }

  const cargosFiltrados = cargos.filter((c) => {
    if (filtro === "activos") return c.activo;
    if (filtro === "inactivos") return !c.activo;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Cargos</h1>
          <p className="cuerpo text-ink-muted">
            Catálogo de cargos de tu empresa. Un cargo es el oficio de la persona, no su nivel de permisos: eso lo
            define el rol. Nada se borra: desactivar un cargo no le quita el cargo a quien ya lo tiene asignado.
          </p>
        </div>
        <Boton variante="principal" onClick={abrirCrear}>
          <Plus />
          Nuevo cargo
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
        <Aviso variante="critico" titulo="No se pudo cargar el catálogo" accion={<Boton variante="contorno" onClick={cargarCargos}>Reintentar</Boton>}>
          {errorLista}
        </Aviso>
      ) : cargandoLista ? (
        <CargandoTabla filas={5} columnas={3} />
      ) : cargosFiltrados.length === 0 ? (
        <EstadoVacio
          icono={Briefcase}
          titulo={cargos.length === 0 ? "No hay cargos" : "Ningún cargo coincide con el filtro"}
          descripcion={cargos.length === 0 ? "Crea el primer cargo de tu catálogo." : undefined}
          accion={
            cargos.length === 0 ? (
              <Boton variante="principal" onClick={abrirCrear}>
                <Plus />
                Nuevo cargo
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
            {cargosFiltrados.map((cargo) => (
              <TablaFila key={cargo.id}>
                <TablaCelda className="font-medium text-ink">{cargo.nombre}</TablaCelda>
                <TablaCelda>
                  <PastillaEstado estado={cargo.activo ? "activo" : "inactivo"} />
                </TablaCelda>
                <TablaCelda>
                  <div className="flex justify-end gap-2">
                    <Boton variante="contorno" tamano="sm" onClick={() => abrirEditar(cargo)}>
                      <Pencil />
                      Editar
                    </Boton>
                    {cargo.activo ? (
                      <Boton variante="destructivo" tamano="sm" onClick={() => pedirConfirmacionDesactivar(cargo)}>
                        <Ban />
                        Desactivar
                      </Boton>
                    ) : (
                      <Boton variante="contorno" tamano="sm" onClick={() => activar(cargo.id)}>
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
        titulo={editandoId ? "Editar cargo" : "Nuevo cargo"}
      >
        <form onSubmit={guardar} className="space-y-4">
          {error ? <Aviso variante="critico">{error}</Aviso> : null}

          <Campo etiqueta="Nombre" required>
            {(props) => (
              <EntradaCampo
                {...props}
                required
                placeholder='ej. "Coordinación" o "Soporte técnico"'
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            )}
          </Campo>

          <div className="flex gap-2 pt-2">
            <Boton type="submit" variante="principal" disabled={guardando} className="flex-1">
              {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear cargo"}
            </Boton>
          </div>
        </form>
      </PanelLateral>

      <Dialogo
        abierto={confirmando !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmando(null)}
        titulo={`Desactivar "${confirmando?.nombre}"`}
        descripcion="Quienes ya tienen este cargo lo conservan. Solo deja de estar disponible para asignarlo a nadie más."
        textoConfirmar="Desactivar"
        confirmando={desactivando}
        onConfirmar={confirmarDesactivar}
      />
    </div>
  );
}
