"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { satisfaceRol, type Rol } from "@/lib/rol";
import { bogotaAInstanteUTC, fechaBogotaDeInstante, horaBogotaDeInstante, hoyBogotaISO } from "@/lib/bogota";
import { Boton } from "@/components/ui/boton";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Dialogo } from "@/components/ui/dialogo";
import { Esqueleto } from "@/components/ui/cargando";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { Pastilla } from "@/components/ui/pastilla";
import {
  Tabla,
  TablaCabecera,
  TablaCelda,
  TablaCeldaCabecera,
  TablaCuerpo,
  TablaFila,
} from "@/components/ui/tabla";

type Estado = "PENDIENTE" | "APROBADA" | "RECHAZADA";

interface HoraAdicional {
  id: string;
  usuarioId: string;
  usuario: { id: string; nombre: string };
  inicio: string;
  fin: string;
  motivo: string | null;
  estado: Estado;
}

interface FilaResumen {
  usuarioId: string;
  usuario: { id: string; nombre: string };
  ordinarias: number;
  dominicalesFestivas: number;
  pendientes: number;
}

interface UsuarioFila {
  id: string;
  nombre: string;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

function codigoDeError(errorRespuesta: unknown): string | undefined {
  return (errorRespuesta as { value?: { error?: { codigo?: string } } } | undefined)?.value?.error?.codigo;
}

/** Primer y último día (YYYY-MM-DD) del mes de calendario de Bogotá al que pertenece `fechaISO`. */
function rangoMesISO(fechaISO: string): { desde: string; hasta: string } {
  const [anio, mes] = fechaISO.split("-").map(Number);
  const primero = new Date(Date.UTC(anio, mes - 1, 1)).toISOString().slice(0, 10);
  const ultimo = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
  return { desde: primero, hasta: ultimo };
}

const ESTADO_PASTILLA: Record<Estado, { tono: "aviso" | "bien" | "critico"; icono: typeof Clock; texto: string }> = {
  PENDIENTE: { tono: "aviso", icono: Clock, texto: "Pendiente" },
  APROBADA: { tono: "bien", icono: CheckCircle2, texto: "Aprobada" },
  RECHAZADA: { tono: "critico", icono: XCircle, texto: "Rechazada" },
};

interface FormularioHora {
  usuarioId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  motivo: string;
}

/**
 * ES UN REGISTRO, NO UNA NÓMINA (CLAUDE.md F6.3): esta pantalla no calcula
 * ningún recargo legal ni clasifica jornada nocturna. Solo registra cuántas
 * horas y, al aprobar, cuántas de esas son festivas o domingo — eso lo
 * decide quien liquida, con sus propias reglas.
 */
export function HorasAdicionalesContenido({
  rol,
  usuarioPropio,
}: {
  rol: Rol;
  usuarioPropio: { id: string; nombre: string };
}) {
  const esAdmin = satisfaceRol(rol, "ADMIN");

  const [{ desde, hasta }, setRango] = useState(() => rangoMesISO(hoyBogotaISO()));
  const [filtroEstado, setFiltroEstado] = useState<Estado | "">("");

  const [horas, setHoras] = useState<HoraAdicional[]>([]);
  const [resumen, setResumen] = useState<FilaResumen[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioFila[]>([]);
  const [festivoPorFecha, setFestivoPorFecha] = useState<Record<string, string>>({});

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [errorFila, setErrorFila] = useState<string | null>(null);

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [formulario, setFormulario] = useState<FormularioHora>({
    usuarioId: usuarioPropio.id,
    fecha: hoyBogotaISO(),
    horaInicio: "20:00",
    horaFin: "22:00",
    motivo: "",
  });
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [resaltadoId, setResaltadoId] = useState<string | null>(null);

  const [confirmandoBorrar, setConfirmandoBorrar] = useState<HoraAdicional | null>(null);
  const [borrando, setBorrando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);

    const anios = [...new Set([desde.slice(0, 4), hasta.slice(0, 4)])];

    const [resHoras, resResumen, resUsuarios, ...resFestivos] = await Promise.all([
      api["horas-adicionales"].get({ query: { desde, hasta, ...(filtroEstado ? { estado: filtroEstado } : {}) } }),
      esAdmin ? api["horas-adicionales"].resumen.get({ query: { desde, hasta } }) : Promise.resolve(null),
      esAdmin ? api.usuarios.get() : Promise.resolve(null),
      ...anios.map((anio) => api.festivos.get({ query: { anio } })),
    ]);

    if (resHoras.error || !resHoras.data) {
      setErrorCarga(mensajeDeError(resHoras.error));
      setCargando(false);
      return;
    }
    setHoras(resHoras.data.horasAdicionales);
    setResumen(resResumen?.data?.resumen ?? []);

    if (esAdmin && resUsuarios?.data) {
      setUsuarios(
        resUsuarios.data.usuarios
          .filter((u) => u.activo && satisfaceRol(u.rol as Rol, "EMPLEADO"))
          .map((u) => ({ id: u.id, nombre: u.nombre })),
      );
    } else {
      setUsuarios([{ id: usuarioPropio.id, nombre: usuarioPropio.nombre }]);
    }

    const festivos: Record<string, string> = {};
    for (const res of resFestivos) {
      if (res?.data) {
        for (const festivo of res.data.festivos) festivos[festivo.fecha.slice(0, 10)] = festivo.nombre;
      }
    }
    setFestivoPorFecha(festivos);

    setCargando(false);
  }, [desde, hasta, filtroEstado, esAdmin, usuarioPropio.id, usuarioPropio.nombre]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function esFestivoODomingo(iso: string): boolean {
    const fecha = fechaBogotaDeInstante(iso);
    return Boolean(festivoPorFecha[fecha]) || new Date(fecha + "T00:00:00Z").getUTCDay() === 0;
  }

  function abrirCrear() {
    setErrorFormulario(null);
    setFormulario({ usuarioId: usuarioPropio.id, fecha: hoyBogotaISO(), horaInicio: "20:00", horaFin: "22:00", motivo: "" });
    setDialogoAbierto(true);
  }

  async function guardarHora() {
    setGuardando(true);
    setErrorFormulario(null);

    const inicio = bogotaAInstanteUTC(formulario.fecha, formulario.horaInicio);
    // El fin puede caer al día siguiente (p. ej. 20:00–02:00): si no es
    // posterior al inicio, se interpreta como el mismo reloj al día
    // siguiente — igual que un turno nocturno.
    let fin = bogotaAInstanteUTC(formulario.fecha, formulario.horaFin);
    if (new Date(fin) <= new Date(inicio)) {
      const [anio, mes, dia] = formulario.fecha.split("-").map(Number);
      const siguiente = new Date(Date.UTC(anio, mes - 1, dia + 1)).toISOString().slice(0, 10);
      fin = bogotaAInstanteUTC(siguiente, formulario.horaFin);
    }

    const { error } = await api["horas-adicionales"].post({
      usuarioId: esAdmin ? formulario.usuarioId : undefined,
      inicio,
      fin,
      motivo: formulario.motivo || undefined,
    });

    setGuardando(false);
    if (error) {
      const codigo = codigoDeError(error);
      if (codigo === "SOLAPA_CON_HORA_ADICIONAL") {
        const idChoque = mensajeDeError(error).match(/\(id ([^)]+)\)/)?.[1];
        if (idChoque) {
          setResaltadoId(idChoque);
          setTimeout(() => setResaltadoId(null), 4000);
        }
      }
      setErrorFormulario(mensajeDeError(error));
      return;
    }

    setDialogoAbierto(false);
    cargar();
  }

  async function aprobar(hora: HoraAdicional) {
    setErrorFila(null);
    const { error } = await api["horas-adicionales"]({ id: hora.id }).aprobar.patch();
    if (error) {
      setErrorFila(mensajeDeError(error));
      return;
    }
    cargar();
  }

  async function rechazar(hora: HoraAdicional) {
    setErrorFila(null);
    const { error } = await api["horas-adicionales"]({ id: hora.id }).rechazar.patch();
    if (error) {
      setErrorFila(mensajeDeError(error));
      return;
    }
    cargar();
  }

  async function confirmarBorrar() {
    if (!confirmandoBorrar) return;
    setBorrando(true);
    const { error } = await api["horas-adicionales"]({ id: confirmandoBorrar.id }).delete();
    setBorrando(false);
    if (error) {
      setErrorFila(mensajeDeError(error));
      setConfirmandoBorrar(null);
      return;
    }
    setConfirmandoBorrar(null);
    cargar();
  }

  const nombreUsuario = useMemo(() => {
    const mapa = new Map(usuarios.map((u) => [u.id, u.nombre]));
    return (id: string) => mapa.get(id) ?? "—";
  }, [usuarios]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Horas adicionales</h1>
          <p className="cuerpo text-ink-muted">
            {esAdmin
              ? "Registro de horas adicionales y festivas del equipo. Esto no liquida nómina: solo lleva la cuenta."
              : "Tus horas adicionales y festivas. Esto no liquida nómina: solo lleva la cuenta."}
          </p>
        </div>
        <Boton variante="principal" onClick={abrirCrear}>
          <Plus />
          Registrar horas
        </Boton>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Desde">
          {(p) => (
            <EntradaCampo
              {...p}
              type="date"
              value={desde}
              onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))}
            />
          )}
        </Campo>
        <Campo etiqueta="Hasta">
          {(p) => (
            <EntradaCampo
              {...p}
              type="date"
              value={hasta}
              onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))}
            />
          )}
        </Campo>
        <Campo etiqueta="Estado">
          {(p) => (
            <SelectCampo
              {...p}
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value as Estado | "")}
            >
              <option value="">Todas</option>
              <option value="PENDIENTE">Pendiente</option>
              <option value="APROBADA">Aprobada</option>
              <option value="RECHAZADA">Rechazada</option>
            </SelectCampo>
          )}
        </Campo>
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

      {errorFila ? <Aviso variante="critico">{errorFila}</Aviso> : null}

      {cargando ? (
        <div className="space-y-2">
          <Esqueleto className="h-10 w-full" />
          <Esqueleto className="h-24 w-full" />
          <Esqueleto className="h-24 w-full" />
        </div>
      ) : (
        <>
          {esAdmin && resumen.length > 0 ? (
            <Tarjeta>
              <TarjetaCabecera titulo="Resumen del período" />
              <Tabla>
                <TablaCabecera>
                  <TablaFila>
                    <TablaCeldaCabecera>Empleado</TablaCeldaCabecera>
                    <TablaCeldaCabecera className="text-right">Ordinarias</TablaCeldaCabecera>
                    <TablaCeldaCabecera className="text-right">Dominicales/festivas</TablaCeldaCabecera>
                    <TablaCeldaCabecera className="text-right">Por revisar</TablaCeldaCabecera>
                  </TablaFila>
                </TablaCabecera>
                <TablaCuerpo>
                  {resumen.map((fila) => (
                    <TablaFila key={fila.usuarioId}>
                      <TablaCelda className="font-medium text-ink">{fila.usuario.nombre}</TablaCelda>
                      <TablaCelda className="text-right tabular-nums">{fila.ordinarias.toFixed(1)} h</TablaCelda>
                      <TablaCelda className="text-right tabular-nums">
                        {fila.dominicalesFestivas.toFixed(1)} h
                      </TablaCelda>
                      <TablaCelda className="text-right tabular-nums">
                        {fila.pendientes > 0 ? (
                          <span className="font-medium text-aviso">{fila.pendientes}</span>
                        ) : (
                          "—"
                        )}
                      </TablaCelda>
                    </TablaFila>
                  ))}
                </TablaCuerpo>
              </Tabla>
            </Tarjeta>
          ) : null}

          <Tarjeta className="p-0">
            {horas.length === 0 ? (
              <EstadoVacio
                icono={Clock}
                titulo="Sin horas adicionales en este período"
                descripcion="Registra un bloque de horas adicionales o festivas trabajadas."
                accion={
                  <Boton variante="contorno" onClick={abrirCrear}>
                    <Plus />
                    Registrar horas
                  </Boton>
                }
                className="border-0"
              />
            ) : (
              <Tabla>
                <TablaCabecera>
                  <TablaFila>
                    {esAdmin ? <TablaCeldaCabecera>Empleado</TablaCeldaCabecera> : null}
                    <TablaCeldaCabecera>Día</TablaCeldaCabecera>
                    <TablaCeldaCabecera>Horario</TablaCeldaCabecera>
                    <TablaCeldaCabecera>Motivo</TablaCeldaCabecera>
                    <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
                    <TablaCeldaCabecera className="text-right">Acciones</TablaCeldaCabecera>
                  </TablaFila>
                </TablaCabecera>
                <TablaCuerpo>
                  {horas.map((hora) => {
                    const estado = ESTADO_PASTILLA[hora.estado];
                    const esPropia = hora.usuarioId === usuarioPropio.id;
                    const puedeEditar = hora.estado === "PENDIENTE" && (esAdmin || esPropia);
                    return (
                      <TablaFila
                        key={hora.id}
                        className={resaltadoId === hora.id ? "border-l-4 border-l-critico bg-critico/5" : undefined}
                      >
                        {esAdmin ? <TablaCelda className="font-medium text-ink">{hora.usuario.nombre}</TablaCelda> : null}
                        <TablaCelda>
                          <div className="flex items-center gap-1.5">
                            {fechaBogotaDeInstante(hora.inicio)}
                            {esFestivoODomingo(hora.inicio) ? (
                              <span className="rounded-pastilla bg-secundario-suave px-1.5 py-0.5 text-[11px] font-medium text-secundario-texto">
                                {festivoPorFecha[fechaBogotaDeInstante(hora.inicio)] ?? "Domingo"}
                              </span>
                            ) : null}
                          </div>
                        </TablaCelda>
                        <TablaCelda className="tabular-nums">
                          {horaBogotaDeInstante(hora.inicio)}–{horaBogotaDeInstante(hora.fin)}
                        </TablaCelda>
                        <TablaCelda className="text-ink-2">{hora.motivo ?? "—"}</TablaCelda>
                        <TablaCelda>
                          <Pastilla tono={estado.tono} icono={estado.icono}>
                            {estado.texto}
                          </Pastilla>
                          {resaltadoId === hora.id ? (
                            <p className="mt-1 text-[11px] font-medium text-critico">Choca con este registro</p>
                          ) : null}
                        </TablaCelda>
                        <TablaCelda className="text-right">
                          <div className="flex justify-end gap-2">
                            {esAdmin && hora.estado === "PENDIENTE" ? (
                              <>
                                <Boton variante="contorno" tamano="sm" onClick={() => aprobar(hora)}>
                                  <CheckCircle2 />
                                  Aprobar
                                </Boton>
                                <Boton variante="destructivo" tamano="sm" onClick={() => rechazar(hora)}>
                                  <XCircle />
                                  Rechazar
                                </Boton>
                              </>
                            ) : null}
                            {puedeEditar ? (
                              <Boton
                                variante="fantasma"
                                tamano="sm"
                                onClick={() => setConfirmandoBorrar(hora)}
                                aria-label="Borrar"
                              >
                                <Trash2 />
                              </Boton>
                            ) : null}
                          </div>
                        </TablaCelda>
                      </TablaFila>
                    );
                  })}
                </TablaCuerpo>
              </Tabla>
            )}
          </Tarjeta>
        </>
      )}

      <Dialogo
        abierto={dialogoAbierto}
        onCambiarAbierto={setDialogoAbierto}
        titulo="Registrar horas adicionales"
        descripcion="La hora es local de Bogotá. Si el fin no es posterior al inicio, el bloque se interpreta como nocturno y termina al día siguiente."
        textoConfirmar={guardando ? "Guardando…" : "Guardar"}
        varianteConfirmar="principal"
        confirmando={guardando}
        onConfirmar={guardarHora}
      >
        {esAdmin && usuarios.length > 1 ? (
          <Campo etiqueta="Empleado">
            {(p) => (
              <SelectCampo
                {...p}
                value={formulario.usuarioId}
                onChange={(e) => setFormulario((f) => ({ ...f, usuarioId: e.target.value }))}
              >
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </SelectCampo>
            )}
          </Campo>
        ) : null}
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
        <Campo etiqueta="Motivo" ayuda="Opcional.">
          {(p) => (
            <EntradaCampo
              {...p}
              value={formulario.motivo}
              onChange={(e) => setFormulario((f) => ({ ...f, motivo: e.target.value }))}
            />
          )}
        </Campo>
        {errorFormulario ? <Aviso variante="critico">{errorFormulario}</Aviso> : null}
      </Dialogo>

      <Dialogo
        abierto={confirmandoBorrar !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmandoBorrar(null)}
        titulo="Borrar horas adicionales"
        descripcion={
          confirmandoBorrar
            ? `Se borrará el registro de ${nombreUsuario(confirmandoBorrar.usuarioId)} del ${fechaBogotaDeInstante(
                confirmandoBorrar.inicio,
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
