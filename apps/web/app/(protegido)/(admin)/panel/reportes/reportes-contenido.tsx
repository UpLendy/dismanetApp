"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, FileText, Lock, Users } from "lucide-react";
import { api } from "@/lib/api";
import { satisfaceRol, type Rol } from "@/lib/rol";
import { hoyBogotaISO, sumarDiasISO } from "@/lib/bogota";
import { Boton } from "@/components/ui/boton";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { Campo, AreaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Esqueleto } from "@/components/ui/cargando";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { Pastilla } from "@/components/ui/pastilla";

interface Reporte {
  id: string;
  usuarioId: string;
  usuario: { id: string; nombre: string };
  cargoId: string | null;
  semanaInicio: string;
  pendientes: string;
  fallas: string;
  oportunidades: string;
  actualizadoEn: string;
}

interface Faltante {
  id: string;
  nombre: string;
  cargo: { id: string; nombre: string } | null;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

/** Lunes (YYYY-MM-DD, calendario Bogotá) de la semana a la que pertenece `fechaISO`. Mismo cálculo que calendario-contenido.tsx. */
function lunesDeSemanaISO(fechaISO: string): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay(); // 0=domingo
  const diasDesdeLunes = (diaSemana + 6) % 7;
  return sumarDiasISO(fechaISO, -diasDesdeLunes);
}

/** "15 jun – 21 jun" a partir del lunes de la semana. */
function rangoSemanaLegible(lunesISO: string): string {
  const domingoISO = sumarDiasISO(lunesISO, 6);
  const formato = (iso: string) => {
    const [, mes, dia] = iso.split("-").map(Number);
    const nombreMes = new Date(Date.UTC(2000, mes - 1, 1)).toLocaleDateString("es-CO", { month: "short" });
    return `${dia} ${nombreMes}`;
  };
  return `${formato(lunesISO)} – ${formato(domingoISO)}`;
}

const SEMANAS_HISTORIAL = 6;

export function ReportesContenido({ rol }: { rol: Rol }) {
  const esAdmin = satisfaceRol(rol, "ADMIN");
  return esAdmin ? <VistaAdmin /> : <VistaEmpleado />;
}

function VistaEmpleado() {
  const lunesActual = useMemo(() => lunesDeSemanaISO(hoyBogotaISO()), []);
  const [offsetSemanas, setOffsetSemanas] = useState(0);
  const semanaSeleccionada = sumarDiasISO(lunesActual, -7 * offsetSemanas);

  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [editable, setEditable] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [formulario, setFormulario] = useState({ pendientes: "", fallas: "", oportunidades: "" });
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);

  const [historial, setHistorial] = useState<Record<string, boolean>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    setGuardadoOk(false);

    const { data, error } = await api.reportes.mio.get({ query: { semana: semanaSeleccionada } });
    if (error || !data) {
      setErrorCarga(mensajeDeError(error));
      setCargando(false);
      return;
    }
    setReporte(data.reporte);
    setEditable(data.editable);
    setFormulario({
      pendientes: data.reporte?.pendientes ?? "",
      fallas: data.reporte?.fallas ?? "",
      oportunidades: data.reporte?.oportunidades ?? "",
    });
    setErrorFormulario(null);
    setCargando(false);
  }, [semanaSeleccionada]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    let vigente = true;
    (async () => {
      const semanas = Array.from({ length: SEMANAS_HISTORIAL }, (_, i) => sumarDiasISO(lunesActual, -7 * i));
      const resultados = await Promise.all(
        semanas.map((semana) => api.reportes.mio.get({ query: { semana } })),
      );
      if (!vigente) return;
      const mapa: Record<string, boolean> = {};
      semanas.forEach((semana, i) => {
        mapa[semana] = Boolean(resultados[i].data?.reporte);
      });
      setHistorial(mapa);
    })();
    return () => {
      vigente = false;
    };
  }, [lunesActual]);

  async function guardar() {
    setGuardando(true);
    setErrorFormulario(null);
    setGuardadoOk(false);

    const { data, error } = await api.reportes.mio.put({
      semana: semanaSeleccionada,
      pendientes: formulario.pendientes,
      fallas: formulario.fallas,
      oportunidades: formulario.oportunidades,
    });

    setGuardando(false);
    if (error || !data) {
      setErrorFormulario(mensajeDeError(error));
      return;
    }
    setReporte(data.reporte);
    setGuardadoOk(true);
    setHistorial((h) => ({ ...h, [semanaSeleccionada]: true }));
  }

  const yaEntrego = Boolean(reporte);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Reportes semanales</h1>
          <p className="cuerpo text-ink-muted">Pendientes, fallas y oportunidades de mejora de tu semana.</p>
        </div>
        <div className="flex items-center gap-2">
          <Boton
            variante="contorno"
            tamano="sm"
            onClick={() => setOffsetSemanas((o) => o + 1)}
            aria-label="Semana anterior"
          >
            <ChevronLeft />
          </Boton>
          <Boton variante="contorno" tamano="sm" onClick={() => setOffsetSemanas(0)} disabled={offsetSemanas === 0}>
            Esta semana
          </Boton>
          <Boton
            variante="contorno"
            tamano="sm"
            onClick={() => setOffsetSemanas((o) => Math.max(0, o - 1))}
            disabled={offsetSemanas === 0}
            aria-label="Semana siguiente"
          >
            <ChevronRight />
          </Boton>
        </div>
      </div>

      {errorCarga ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar"
          accion={
            <Boton variante="contorno" onClick={cargar}>
              Reintentar
            </Boton>
          }
        >
          {errorCarga}
        </Aviso>
      ) : null}

      {cargando ? (
        <div className="space-y-2">
          <Esqueleto className="h-10 w-full" />
          <Esqueleto className="h-40 w-full" />
        </div>
      ) : (
        <Tarjeta>
          <TarjetaCabecera
            titulo={rangoSemanaLegible(semanaSeleccionada)}
            accion={
              editable ? (
                <Pastilla tono={yaEntrego ? "bien" : "aviso"} icono={yaEntrego ? CheckCircle2 : Circle}>
                  {yaEntrego ? "Entregado" : "No entregado"}
                </Pastilla>
              ) : (
                <Pastilla tono="secundario" icono={Lock}>
                  Semana cerrada
                </Pastilla>
              )
            }
          />

          {!editable ? (
            <Aviso variante="info" className="mb-4">
              Esta semana ya cerró: solo se puede escribir o editar la semana actual y la anterior.
            </Aviso>
          ) : null}

          {!editable && !reporte ? (
            <EstadoVacio icono={FileText} titulo="No hay reporte para esta semana" />
          ) : (
            <div className="space-y-4">
              <Campo etiqueta="Pendientes" ayuda="Lo que quedó por hacer esta semana.">
                {(p) => (
                  <AreaCampo
                    {...p}
                    disabled={!editable}
                    value={formulario.pendientes}
                    onChange={(e) => setFormulario((f) => ({ ...f, pendientes: e.target.value }))}
                  />
                )}
              </Campo>
              <Campo etiqueta="Fallas" ayuda="Qué no salió bien.">
                {(p) => (
                  <AreaCampo
                    {...p}
                    disabled={!editable}
                    value={formulario.fallas}
                    onChange={(e) => setFormulario((f) => ({ ...f, fallas: e.target.value }))}
                  />
                )}
              </Campo>
              <Campo etiqueta="Oportunidades de mejora">
                {(p) => (
                  <AreaCampo
                    {...p}
                    disabled={!editable}
                    value={formulario.oportunidades}
                    onChange={(e) => setFormulario((f) => ({ ...f, oportunidades: e.target.value }))}
                  />
                )}
              </Campo>

              {errorFormulario ? <Aviso variante="critico">{errorFormulario}</Aviso> : null}
              {guardadoOk ? <Aviso variante="info">Reporte guardado.</Aviso> : null}

              {editable ? (
                <div className="flex justify-end">
                  <Boton variante="principal" onClick={guardar} disabled={guardando}>
                    {guardando ? "Guardando…" : "Guardar"}
                  </Boton>
                </div>
              ) : null}
            </div>
          )}
        </Tarjeta>
      )}

      <Tarjeta>
        <TarjetaCabecera titulo="Historial" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: SEMANAS_HISTORIAL }, (_, i) => sumarDiasISO(lunesActual, -7 * i)).map(
            (semana, i) => {
              const entregado = historial[semana];
              return (
                <button
                  key={semana}
                  type="button"
                  onClick={() => setOffsetSemanas(i)}
                  className="rounded-pastilla border border-borde px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-plano"
                >
                  <span className="mr-1.5 text-ink-muted">{rangoSemanaLegible(semana)}</span>
                  {entregado === undefined ? (
                    "…"
                  ) : entregado ? (
                    <span className="text-bien">Entregado</span>
                  ) : (
                    <span className="text-ink-muted">No entregado</span>
                  )}
                </button>
              );
            },
          )}
        </div>
      </Tarjeta>
    </div>
  );
}

function VistaAdmin() {
  const lunesActual = useMemo(() => lunesDeSemanaISO(hoyBogotaISO()), []);
  const [semana, setSemana] = useState(lunesActual);

  const [reportes, setReportes] = useState<Reporte[]>([]);
  const [faltantes, setFaltantes] = useState<Faltante[]>([]);
  const [nombreCargo, setNombreCargo] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);

    const [resReportes, resFaltantes, resCargos] = await Promise.all([
      api.reportes.get({ query: { semana } }),
      api.reportes.faltantes.get({ query: { semana } }),
      api.cargos.get(),
    ]);

    if (resReportes.error || !resReportes.data || resFaltantes.error || !resFaltantes.data) {
      setErrorCarga(mensajeDeError(resReportes.error ?? resFaltantes.error));
      setCargando(false);
      return;
    }

    setReportes(resReportes.data.reportes);
    setFaltantes(resFaltantes.data.faltantes);
    if (resCargos.data) {
      setNombreCargo(Object.fromEntries(resCargos.data.cargos.map((c) => [c.id, c.nombre])));
    }
    setCargando(false);
  }, [semana]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const grupos = useMemo(() => {
    const porCargo = new Map<string, Reporte[]>();
    for (const reporte of reportes) {
      const clave = reporte.cargoId ?? "";
      porCargo.set(clave, [...(porCargo.get(clave) ?? []), reporte]);
    }
    return [...porCargo.entries()]
      .map(([cargoId, filas]) => ({
        cargoId,
        titulo: cargoId ? nombreCargo[cargoId] ?? "Cargo desconocido" : "Sin cargo asignado",
        filas,
      }))
      .sort((a, b) => a.titulo.localeCompare(b.titulo));
  }, [reportes, nombreCargo]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Reportes semanales</h1>
          <p className="cuerpo text-ink-muted">Reportes del equipo, agrupados por cargo, y quién falta por entregar.</p>
        </div>
        <div className="flex items-center gap-2">
          <Boton variante="contorno" tamano="sm" onClick={() => setSemana((s) => sumarDiasISO(s, -7))}>
            <ChevronLeft />
          </Boton>
          <Boton variante="contorno" tamano="sm" onClick={() => setSemana(lunesActual)}>
            {rangoSemanaLegible(semana)}
          </Boton>
          <Boton
            variante="contorno"
            tamano="sm"
            onClick={() => setSemana((s) => sumarDiasISO(s, 7))}
            disabled={semana === lunesActual}
          >
            <ChevronRight />
          </Boton>
        </div>
      </div>

      {errorCarga ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar"
          accion={
            <Boton variante="contorno" onClick={cargar}>
              Reintentar
            </Boton>
          }
        >
          {errorCarga}
        </Aviso>
      ) : null}

      {cargando ? (
        <div className="space-y-2">
          <Esqueleto className="h-24 w-full" />
          <Esqueleto className="h-40 w-full" />
        </div>
      ) : (
        <>
          <Tarjeta>
            <TarjetaCabecera titulo="Falta por entregar" accion={<Pastilla tono="aviso" icono={Users}>{faltantes.length}</Pastilla>} />
            {faltantes.length === 0 ? (
              <p className="cuerpo text-ink-muted">Todos entregaron el reporte de esta semana.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {faltantes.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-pastilla bg-aviso/10 px-2.5 py-1 text-xs font-medium text-ink"
                  >
                    {f.nombre}
                    {f.cargo ? <span className="text-ink-muted"> · {f.cargo.nombre}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          {grupos.length === 0 ? (
            <EstadoVacio icono={FileText} titulo="Sin reportes entregados esta semana" />
          ) : (
            grupos.map((grupo) => (
              <Tarjeta key={grupo.cargoId || "sin-cargo"}>
                <TarjetaCabecera titulo={grupo.titulo} />
                <div className="space-y-4">
                  {grupo.filas.map((reporte) => (
                    <div key={reporte.id} className="rounded-control border border-borde p-3">
                      <p className="mb-2 font-medium text-ink">{reporte.usuario.nombre}</p>
                      <dl className="grid gap-2 sm:grid-cols-3">
                        <div>
                          <dt className="text-xs font-medium text-ink-muted">Pendientes</dt>
                          <dd className="cuerpo whitespace-pre-wrap text-ink-2">{reporte.pendientes || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-ink-muted">Fallas</dt>
                          <dd className="cuerpo whitespace-pre-wrap text-ink-2">{reporte.fallas || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-ink-muted">Oportunidades</dt>
                          <dd className="cuerpo whitespace-pre-wrap text-ink-2">{reporte.oportunidades || "—"}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              </Tarjeta>
            ))
          )}
        </>
      )}
    </div>
  );
}
