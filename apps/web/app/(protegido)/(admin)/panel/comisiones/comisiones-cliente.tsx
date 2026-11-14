"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Percent, PiggyBank, Users2 } from "lucide-react";
import { api } from "@/lib/api";
import { hoyBogotaISO, sumarDiasISO, fechaBogotaDeInstante } from "@/lib/bogota";
import { Boton } from "@/components/ui/boton";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Esqueleto } from "@/components/ui/cargando";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { Pastilla } from "@/components/ui/pastilla";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

type Modo = "PORCENTAJE_VENTA" | "FIJO_POR_PANTALLA";
type Ambito = "TOTAL" | "POR_PLATAFORMA";
type Periodo = "DIA" | "MES";

interface Configuracion {
  id: string;
  modo: Modo;
  valor: string;
  umbralCantidad: number;
  umbralAmbito: Ambito;
  umbralPeriodo: Periodo;
  vigenteDesde: string;
  creadaPor: { id: string; nombre: string };
  createdAt: string;
}

interface FilaPeriodo {
  periodoInicio: string;
  pantallasVendidas: number;
  pantallasAbsorbidas: number;
  pantallasComisionadas: number;
  porcentajeComisionado: number;
  pozoTotal: string;
}

interface Simulacion {
  pantallasVendidas: number;
  pantallasAbsorbidas: number;
  pantallasComisionadas: number;
  porcentajeComisionado: number;
  pozoTotal: string;
  porPeriodo: FilaPeriodo[];
}

interface FilaResumenUsuario {
  usuarioId: string;
  nombre: string;
  horas: number;
  tajadaCerrada: string;
  tajadaProvisional: string;
}

interface Resumen {
  configurada: boolean;
  pozoTotal: string;
  pozoSinRepartir: string;
  pantallasComisionadas: number;
  porUsuario: FilaResumenUsuario[];
}

// Igual que en estadisticas-contenido.tsx/dashboard-cliente.tsx (CLAUDE.md:
// Decimal como string, nunca Number para dinero).
function formatearPesos(valor: string): string {
  const negativo = valor.startsWith("-");
  const [entero] = (negativo ? valor.slice(1) : valor).split(".");
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}$${conMiles}`;
}

function etiquetaModo(modo: Modo): string {
  return modo === "PORCENTAJE_VENTA" ? "Porcentaje de la venta" : "Monto fijo por pantalla";
}

function etiquetaValor(modo: Modo, valor: string): string {
  return modo === "PORCENTAJE_VENTA" ? `${valor}%` : formatearPesos(valor);
}

function etiquetaUmbral(cantidad: number, ambito: Ambito, periodo: Periodo): string {
  const porAmbito = ambito === "TOTAL" ? "en total" : "por plataforma";
  const porPeriodo = periodo === "DIA" ? "por día" : "por mes";
  return cantidad === 0 ? "Sin umbral: todo comisiona" : `Primeras ${cantidad} pantallas ${porAmbito} ${porPeriodo} no comisionan`;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

function etiquetaPeriodo(iso: string, periodo: Periodo): string {
  const fecha = fechaBogotaDeInstante(iso);
  if (periodo === "DIA") {
    const [, mes, dia] = fecha.split("-").map(Number);
    const nombreMes = new Date(Date.UTC(2000, mes - 1, 1)).toLocaleDateString("es-CO", { month: "short" });
    return `${dia} ${nombreMes}`;
  }
  const [anio, mes] = fecha.split("-").map(Number);
  const nombreMes = new Date(Date.UTC(2000, mes - 1, 1)).toLocaleDateString("es-CO", { month: "long" });
  return `${nombreMes} ${anio}`;
}

/** Mes de calendario (Bogotá) anterior al de `hoyISO`, completo — primer y último día. */
function mesAnteriorCompletoISO(hoyISO: string): { desde: string; hasta: string } {
  const [anio, mes] = hoyISO.split("-").map(Number);
  const anioAjustado = mes === 1 ? anio - 1 : anio;
  const mesAjustado = mes === 1 ? 12 : mes - 1;
  const dosDigitos = (n: number) => String(n).padStart(2, "0");
  const ultimoDia = new Date(Date.UTC(anioAjustado, mesAjustado, 0)).getUTCDate();
  return {
    desde: `${anioAjustado}-${dosDigitos(mesAjustado)}-01`,
    hasta: `${anioAjustado}-${dosDigitos(mesAjustado)}-${dosDigitos(ultimoDia)}`,
  };
}

/** Con umbralPeriodo MES, un borde que no cae en día 1 o último día del mes parte un mes en dos — el contador del umbral solo ve la parte dentro del rango. */
function rangoConMesesIncompletos(desdeISO: string, hastaISO: string): boolean {
  const [, , diaDesde] = desdeISO.split("-").map(Number);
  if (diaDesde !== 1) return true;
  const [anioHasta, mesHasta, diaHasta] = hastaISO.split("-").map(Number);
  const ultimoDiaHasta = new Date(Date.UTC(anioHasta, mesHasta, 0)).getUTCDate();
  return diaHasta !== ultimoDiaHasta;
}

interface ParametrosForma {
  modo: Modo;
  valor: string;
  umbralCantidad: string;
  umbralAmbito: Ambito;
  umbralPeriodo: Periodo;
}

const PARAMETROS_POR_DEFECTO: ParametrosForma = {
  modo: "FIJO_POR_PANTALLA",
  valor: "",
  umbralCantidad: "0",
  umbralAmbito: "TOTAL",
  umbralPeriodo: "DIA",
};

function valorEsValido(parametros: ParametrosForma): boolean {
  const valor = Number(parametros.valor);
  if (!Number.isFinite(valor) || valor <= 0) return false;
  if (parametros.modo === "PORCENTAJE_VENTA" && valor > 100) return false;
  const umbral = Number(parametros.umbralCantidad);
  return Number.isInteger(umbral) && umbral >= 0;
}

export default function ComisionesCliente() {
  const hoy = useMemo(() => hoyBogotaISO(), []);
  const [desde, setDesde] = useState(() => sumarDiasISO(hoy, -30));
  const [hasta, setHasta] = useState(hoy);

  const [parametros, setParametros] = useState<ParametrosForma>(PARAMETROS_POR_DEFECTO);

  const [vigente, setVigente] = useState<Configuracion | null>(null);
  const [historial, setHistorial] = useState<Configuracion[]>([]);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);
  const [cargandoConfiguracion, setCargandoConfiguracion] = useState(true);
  const [errorConfiguracion, setErrorConfiguracion] = useState<string | null>(null);

  const [simulacion, setSimulacion] = useState<Simulacion | null>(null);
  const [cargandoSimulacion, setCargandoSimulacion] = useState(false);
  const [errorSimulacion, setErrorSimulacion] = useState<string | null>(null);

  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(true);
  const [errorResumen, setErrorResumen] = useState<string | null>(null);

  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [guardadoOk, setGuardadoOk] = useState(false);

  const cargarConfiguracion = useCallback(async () => {
    setCargandoConfiguracion(true);
    setErrorConfiguracion(null);

    const [resVigente, resHistorial] = await Promise.all([
      api.comisiones.configuracion.get(),
      api.comisiones.configuracion.historial.get(),
    ]);

    if (resVigente.error || !resVigente.data) {
      setErrorConfiguracion(mensajeDeError(resVigente.error));
      setCargandoConfiguracion(false);
      return;
    }

    setVigente(resVigente.data.configuracion);
    setHistorial(resHistorial.data?.versiones ?? []);
    if (resVigente.data.configuracion) {
      const c = resVigente.data.configuracion;
      setParametros({
        modo: c.modo,
        valor: c.valor,
        umbralCantidad: String(c.umbralCantidad),
        umbralAmbito: c.umbralAmbito,
        umbralPeriodo: c.umbralPeriodo,
      });
    }
    setCargandoConfiguracion(false);
  }, []);

  useEffect(() => {
    cargarConfiguracion();
  }, [cargarConfiguracion]);

  // Con umbralPeriodo MES, 30 días corridos parten dos meses por la mitad y
  // el contador del umbral de cada uno solo ve su parte dentro del rango —
  // "pantallas absorbidas" saldría sobre un mes incompleto. El rango por
  // defecto para MES es el mes de calendario anterior, completo.
  useEffect(() => {
    if (parametros.umbralPeriodo === "MES") {
      const { desde: d, hasta: h } = mesAnteriorCompletoISO(hoy);
      setDesde(d);
      setHasta(h);
    }
  }, [parametros.umbralPeriodo, hoy]);

  const mesesIncompletos = parametros.umbralPeriodo === "MES" && Boolean(desde) && Boolean(hasta) && rangoConMesesIncompletos(desde, hasta);

  // Simulador: recalcula en vivo con lo que haya en los controles, nunca con
  // la configuración guardada (PROMPT-F6.5, Parte 3) — así se puede mover el
  // número y ver el efecto antes de decidir si se guarda.
  useEffect(() => {
    if (!valorEsValido(parametros) || !desde || !hasta) {
      setSimulacion(null);
      setErrorSimulacion(null);
      return;
    }

    let activo = true;
    const manija = setTimeout(async () => {
      setCargandoSimulacion(true);
      setErrorSimulacion(null);

      const { data, error } = await api.comisiones.simulacion.get({
        query: {
          desde,
          hasta,
          modo: parametros.modo,
          valor: parametros.valor,
          umbralCantidad: Number(parametros.umbralCantidad),
          umbralAmbito: parametros.umbralAmbito,
          umbralPeriodo: parametros.umbralPeriodo,
        },
      });
      if (!activo) return;

      if (error || !data) {
        setErrorSimulacion(mensajeDeError(error));
        setSimulacion(null);
      } else {
        setSimulacion(data);
      }
      setCargandoSimulacion(false);
    }, 300);

    return () => {
      activo = false;
      clearTimeout(manija);
    };
  }, [parametros, desde, hasta]);

  // Resumen por persona: a diferencia del simulador, siempre usa la política
  // guardada (ConfiguracionComision vigente), no los controles del
  // formulario — es el cálculo real (PROMPT-F6.6), no una simulación.
  useEffect(() => {
    if (!desde || !hasta) return;
    let activo = true;
    (async () => {
      setCargandoResumen(true);
      setErrorResumen(null);
      const { data, error } = await api.comisiones.resumen.get({ query: { desde, hasta } });
      if (!activo) return;
      if (error || !data) {
        setErrorResumen(mensajeDeError(error));
        setResumen(null);
      } else {
        setResumen(data);
      }
      setCargandoResumen(false);
    })();
    return () => {
      activo = false;
    };
  }, [desde, hasta]);

  async function guardar() {
    if (!valorEsValido(parametros)) return;
    setGuardando(true);
    setErrorGuardado(null);
    setGuardadoOk(false);

    const { error } = await api.comisiones.configuracion.put({
      modo: parametros.modo,
      valor: parametros.valor,
      umbralCantidad: Number(parametros.umbralCantidad),
      umbralAmbito: parametros.umbralAmbito,
      umbralPeriodo: parametros.umbralPeriodo,
    });

    setGuardando(false);
    if (error) {
      setErrorGuardado(mensajeDeError(error));
      return;
    }
    await cargarConfiguracion();
    setGuardadoOk(true);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina text-ink">Comisiones</h1>
        <p className="cuerpo text-ink-muted">
          Define la política de comisiones y simula su efecto sobre ventas reales antes de guardarla.
        </p>
      </div>

      {errorConfiguracion ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar"
          accion={
            <Boton variante="contorno" onClick={cargarConfiguracion}>
              Reintentar
            </Boton>
          }
        >
          {errorConfiguracion}
        </Aviso>
      ) : null}

      {cargandoConfiguracion ? (
        <Esqueleto className="h-24 w-full" />
      ) : (
        <Tarjeta>
          <TarjetaCabecera
            titulo="Versión vigente"
            accion={
              historial.length > 0 ? (
                <Boton variante="contorno" tamano="sm" onClick={() => setMostrarHistorial((v) => !v)}>
                  <History />
                  {mostrarHistorial ? "Ocultar historial" : `Historial (${historial.length})`}
                </Boton>
              ) : null
            }
          />
          {vigente ? (
            <div className="flex flex-wrap items-center gap-3">
              <Pastilla tono="secundario" icono={Percent}>
                {etiquetaModo(vigente.modo)} · {etiquetaValor(vigente.modo, vigente.valor)}
              </Pastilla>
              <span className="cuerpo text-ink-muted">
                {etiquetaUmbral(vigente.umbralCantidad, vigente.umbralAmbito, vigente.umbralPeriodo)}
              </span>
              <span className="text-xs text-ink-muted">
                Vigente desde {fechaBogotaDeInstante(vigente.vigenteDesde)} · guardada por {vigente.creadaPor.nombre}
              </span>
            </div>
          ) : (
            <p className="cuerpo text-ink-muted">Todavía no hay una política de comisiones guardada.</p>
          )}

          {mostrarHistorial && historial.length > 0 ? (
            <div className="mt-4 border-t border-borde pt-4">
              <Tabla>
                <TablaCabecera>
                  <TablaFila>
                    <TablaCeldaCabecera>Modo</TablaCeldaCabecera>
                    <TablaCeldaCabecera>Valor</TablaCeldaCabecera>
                    <TablaCeldaCabecera>Umbral</TablaCeldaCabecera>
                    <TablaCeldaCabecera>Vigente desde</TablaCeldaCabecera>
                    <TablaCeldaCabecera>Guardada por</TablaCeldaCabecera>
                  </TablaFila>
                </TablaCabecera>
                <TablaCuerpo>
                  {historial.map((version) => (
                    <TablaFila key={version.id}>
                      <TablaCelda>{etiquetaModo(version.modo)}</TablaCelda>
                      <TablaCelda>{etiquetaValor(version.modo, version.valor)}</TablaCelda>
                      <TablaCelda>{etiquetaUmbral(version.umbralCantidad, version.umbralAmbito, version.umbralPeriodo)}</TablaCelda>
                      <TablaCelda>{fechaBogotaDeInstante(version.vigenteDesde)}</TablaCelda>
                      <TablaCelda>{version.creadaPor.nombre}</TablaCelda>
                    </TablaFila>
                  ))}
                </TablaCuerpo>
              </Tabla>
            </div>
          ) : null}
        </Tarjeta>
      )}

      <Tarjeta>
        <TarjetaCabecera
          titulo="Resumen del período"
          accion={<Pastilla tono="secundario" icono={Users2}>{desde} – {hasta}</Pastilla>}
        />
        {errorResumen ? <Aviso variante="critico">{errorResumen}</Aviso> : null}

        {cargandoResumen && !resumen ? (
          <Esqueleto className="h-24 w-full" />
        ) : !resumen?.configurada ? (
          <p className="cuerpo text-ink-muted">Todavía no hay una política de comisiones guardada.</p>
        ) : (
          <>
            <div className="rounded-control border border-borde bg-plano p-4">
              <p className="cuerpo text-ink-muted">
                Pozo total: <span className="font-semibold text-ink">{formatearPesos(resumen.pozoTotal)}</span>
                {" · "}
                {resumen.pantallasComisionadas} pantallas comisionadas
              </p>
            </div>

            {resumen.pozoSinRepartir !== "0" ? (
              <Aviso variante="aviso" className="mt-4">
                {formatearPesos(resumen.pozoSinRepartir)} sin repartir: hubo pozo en algún día pero nadie estuvo de
                turno. No se reparte entre quienes no estuvieron.
              </Aviso>
            ) : null}

            {resumen.porUsuario.length === 0 ? (
              <EstadoVacio icono={PiggyBank} titulo="Nadie de turno con comisión en el rango elegido" className="mt-4" />
            ) : (
              <div className="mt-4">
                <Tabla>
                  <TablaCabecera>
                    <TablaFila>
                      <TablaCeldaCabecera>Persona</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Horas</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Cerrado</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Hoy (provisional)</TablaCeldaCabecera>
                    </TablaFila>
                  </TablaCabecera>
                  <TablaCuerpo>
                    {resumen.porUsuario.map((fila) => (
                      <TablaFila key={fila.usuarioId}>
                        <TablaCelda>{fila.nombre}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{fila.horas.toFixed(1)}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.tajadaCerrada)}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.tajadaProvisional)}</TablaCelda>
                      </TablaFila>
                    ))}
                  </TablaCuerpo>
                </Tabla>
              </div>
            )}
          </>
        )}
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Simulador" />
        <Aviso variante="info" className="mb-4">
          Esto es una simulación: no se guarda nada hasta que presiones "Guardar política" abajo, y guardar
          tampoco liquida comisiones a nadie — eso se hace en otra pantalla.
        </Aviso>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo etiqueta="Modo">
            {(p) => (
              <SelectCampo
                {...p}
                value={parametros.modo}
                onChange={(e) => setParametros((f) => ({ ...f, modo: e.target.value as Modo }))}
              >
                <option value="FIJO_POR_PANTALLA">Monto fijo por pantalla</option>
                <option value="PORCENTAJE_VENTA">Porcentaje de la venta</option>
              </SelectCampo>
            )}
          </Campo>

          <Campo
            etiqueta={parametros.modo === "PORCENTAJE_VENTA" ? "Porcentaje (%)" : "Monto fijo ($)"}
            ayuda={parametros.modo === "PORCENTAJE_VENTA" ? "Entre 0 y 100." : "Por cada pantalla comisionada."}
          >
            {(p) => (
              <EntradaCampo
                {...p}
                type="number"
                min={0}
                max={parametros.modo === "PORCENTAJE_VENTA" ? 100 : undefined}
                step="0.01"
                value={parametros.valor}
                onChange={(e) => setParametros((f) => ({ ...f, valor: e.target.value }))}
              />
            )}
          </Campo>

          <Campo etiqueta="Umbral (cantidad)" ayuda="0 = todo comisiona.">
            {(p) => (
              <EntradaCampo
                {...p}
                type="number"
                min={0}
                step="1"
                value={parametros.umbralCantidad}
                onChange={(e) => setParametros((f) => ({ ...f, umbralCantidad: e.target.value }))}
              />
            )}
          </Campo>

          <Campo etiqueta="Ámbito del umbral">
            {(p) => (
              <SelectCampo
                {...p}
                value={parametros.umbralAmbito}
                onChange={(e) => setParametros((f) => ({ ...f, umbralAmbito: e.target.value as Ambito }))}
              >
                <option value="TOTAL">Total de la empresa</option>
                <option value="POR_PLATAFORMA">Por plataforma</option>
              </SelectCampo>
            )}
          </Campo>

          <Campo etiqueta="Período del umbral">
            {(p) => (
              <SelectCampo
                {...p}
                value={parametros.umbralPeriodo}
                onChange={(e) => setParametros((f) => ({ ...f, umbralPeriodo: e.target.value as Periodo }))}
              >
                <option value="DIA">Por día</option>
                <option value="MES">Por mes</option>
              </SelectCampo>
            )}
          </Campo>

          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Desde">
              {(p) => <EntradaCampo {...p} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />}
            </Campo>
            <Campo etiqueta="Hasta">
              {(p) => <EntradaCampo {...p} type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />}
            </Campo>
          </div>

          {mesesIncompletos ? (
            <Aviso variante="aviso" className="sm:col-span-2 lg:col-span-3">
              El rango no cubre meses completos: las pantallas absorbidas del mes en el borde pueden salir
              subestimadas o sobreestimadas.
            </Aviso>
          ) : null}
        </div>

        <div className="mt-6 space-y-4">
          {errorSimulacion ? <Aviso variante="critico">{errorSimulacion}</Aviso> : null}

          {!valorEsValido(parametros) ? (
            <p className="cuerpo text-ink-muted">Ingresa un valor válido para ver la simulación.</p>
          ) : cargandoSimulacion && !simulacion ? (
            <Esqueleto className="h-20 w-full" />
          ) : simulacion ? (
            <>
              <div className="rounded-control border border-borde bg-plano p-4">
                <p className="titulo-tarjeta text-ink">
                  {simulacion.pantallasComisionadas} de {simulacion.pantallasVendidas} pantallas comisionan (
                  {simulacion.porcentajeComisionado.toFixed(1)}%)
                </p>
                <p className="cuerpo text-ink-muted">
                  Pozo total del período: <span className="font-semibold text-ink">{formatearPesos(simulacion.pozoTotal)}</span>
                  {" · "}
                  {simulacion.pantallasAbsorbidas} absorbidas por el umbral
                </p>
              </div>

              {simulacion.porPeriodo.length === 0 ? (
                <EstadoVacio icono={PiggyBank} titulo="Sin ventas en el rango elegido" />
              ) : (
                <Tabla>
                  <TablaCabecera>
                    <TablaFila>
                      <TablaCeldaCabecera>Período</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Vendidas</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Absorbidas</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Comisionadas</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">%</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Pozo</TablaCeldaCabecera>
                    </TablaFila>
                  </TablaCabecera>
                  <TablaCuerpo>
                    {simulacion.porPeriodo.map((fila) => (
                      <TablaFila key={fila.periodoInicio}>
                        <TablaCelda>{etiquetaPeriodo(fila.periodoInicio, parametros.umbralPeriodo)}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{fila.pantallasVendidas}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{fila.pantallasAbsorbidas}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{fila.pantallasComisionadas}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{fila.porcentajeComisionado.toFixed(1)}%</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.pozoTotal)}</TablaCelda>
                      </TablaFila>
                    ))}
                  </TablaCuerpo>
                </Tabla>
              )}
            </>
          ) : null}
        </div>

        <div className="mt-6 space-y-3 border-t border-borde pt-4">
          {errorGuardado ? <Aviso variante="critico">{errorGuardado}</Aviso> : null}
          {guardadoOk ? (
            <Aviso variante="info">Política guardada como nueva versión vigente. No se liquidó ninguna comisión.</Aviso>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">
              Guardar crea una versión nueva — nunca sobrescribe la anterior, que queda en el historial.
            </p>
            <Boton variante="principal" onClick={guardar} disabled={guardando || !valorEsValido(parametros)}>
              {guardando ? "Guardando…" : "Guardar política"}
            </Boton>
          </div>
        </div>
      </Tarjeta>
    </div>
  );
}
