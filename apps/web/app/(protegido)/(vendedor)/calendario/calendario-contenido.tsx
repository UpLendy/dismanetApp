"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { satisfaceRol, type Rol } from "@/lib/rol";
import { Boton } from "@/components/ui/boton";
import { Tarjeta } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Dialogo } from "@/components/ui/dialogo";
import { Esqueleto } from "@/components/ui/cargando";

interface Turno {
  id: string;
  usuarioId: string;
  usuario: { id: string; nombre: string };
  inicio: string;
  fin: string;
  notas: string | null;
}

interface Festivo {
  id: string;
  fecha: string;
  nombre: string;
  generado: boolean;
}

interface UsuarioFila {
  id: string;
  nombre: string;
}

const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

// Bogotá no tiene horario de verano: el desplazamiento es un número fijo,
// igual que en apps/api/src/lib/periodos.ts. Aquí hace falta en sentido
// inverso al de ese archivo porque este es el único formulario del
// frontend que pide un instante absoluto (hora de inicio/fin de un turno)
// en vez de solo una fecha de calendario.
const DESPLAZAMIENTO_BOGOTA_MS = 5 * 60 * 60 * 1000;

function hoyBogotaISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

function fechaBogotaDeInstante(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date(iso));
}

function horaBogotaDeInstante(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** Suma días de calendario a una fecha "YYYY-MM-DD" — aritmética de fecha, no de zona horaria. */
function sumarDiasISO(fechaISO: string, dias: number): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const utc = new Date(Date.UTC(anio, mes - 1, dia + dias));
  return utc.toISOString().slice(0, 10);
}

function lunesDeSemanaISO(fechaISO: string): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay(); // 0=domingo
  const diasDesdeLunes = (diaSemana + 6) % 7;
  return sumarDiasISO(fechaISO, -diasDesdeLunes);
}

function formatearEncabezadoDia(fechaISO: string): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.toLocaleDateString("es-CO", { timeZone: "UTC", day: "numeric", month: "short" });
}

/** Hora de Bogotá (HH:mm) + fecha de calendario (Bogotá) -> instante UTC absoluto. */
function bogotaAInstanteUTC(fechaISO: string, horaHHmm: string): string {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  const [h, m] = horaHHmm.split(":").map(Number);
  const ficticio = Date.UTC(anio, mes - 1, dia, h, m, 0, 0);
  return new Date(ficticio + DESPLAZAMIENTO_BOGOTA_MS).toISOString();
}

interface FormularioTurno {
  usuarioId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  notas: string;
}

export function CalendarioContenido({
  rol,
  usuarioPropio,
}: {
  rol: Rol;
  usuarioPropio: { id: string; nombre: string };
}) {
  const esAdmin = satisfaceRol(rol, "ADMIN");

  const [lunes, setLunes] = useState(() => lunesDeSemanaISO(hoyBogotaISO()));
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDiasISO(lunes, i)), [lunes]);

  const [filas, setFilas] = useState<UsuarioFila[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [festivoPorFecha, setFestivoPorFecha] = useState<Record<string, string>>({});
  const [horasPorUsuario, setHorasPorUsuario] = useState<Record<string, number>>({});

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [dialogo, setDialogo] = useState<
    | { tipo: "crear"; usuarioId: string; nombreUsuario: string; fecha: string }
    | { tipo: "editar"; turno: Turno }
    | null
  >(null);
  const [formulario, setFormulario] = useState<FormularioTurno>({
    usuarioId: "",
    fecha: "",
    horaInicio: "08:00",
    horaFin: "17:00",
    notas: "",
  });
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [confirmandoBorrar, setConfirmandoBorrar] = useState<Turno | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [errorFila, setErrorFila] = useState<string | null>(null);

  const [resaltadoId, setResaltadoId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);

    const hasta = dias[6];
    const anios = [...new Set(dias.map((d) => d.slice(0, 4)))];

    const [resTurnos, resUsuarios, resHoras, ...resFestivos] = await Promise.all([
      api.turnos.get({ query: { desde: lunes, hasta } }),
      esAdmin ? api.usuarios.get() : Promise.resolve(null),
      esAdmin ? api.turnos.horas.get({ query: { desde: lunes, hasta } }) : Promise.resolve(null),
      ...anios.map((anio) => api.festivos.get({ query: { anio } })),
    ]);

    setCargando(false);

    if (resTurnos.error || !resTurnos.data) {
      setErrorCarga(mensajeDeError(resTurnos.error));
      return;
    }
    setTurnos(resTurnos.data.turnos);

    const festivos: Record<string, string> = {};
    for (const res of resFestivos) {
      if (res?.data) {
        for (const festivo of res.data.festivos as Festivo[]) {
          festivos[festivo.fecha.slice(0, 10)] = festivo.nombre;
        }
      }
    }
    setFestivoPorFecha(festivos);

    if (esAdmin && resUsuarios?.data) {
      setFilas(
        resUsuarios.data.usuarios.filter((u) => u.activo).map((u) => ({ id: u.id, nombre: u.nombre })),
      );
    } else {
      setFilas([{ id: usuarioPropio.id, nombre: usuarioPropio.nombre }]);
    }

    const horas: Record<string, number> = {};
    if (esAdmin && resHoras?.data) {
      for (const fila of resHoras.data.horas) horas[fila.usuarioId] = fila.horas;
    } else {
      // Sin acceso a GET /turnos/horas (es de ADMIN): suma simple de las
      // propias horas ya cargadas. Aproximación de solo lectura — no
      // alimenta comisiones (eso siempre pasa por el endpoint autoritativo).
      for (const turno of resTurnos.data.turnos) {
        const horasTurno = (new Date(turno.fin).getTime() - new Date(turno.inicio).getTime()) / (60 * 60 * 1000);
        horas[turno.usuarioId] = (horas[turno.usuarioId] ?? 0) + horasTurno;
      }
    }
    setHorasPorUsuario(horas);
  }, [lunes, dias, esAdmin, usuarioPropio.id, usuarioPropio.nombre]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const turnosPorCelda = useMemo(() => {
    const mapa = new Map<string, Turno[]>();
    for (const turno of turnos) {
      const clave = `${turno.usuarioId}|${fechaBogotaDeInstante(turno.inicio)}`;
      const lista = mapa.get(clave) ?? [];
      lista.push(turno);
      mapa.set(clave, lista);
    }
    return mapa;
  }, [turnos]);

  function abrirCrear(usuarioId: string, nombreUsuario: string, fecha: string) {
    setErrorFormulario(null);
    setDialogo({ tipo: "crear", usuarioId, nombreUsuario, fecha });
    setFormulario({ usuarioId, fecha, horaInicio: "08:00", horaFin: "17:00", notas: "" });
  }

  function abrirEditar(turno: Turno) {
    setErrorFormulario(null);
    setDialogo({ tipo: "editar", turno });
    setFormulario({
      usuarioId: turno.usuarioId,
      fecha: fechaBogotaDeInstante(turno.inicio),
      horaInicio: horaBogotaDeInstante(turno.inicio),
      horaFin: horaBogotaDeInstante(turno.fin),
      notas: turno.notas ?? "",
    });
  }

  async function guardarTurno() {
    if (!dialogo) return;
    setGuardando(true);
    setErrorFormulario(null);

    const inicio = bogotaAInstanteUTC(formulario.fecha, formulario.horaInicio);
    // Si la hora de fin no es posterior a la de inicio, el turno cruza
    // medianoche (p. ej. 22:00 -> 06:00): el fin cae en el día siguiente.
    const finMismoDia = bogotaAInstanteUTC(formulario.fecha, formulario.horaFin);
    const fin =
      new Date(finMismoDia).getTime() > new Date(inicio).getTime()
        ? finMismoDia
        : bogotaAInstanteUTC(sumarDiasISO(formulario.fecha, 1), formulario.horaFin);

    const cuerpo = { usuarioId: formulario.usuarioId, inicio, fin, notas: formulario.notas || null };

    const { data, error } =
      dialogo.tipo === "crear"
        ? await api.turnos.post(cuerpo)
        : await api.turnos({ id: dialogo.turno.id }).patch(cuerpo);

    setGuardando(false);

    if (error || !data) {
      const codigo = (error as { value?: { error?: { codigo?: string } } } | undefined)?.value?.error?.codigo;
      if (codigo === "TURNO_SOLAPADO") {
        const idChoque = mensajeDeError(error).match(/\(id ([^)]+)\)/)?.[1];
        if (idChoque) {
          setResaltadoId(idChoque);
          setTimeout(() => setResaltadoId(null), 4000);
        }
      }
      setErrorFormulario(mensajeDeError(error));
      return;
    }

    setDialogo(null);
    cargar();
  }

  async function confirmarBorrar() {
    if (!confirmandoBorrar) return;
    setBorrando(true);
    const { error } = await api.turnos({ id: confirmandoBorrar.id }).delete();
    setBorrando(false);
    if (error) {
      setErrorFila(mensajeDeError(error));
      setConfirmandoBorrar(null);
      return;
    }
    setConfirmandoBorrar(null);
    cargar();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Calendario</h1>
          <p className="cuerpo text-ink-muted">
            {esAdmin ? "Turnos de todo el equipo, por semana." : "Tus turnos de esta semana."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Boton variante="contorno" tamano="sm" onClick={() => setLunes((l) => sumarDiasISO(l, -7))}>
            <ChevronLeft />
          </Boton>
          <Boton variante="contorno" tamano="sm" onClick={() => setLunes(lunesDeSemanaISO(hoyBogotaISO()))}>
            Hoy
          </Boton>
          <Boton variante="contorno" tamano="sm" onClick={() => setLunes((l) => sumarDiasISO(l, 7))}>
            <ChevronRight />
          </Boton>
        </div>
      </div>

      {errorCarga ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar el calendario"
          accion={
            <Boton variante="contorno" onClick={cargar}>
              Reintentar
            </Boton>
          }
        >
          {errorCarga}
        </Aviso>
      ) : null}

      {errorFila ? <Aviso variante="critico">{errorFila}</Aviso> : null}

      {cargando ? (
        <div className="space-y-2">
          <Esqueleto className="h-10 w-full" />
          <Esqueleto className="h-24 w-full" />
          <Esqueleto className="h-24 w-full" />
        </div>
      ) : (
        <Tarjeta className="overflow-x-auto p-0">
          <table className="w-full min-w-[920px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-borde">
                <th className="etiqueta-dato px-3 py-2 text-left">Empleado</th>
                {dias.map((dia) => (
                  <th key={dia} className="etiqueta-dato px-2 py-2 text-left align-top">
                    <div>{DIAS_SEMANA[dias.indexOf(dia)]}</div>
                    <div className="font-normal text-ink-muted normal-case">{formatearEncabezadoDia(dia)}</div>
                    {festivoPorFecha[dia] ? (
                      <div className="mt-1 inline-flex max-w-[9rem] items-center gap-1 rounded-pastilla bg-secundario-suave px-1.5 py-0.5 text-[11px] font-medium text-secundario-texto normal-case">
                        {festivoPorFecha[dia]}
                      </div>
                    ) : null}
                  </th>
                ))}
                <th className="etiqueta-dato px-3 py-2 text-right">Total semana</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={fila.id} className="border-b border-borde last:border-b-0">
                  <td className="px-3 py-2 align-top font-medium text-ink">{fila.nombre}</td>
                  {dias.map((dia) => {
                    const clave = `${fila.id}|${dia}`;
                    const turnosCelda = turnosPorCelda.get(clave) ?? [];
                    return (
                      <td key={dia} className="group px-2 py-2 align-top">
                        <div className="flex flex-col gap-1">
                          {turnosCelda.map((turno) => (
                            <button
                              key={turno.id}
                              type="button"
                              disabled={!esAdmin}
                              onClick={() => esAdmin && abrirEditar(turno)}
                              className={`rounded-control border px-1.5 py-1 text-left text-xs transition-colors ${
                                resaltadoId === turno.id
                                  ? "border-critico bg-critico/10 text-critico"
                                  : "border-borde bg-plano text-ink hover:bg-black/5 dark:hover:bg-white/5"
                              } ${esAdmin ? "cursor-pointer" : "cursor-default"}`}
                            >
                              {horaBogotaDeInstante(turno.inicio)}–{horaBogotaDeInstante(turno.fin)}
                              {resaltadoId === turno.id ? (
                                <span className="mt-0.5 block text-[10px] font-medium">Choca con este turno</span>
                              ) : null}
                            </button>
                          ))}
                          {esAdmin ? (
                            <button
                              type="button"
                              onClick={() => abrirCrear(fila.id, fila.nombre, dia)}
                              className="flex items-center justify-center rounded-control border border-dashed border-borde py-1 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 hover:border-secundario hover:text-secundario-texto"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right align-top tabular-nums text-ink">
                    {(horasPorUsuario[fila.id] ?? 0).toFixed(1)} h
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}

      <Dialogo
        abierto={dialogo !== null}
        onCambiarAbierto={(abierto) => !abierto && setDialogo(null)}
        titulo={dialogo?.tipo === "crear" ? `Nuevo turno — ${dialogo.nombreUsuario}` : "Editar turno"}
        descripcion="La hora es local de Bogotá. Si el fin no es posterior al inicio, el turno se interpreta como nocturno y termina al día siguiente."
        textoConfirmar={guardando ? "Guardando…" : "Guardar"}
        varianteConfirmar="principal"
        confirmando={guardando}
        onConfirmar={guardarTurno}
      >
        <Campo etiqueta="Fecha">
          {(p) => (
            <EntradaCampo
              {...p}
              type="date"
              value={formulario.fecha}
              onChange={(e) => setFormulario((f) => ({ ...f, fecha: e.target.value }))}
            />
          )}
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Hora inicio">
            {(p) => (
              <EntradaCampo
                {...p}
                type="time"
                value={formulario.horaInicio}
                onChange={(e) => setFormulario((f) => ({ ...f, horaInicio: e.target.value }))}
              />
            )}
          </Campo>
          <Campo etiqueta="Hora fin">
            {(p) => (
              <EntradaCampo
                {...p}
                type="time"
                value={formulario.horaFin}
                onChange={(e) => setFormulario((f) => ({ ...f, horaFin: e.target.value }))}
              />
            )}
          </Campo>
        </div>
        <Campo etiqueta="Notas" ayuda="Opcional.">
          {(p) => (
            <EntradaCampo
              {...p}
              value={formulario.notas}
              onChange={(e) => setFormulario((f) => ({ ...f, notas: e.target.value }))}
            />
          )}
        </Campo>
        {dialogo?.tipo === "editar" ? (
          <Boton
            type="button"
            variante="destructivo"
            className="w-full"
            onClick={() => {
              setConfirmandoBorrar(dialogo.turno);
              setDialogo(null);
            }}
          >
            <Trash2 />
            Borrar turno
          </Boton>
        ) : null}
        {errorFormulario ? <Aviso variante="critico">{errorFormulario}</Aviso> : null}
      </Dialogo>

      <Dialogo
        abierto={confirmandoBorrar !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmandoBorrar(null)}
        titulo="Borrar turno"
        descripcion={
          confirmandoBorrar
            ? `Se borrará el turno de ${confirmandoBorrar.usuario.nombre} del ${formatearEncabezadoDia(
                fechaBogotaDeInstante(confirmandoBorrar.inicio),
              )}.`
            : undefined
        }
        textoConfirmar={borrando ? "Borrando…" : "Borrar"}
        confirmando={borrando}
        onConfirmar={confirmarBorrar}
      />
    </div>
  );
}
