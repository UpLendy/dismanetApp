"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Plus, Pencil, Ban, CheckCircle2, Package, ChevronRight, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo, AreaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Pastilla, PastillaEstado } from "@/components/ui/pastilla";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Dialogo } from "@/components/ui/dialogo";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { CargandoTabla } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

interface Componente {
  plataformaId: string;
  nombrePlataforma: string;
  cantidadPantallas: number;
}

interface Excepcion {
  duracionVendidaId: string;
  duracionVendidaNombre: string;
  plataformaId: string;
  nombrePlataforma: string;
  duracionRealId: string;
  duracionRealNombre: string;
}

interface Paquete {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  esPromocion: boolean;
  composicion: Componente[];
  excepciones: Excepcion[];
}

interface Impacto {
  preciosActivos: number;
  paquetesAfectados?: { id: string; nombre: string }[];
}

type Filtro = "todos" | "activos" | "inactivos";
type FiltroPromocion = "todos" | "paquetes" | "promociones";

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

// Parte 8: nombres planos si no hay excepciones; si las hay, una línea por
// cada duración vendida que tiene al menos una excepción, mostrando la
// duración real de CADA plataforma de la composición (igual a la vendida o
// distinta).
function lineaComposicion(paquete: Paquete): string {
  if (paquete.composicion.length === 0) return "Sin plataformas";
  if (paquete.excepciones.length === 0) {
    return paquete.composicion.map((c) => c.nombrePlataforma).join(" · ");
  }

  const duracionesVendidasConExcepcion = new Map<string, { nombre: string; excepciones: Excepcion[] }>();
  for (const excepcion of paquete.excepciones) {
    const existente = duracionesVendidasConExcepcion.get(excepcion.duracionVendidaId);
    if (existente) {
      existente.excepciones.push(excepcion);
    } else {
      duracionesVendidasConExcepcion.set(excepcion.duracionVendidaId, {
        nombre: excepcion.duracionVendidaNombre,
        excepciones: [excepcion],
      });
    }
  }

  return [...duracionesVendidasConExcepcion.values()]
    .map(({ nombre, excepciones }) => {
      const detalle = paquete.composicion
        .map((componente) => {
          const excepcion = excepciones.find((e) => e.plataformaId === componente.plataformaId);
          const duracion = excepcion ? excepcion.duracionRealNombre : nombre;
          return `${componente.nombrePlataforma} ${duracion}`;
        })
        .join(" · ");
      return `A ${nombre}: ${detalle}`;
    })
    .join(" / ");
}

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "activos", etiqueta: "Activos" },
  { valor: "inactivos", etiqueta: "Inactivos" },
];

const FILTROS_PROMOCION: { valor: FiltroPromocion; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "paquetes", etiqueta: "Paquetes" },
  { valor: "promociones", etiqueta: "Promociones" },
];

export default function PaginaPaquetes() {
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [filtroPromocion, setFiltroPromocion] = useState<FiltroPromocion>("todos");

  const [panelAbierto, setPanelAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [esPromocion, setEsPromocion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorFila, setErrorFila] = useState<string | null>(null);

  const [confirmando, setConfirmando] = useState<{ paquete: Paquete; impacto: Impacto | null } | null>(null);
  const [desactivando, setDesactivando] = useState(false);

  async function cargarPaquetes() {
    setCargandoLista(true);
    setErrorLista(null);
    const { data, error: errorRespuesta } = await api.paquetes.get();
    setCargandoLista(false);
    if (errorRespuesta || !data) {
      setErrorLista(mensajeDeError(errorRespuesta));
      return;
    }
    setPaquetes(data.paquetes);
  }

  useEffect(() => {
    cargarPaquetes();
  }, []);

  function abrirCrear() {
    setEditandoId(null);
    setNombre("");
    setDescripcion("");
    setEsPromocion(false);
    setError(null);
    setPanelAbierto(true);
  }

  function abrirEditar(paquete: Paquete) {
    setEditandoId(paquete.id);
    setNombre(paquete.nombre);
    setDescripcion(paquete.descripcion ?? "");
    setEsPromocion(paquete.esPromocion);
    setError(null);
    setPanelAbierto(true);
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);

    const cuerpo = { nombre, ...(descripcion ? { descripcion } : {}), esPromocion };

    const { data, error: errorRespuesta } = editandoId
      ? await api.paquetes({ id: editandoId }).patch(cuerpo)
      : await api.paquetes.post(cuerpo);

    setGuardando(false);

    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    setPanelAbierto(false);
    cargarPaquetes();
  }

  async function activar(id: string) {
    setErrorFila(null);
    const { error: errorRespuesta } = await api.paquetes({ id }).activar.patch();
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      return;
    }
    cargarPaquetes();
  }

  async function pedirConfirmacionDesactivar(paquete: Paquete) {
    setErrorFila(null);
    const { data: impacto } = await api.paquetes({ id: paquete.id })["impacto-desactivacion"].get();
    setConfirmando({ paquete, impacto: impacto ?? null });
  }

  async function confirmarDesactivar() {
    if (!confirmando) return;
    setDesactivando(true);
    const { error: errorRespuesta } = await api.paquetes({ id: confirmando.paquete.id }).desactivar.patch();
    setDesactivando(false);
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      setConfirmando(null);
      return;
    }
    setConfirmando(null);
    cargarPaquetes();
  }

  const paquetesFiltrados = paquetes.filter((p) => {
    if (filtro === "activos" && !p.activo) return false;
    if (filtro === "inactivos" && p.activo) return false;
    if (filtroPromocion === "paquetes" && p.esPromocion) return false;
    if (filtroPromocion === "promociones" && !p.esPromocion) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Paquetes</h1>
          <p className="cuerpo text-ink-muted">
            Catálogo de paquetes de tu empresa. La composición y las excepciones de duración se gestionan desde el
            detalle de cada paquete.
          </p>
        </div>
        <Boton variante="principal" onClick={abrirCrear}>
          <Plus />
          Nuevo paquete
        </Boton>
      </div>

      <div className="flex flex-wrap gap-3">
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

        <div className="flex gap-1.5">
          {FILTROS_PROMOCION.map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              onClick={() => setFiltroPromocion(opcion.valor)}
              className={cn(
                "rounded-control border px-3 py-1.5 text-xs font-medium transition-colors",
                filtroPromocion === opcion.valor
                  ? "border-secundario bg-secundario-suave text-secundario-texto"
                  : "border-borde text-ink-2 hover:bg-black/4 dark:hover:bg-white/5",
              )}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {errorFila ? <Aviso variante="critico">{errorFila}</Aviso> : null}

      {errorLista ? (
        <Aviso variante="critico" titulo="No se pudo cargar el catálogo" accion={<Boton variante="contorno" onClick={cargarPaquetes}>Reintentar</Boton>}>
          {errorLista}
        </Aviso>
      ) : cargandoLista ? (
        <CargandoTabla filas={5} columnas={4} />
      ) : paquetesFiltrados.length === 0 ? (
        <EstadoVacio
          icono={Package}
          titulo={paquetes.length === 0 ? "No hay paquetes" : "Ningún paquete coincide con el filtro"}
          descripcion={paquetes.length === 0 ? "Crea el primer paquete de tu catálogo." : undefined}
          accion={
            paquetes.length === 0 ? (
              <Boton variante="principal" onClick={abrirCrear}>
                <Plus />
                Nuevo paquete
              </Boton>
            ) : undefined
          }
        />
      ) : (
        <Tabla>
          <TablaCabecera>
            <tr>
              <TablaCeldaCabecera>Nombre</TablaCeldaCabecera>
              <TablaCeldaCabecera>Composición</TablaCeldaCabecera>
              <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
              <TablaCeldaCabecera></TablaCeldaCabecera>
            </tr>
          </TablaCabecera>
          <TablaCuerpo>
            {paquetesFiltrados.map((paquete) => (
              <TablaFila key={paquete.id}>
                <TablaCelda className="font-medium text-ink align-top">{paquete.nombre}</TablaCelda>
                <TablaCelda className="max-w-md align-top text-ink-muted">{lineaComposicion(paquete)}</TablaCelda>
                <TablaCelda className="align-top">
                  <div className="flex flex-wrap gap-1.5">
                    <PastillaEstado estado={paquete.activo ? "activo" : "inactivo"} />
                    {paquete.esPromocion ? (
                      <Pastilla tono="secundario" icono={Sparkles}>
                        Promoción
                      </Pastilla>
                    ) : null}
                  </div>
                </TablaCelda>
                <TablaCelda className="align-top">
                  <div className="flex justify-end gap-2">
                    <Boton variante="contorno" tamano="sm" asChild>
                      <Link href={`/panel/catalogo/paquetes/${paquete.id}`}>
                        Detalle
                        <ChevronRight />
                      </Link>
                    </Boton>
                    <Boton variante="contorno" tamano="sm" onClick={() => abrirEditar(paquete)}>
                      <Pencil />
                      Editar
                    </Boton>
                    {paquete.activo ? (
                      <Boton variante="destructivo" tamano="sm" onClick={() => pedirConfirmacionDesactivar(paquete)}>
                        <Ban />
                        Desactivar
                      </Boton>
                    ) : (
                      <Boton variante="contorno" tamano="sm" onClick={() => activar(paquete.id)}>
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
        titulo={editandoId ? "Editar paquete" : "Nuevo paquete"}
      >
        <form onSubmit={guardar} className="space-y-4">
          {error ? <Aviso variante="critico">{error}</Aviso> : null}

          <Campo etiqueta="Nombre" required>
            {(props) => (
              <EntradaCampo
                {...props}
                required
                placeholder='ej. "Básico 1"'
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            )}
          </Campo>

          <Campo etiqueta="Descripción" ayuda="Opcional.">
            {(props) => (
              <AreaCampo {...props} rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
            )}
          </Campo>

          <label className="flex items-center gap-2 cuerpo text-ink">
            <input
              type="checkbox"
              checked={esPromocion}
              onChange={(e) => setEsPromocion(e.target.checked)}
              className="size-4 rounded accent-secundario"
            />
            Es promoción
          </label>

          {!editandoId ? (
            <p className="text-xs text-ink-muted">
              Después de crear el paquete, agrega su composición de plataformas desde el detalle.
            </p>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Boton type="submit" variante="principal" disabled={guardando} className="flex-1">
              {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear paquete"}
            </Boton>
          </div>
        </form>
      </PanelLateral>

      <Dialogo
        abierto={confirmando !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmando(null)}
        titulo={`Desactivar "${confirmando?.paquete.nombre}"`}
        descripcion={
          confirmando?.impacto ? <>Quedan {confirmando.impacto.preciosActivos} precio(s) sin poder venderse.</> : undefined
        }
        textoConfirmar="Desactivar"
        confirmando={desactivando}
        onConfirmar={confirmarDesactivar}
      />
    </div>
  );
}
