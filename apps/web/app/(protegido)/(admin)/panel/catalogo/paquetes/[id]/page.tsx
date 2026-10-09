"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Ban, CheckCircle2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Pastilla, PastillaEstado } from "@/components/ui/pastilla";
import { Dialogo } from "@/components/ui/dialogo";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { CargandoTarjeta } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

interface Paquete {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  esPromocion: boolean;
}

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

interface Duracion {
  id: string;
  nombre: string;
}

interface Plataforma {
  id: string;
  nombre: string;
  activa: boolean;
}

interface Impacto {
  preciosActivos: number;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

const IGUAL_A_LA_VENDIDA = "__igual__";

export default function PaginaDetallePaquete() {
  const { id } = useParams<{ id: string }>();

  const [paquete, setPaquete] = useState<Paquete | null>(null);
  const [composicion, setComposicion] = useState<Componente[]>([]);
  const [excepciones, setExcepciones] = useState<Excepcion[]>([]);
  const [duracionesActivas, setDuracionesActivas] = useState<Duracion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [plataformasDisponibles, setPlataformasDisponibles] = useState<Plataforma[]>([]);
  const [plataformaNueva, setPlataformaNueva] = useState("");
  const [cantidadNueva, setCantidadNueva] = useState("1");

  const [quitando, setQuitando] = useState<Componente | null>(null);
  const [confirmandoEstado, setConfirmandoEstado] = useState<{ accion: "activar" | "desactivar"; impacto: Impacto | null } | null>(null);
  const [procesandoEstado, setProcesandoEstado] = useState(false);
  const [procesandoQuitar, setProcesandoQuitar] = useState(false);

  async function cargarDetalle() {
    setCargando(true);
    const { data, error: errorRespuesta } = await api.paquetes({ id }).get();
    setCargando(false);
    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    setPaquete(data.paquete);
    setComposicion(data.composicion);
    setExcepciones(data.excepciones);
    setDuracionesActivas(data.duracionesActivas);
  }

  async function cargarPlataformas() {
    const { data } = await api.plataformas.get();
    if (data) setPlataformasDisponibles(data.plataformas.filter((p) => p.activa));
  }

  useEffect(() => {
    cargarDetalle();
    cargarPlataformas();
  }, [id]);

  async function agregarPlataforma(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    if (!plataformaNueva) return;

    const { error: errorRespuesta } = await api.paquetes({ id }).plataformas.post({
      plataformaId: plataformaNueva,
      cantidadPantallas: Number(cantidadNueva),
    });
    if (errorRespuesta) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    setPlataformaNueva("");
    setCantidadNueva("1");
    cargarDetalle();
  }

  async function actualizarCantidad(plataformaId: string, cantidadPantallas: number) {
    setError(null);
    const { error: errorRespuesta } = await api.paquetes({ id }).plataformas({ plataformaId }).patch({
      cantidadPantallas,
    });
    if (errorRespuesta) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    cargarDetalle();
  }

  async function confirmarQuitarPlataforma() {
    if (!quitando) return;
    setError(null);
    setProcesandoQuitar(true);
    const { error: errorRespuesta } = await api.paquetes({ id }).plataformas({
      plataformaId: quitando.plataformaId,
    }).delete();
    setProcesandoQuitar(false);
    if (errorRespuesta) {
      setError(mensajeDeError(errorRespuesta));
      setQuitando(null);
      return;
    }
    setQuitando(null);
    cargarDetalle();
  }

  async function cambiarExcepcion(duracionVendidaId: string, plataformaId: string, duracionRealId: string) {
    setError(null);
    setAviso(null);
    const { data, error: errorRespuesta } = await api.paquetes({ id }).excepciones.put({
      duracionVendidaId,
      plataformaId,
      duracionRealId,
    });
    if (errorRespuesta) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    if (data?.advertencia) setAviso(data.advertencia);
    cargarDetalle();
  }

  async function pedirConfirmacionActivar() {
    setConfirmandoEstado({ accion: "activar", impacto: null });
  }

  async function pedirConfirmacionDesactivar() {
    const { data: impacto } = await api.paquetes({ id })["impacto-desactivacion"].get();
    setConfirmandoEstado({ accion: "desactivar", impacto: impacto ?? null });
  }

  async function confirmarCambioEstado() {
    if (!confirmandoEstado) return;
    setProcesandoEstado(true);
    const { error: errorRespuesta } =
      confirmandoEstado.accion === "activar"
        ? await api.paquetes({ id }).activar.patch()
        : await api.paquetes({ id }).desactivar.patch();
    setProcesandoEstado(false);
    if (errorRespuesta) {
      setError(mensajeDeError(errorRespuesta));
      setConfirmandoEstado(null);
      return;
    }
    setConfirmandoEstado(null);
    cargarDetalle();
  }

  if (cargando) {
    return (
      <div className="space-y-6">
        <CargandoTarjeta />
        <CargandoTarjeta />
      </div>
    );
  }

  if (!paquete) {
    return (
      <div className="space-y-4">
        <Aviso variante="critico">{error ?? "Paquete no encontrado."}</Aviso>
        <Link href="/panel/catalogo/paquetes" className="cuerpo font-medium text-secundario hover:underline">
          ← Volver a paquetes
        </Link>
      </div>
    );
  }

  const plataformasParaAgregar = plataformasDisponibles.filter(
    (p) => !composicion.some((c) => c.plataformaId === p.id),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/panel/catalogo/paquetes"
            className="inline-flex items-center gap-1 cuerpo font-medium text-secundario hover:underline"
          >
            <ArrowLeft className="size-4" />
            Paquetes
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="titulo-pagina text-ink">{paquete.nombre}</h1>
            <PastillaEstado estado={paquete.activo ? "activo" : "inactivo"} />
            {paquete.esPromocion ? (
              <Pastilla tono="secundario" icono={Sparkles}>
                Promoción
              </Pastilla>
            ) : null}
          </div>
          {paquete.descripcion ? <p className="cuerpo text-ink-muted">{paquete.descripcion}</p> : null}
        </div>
        {paquete.activo ? (
          <Boton variante="destructivo" onClick={pedirConfirmacionDesactivar}>
            <Ban />
            Desactivar
          </Boton>
        ) : (
          <Boton variante="contorno" onClick={pedirConfirmacionActivar}>
            <CheckCircle2 />
            Activar
          </Boton>
        )}
      </div>

      {error ? <Aviso variante="critico">{error}</Aviso> : null}
      {aviso ? <Aviso variante="aviso">{aviso}</Aviso> : null}

      <Tarjeta>
        <TarjetaCabecera titulo="Composición" />
        <div className="space-y-4">
          <Tabla>
            <TablaCabecera>
              <tr>
                <TablaCeldaCabecera>Plataforma</TablaCeldaCabecera>
                <TablaCeldaCabecera>Pantallas</TablaCeldaCabecera>
                <TablaCeldaCabecera></TablaCeldaCabecera>
              </tr>
            </TablaCabecera>
            <TablaCuerpo>
              {composicion.map((componente) => (
                <TablaFila key={componente.plataformaId}>
                  <TablaCelda className="font-medium text-ink">{componente.nombrePlataforma}</TablaCelda>
                  <TablaCelda>
                    <EntradaCampo
                      type="number"
                      min={1}
                      step={1}
                      defaultValue={componente.cantidadPantallas}
                      onBlur={(e) => {
                        const valor = Number(e.target.value);
                        if (valor >= 1 && valor !== componente.cantidadPantallas) {
                          actualizarCantidad(componente.plataformaId, valor);
                        }
                      }}
                      className="h-9 w-20"
                    />
                  </TablaCelda>
                  <TablaCelda>
                    <div className="flex justify-end">
                      <Boton variante="destructivo" tamano="sm" onClick={() => setQuitando(componente)}>
                        <Trash2 />
                        Quitar
                      </Boton>
                    </div>
                  </TablaCelda>
                </TablaFila>
              ))}
            </TablaCuerpo>
          </Tabla>

          <form onSubmit={agregarPlataforma} className="flex flex-wrap items-end gap-3">
            <Campo etiqueta="Plataforma" className="min-w-48">
              {(props) => (
                <SelectCampo {...props} value={plataformaNueva} onChange={(e) => setPlataformaNueva(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {plataformasParaAgregar.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </SelectCampo>
              )}
            </Campo>
            <Campo etiqueta="Pantallas" className="w-24">
              {(props) => (
                <EntradaCampo
                  {...props}
                  type="number"
                  min={1}
                  step={1}
                  value={cantidadNueva}
                  onChange={(e) => setCantidadNueva(e.target.value)}
                />
              )}
            </Campo>
            <Boton type="submit" variante="principal" disabled={!plataformaNueva}>
              <Plus />
              Agregar
            </Boton>
          </form>
        </div>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Excepciones de duración" />
        <p className="cuerpo mb-4 text-ink-muted">
          Por defecto cada plataforma entrega la misma duración que se vendió. Cambia una celda solo cuando esa
          plataforma necesita una vigencia distinta — esas celdas quedan resaltadas.
        </p>

        {composicion.length === 0 ? (
          <p className="cuerpo text-ink-muted">Agrega plataformas a la composición primero.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="cuerpo w-full text-ink">
              <thead>
                <tr className="border-b border-borde text-left">
                  <th className="etiqueta-dato px-3 py-2 pl-0 text-left">Duración vendida</th>
                  {composicion.map((componente) => (
                    <th key={componente.plataformaId} className="etiqueta-dato px-3 py-2 text-left">
                      {componente.nombrePlataforma}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {duracionesActivas.map((duracionVendida) => (
                  <tr key={duracionVendida.id} className="border-b border-borde last:border-0">
                    <td className="px-3 py-2 pl-0 font-medium">{duracionVendida.nombre}</td>
                    {composicion.map((componente) => {
                      const excepcion = excepciones.find(
                        (e) => e.duracionVendidaId === duracionVendida.id && e.plataformaId === componente.plataformaId,
                      );
                      const valorActual = excepcion ? excepcion.duracionRealId : IGUAL_A_LA_VENDIDA;
                      return (
                        <td
                          key={componente.plataformaId}
                          className={cn("px-3 py-2", excepcion ? "rounded-control bg-secundario-suave" : "")}
                        >
                          <SelectCampo
                            value={valorActual}
                            onChange={(e) => {
                              const nuevoValor = e.target.value;
                              const duracionRealId = nuevoValor === IGUAL_A_LA_VENDIDA ? duracionVendida.id : nuevoValor;
                              cambiarExcepcion(duracionVendida.id, componente.plataformaId, duracionRealId);
                            }}
                            className={cn("h-9 text-xs", excepcion ? "border-secundario/30" : "")}
                          >
                            <option value={IGUAL_A_LA_VENDIDA}>Igual a la vendida</option>
                            {duracionesActivas.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.nombre}
                              </option>
                            ))}
                          </SelectCampo>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      <Dialogo
        abierto={quitando !== null}
        onCambiarAbierto={(abierto) => !abierto && setQuitando(null)}
        titulo={`Quitar "${quitando?.nombrePlataforma}" de la composición`}
        descripcion="Se borran también sus excepciones de duración en este paquete."
        textoConfirmar="Quitar"
        confirmando={procesandoQuitar}
        onConfirmar={confirmarQuitarPlataforma}
      />

      <Dialogo
        abierto={confirmandoEstado !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmandoEstado(null)}
        titulo={confirmandoEstado?.accion === "activar" ? `Activar "${paquete.nombre}"` : `Desactivar "${paquete.nombre}"`}
        descripcion={
          confirmandoEstado?.accion === "desactivar" && confirmandoEstado.impacto
            ? `Quedan ${confirmandoEstado.impacto.preciosActivos} precio(s) sin poder venderse.`
            : undefined
        }
        textoConfirmar={confirmandoEstado?.accion === "activar" ? "Activar" : "Desactivar"}
        confirmando={procesandoEstado}
        onConfirmar={confirmarCambioEstado}
      />
    </div>
  );
}
