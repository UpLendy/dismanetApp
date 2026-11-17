"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, History, Percent, PiggyBank, Tv, Users2 } from "lucide-react";
import { api } from "@/lib/api";
import { hoyBogotaISO, sumarDiasISO, fechaBogotaDeInstante } from "@/lib/bogota";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Interruptor } from "@/components/ui/interruptor";
import { Aviso } from "@/components/ui/aviso";
import { Esqueleto } from "@/components/ui/cargando";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { Pastilla } from "@/components/ui/pastilla";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

type Modo = "PORCENTAJE_VENTA" | "FIJO_POR_PANTALLA";
type Ambito = "TOTAL" | "POR_PLATAFORMA";
type Periodo = "DIA" | "MES";

interface Excepcion {
  plataformaId: string;
  comisiona: boolean;
  modo: Modo | null;
  valor: string | null;
  umbralCantidad: number | null;
}

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
  excepciones: Excepcion[];
}

interface PlataformaResuelta {
  plataformaId: string;
  nombre: string;
  propia: boolean;
  comisiona: boolean;
  modo: Modo;
  valor: string;
  umbralCantidad: number;
}

interface PlataformaHeredando {
  plataformaId: string;
  nombre: string;
}

interface FilaPeriodo {
  periodoInicio: string;
  pantallasVendidas: number;
  pantallasAbsorbidas: number;
  pantallasComisionadas: number;
  porcentajeComisionado: number;
  pozoTotal: string;
}

interface FilaPlataformaSimulacion {
  plataformaId: string;
  pantallasVendidas: number;
  pantallasAbsorbidas: number;
  pantallasExcluidas: number;
  pantallasComisionadas: number;
  pozo: string;
}

interface Simulacion {
  pantallasVendidas: number;
  pantallasAbsorbidas: number;
  pantallasComisionadas: number;
  porcentajeComisionado: number;
  pozoTotal: string;
  porPeriodo: FilaPeriodo[];
  porPlataforma: FilaPlataformaSimulacion[];
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

// Edición en curso de la excepción de UNA plataforma. "" en modo/valor/
// umbralCantidad significa "hereda" — nunca se manda como 0 (CLAUDE.md:
// null ≠ 0). Separado de `Excepcion` porque los campos del formulario son
// texto, no los tipos ya normalizados que espera el body.
interface EdicionFila {
  comisiona: boolean;
  modo: Modo | "";
  valor: string;
  umbralCantidad: string;
}

type Ediciones = Record<string, EdicionFila>;

function filaHereda(): EdicionFila {
  return { comisiona: true, modo: "", valor: "", umbralCantidad: "" };
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
    const nombreMes = new Date(Date.UTC(2000, mes - 1, 1)).toLocaleDateString("es-CO", { month: "short", timeZone: "UTC" });
    return `${dia} ${nombreMes}`;
  }
  const [anio, mes] = fecha.split("-").map(Number);
  const nombreMes = new Date(Date.UTC(2000, mes - 1, 1)).toLocaleDateString("es-CO", { month: "long", timeZone: "UTC" });
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

function valorModoEsValido(modo: Modo, valorTexto: string): boolean {
  const valor = Number(valorTexto);
  if (!Number.isFinite(valor) || valor <= 0) return false;
  if (modo === "PORCENTAJE_VENTA" && valor > 100) return false;
  return true;
}

function valorEsValido(parametros: ParametrosForma): boolean {
  if (!valorModoEsValido(parametros.modo, parametros.valor)) return false;
  const umbral = Number(parametros.umbralCantidad);
  return Number.isInteger(umbral) && umbral >= 0;
}

/** Normaliza un nombre para agrupar plataformas con nombre parecido (F6.10, Parte 5) — no es limpieza de catálogo, solo hacerlo visible. */
function normalizarNombre(nombre: string): string {
  return nombre.trim().toLowerCase().replace(/\s+/g, " ");
}

function nombresRepetidos(plataformas: PlataformaResuelta[]): Set<string> {
  const conteo = new Map<string, number>();
  for (const p of plataformas) {
    const clave = normalizarNombre(p.nombre);
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }
  return new Set([...conteo.entries()].filter(([, n]) => n > 1).map(([clave]) => clave));
}

/** Arma la edición inicial de cada plataforma activa a partir de su excepción propia (si existe) — nunca rellena un valor heredado, eso queda en "" (PROMPT-F6.10, Parte 4). */
function construirEdiciones(plataformas: PlataformaResuelta[], excepciones: Excepcion[]): Ediciones {
  const porId = new Map(excepciones.map((e) => [e.plataformaId, e]));
  const resultado: Ediciones = {};
  for (const p of plataformas) {
    const propia = porId.get(p.plataformaId);
    resultado[p.plataformaId] = propia
      ? {
          comisiona: propia.comisiona,
          modo: propia.modo ?? "",
          valor: propia.valor ?? "",
          umbralCantidad: propia.umbralCantidad != null ? String(propia.umbralCantidad) : "",
        }
      : filaHereda();
  }
  return resultado;
}

interface ExcepcionEntrada {
  plataformaId: string;
  comisiona: boolean;
  modo: Modo | null;
  valor: string | null;
  umbralCantidad: number | null;
}

/** Solo manda al body las plataformas que de verdad se salen de "heredar todo" — una fila en blanco no debería crear una excepción vacía. */
function excepcionesParaEnviar(plataformas: PlataformaResuelta[], ediciones: Ediciones): ExcepcionEntrada[] {
  const resultado: ExcepcionEntrada[] = [];
  for (const p of plataformas) {
    const e = ediciones[p.plataformaId];
    if (!e) continue;
    const esPuraHerencia = e.comisiona && e.modo === "" && e.valor === "" && e.umbralCantidad === "";
    if (esPuraHerencia) continue;
    resultado.push({
      plataformaId: p.plataformaId,
      comisiona: e.comisiona,
      modo: e.comisiona && e.modo !== "" ? e.modo : null,
      valor: e.comisiona && e.valor !== "" ? e.valor : null,
      umbralCantidad: e.comisiona && e.umbralCantidad !== "" ? Number(e.umbralCantidad) : null,
    });
  }
  return resultado;
}

/** Mismas reglas que validarExcepcionComision en el servidor (lib/comisiones.ts), para avisar ANTES del 400 en vez de después — ver Parte 4 del PROMPT-F6.10. */
function errorDeFila(e: EdicionFila, modoDefecto: Modo, ambitoDefecto: Ambito): string | null {
  if (!e.comisiona) return null;
  if (e.umbralCantidad !== "") {
    if (ambitoDefecto === "TOTAL") return "Un umbral propio no es compatible con ámbito \"Total de la empresa\".";
    const umbral = Number(e.umbralCantidad);
    if (!Number.isInteger(umbral) || umbral < 0) return "Umbral inválido.";
  }
  if (e.modo !== "" && e.valor === "") return "Falta el valor para el modo elegido.";
  if (e.valor !== "") {
    const modoEfectivo = e.modo !== "" ? e.modo : modoDefecto;
    if (!valorModoEsValido(modoEfectivo, e.valor)) return "Valor inválido.";
  }
  return null;
}

export default function ComisionesCliente() {
  const hoy = useMemo(() => hoyBogotaISO(), []);
  const [desde, setDesde] = useState(() => sumarDiasISO(hoy, -30));
  const [hasta, setHasta] = useState(hoy);

  const [parametros, setParametros] = useState<ParametrosForma>(PARAMETROS_POR_DEFECTO);
  const [plataformas, setPlataformas] = useState<PlataformaResuelta[]>([]);
  const [ediciones, setEdiciones] = useState<Ediciones>({});

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
  const [plataformasHeredando, setPlataformasHeredando] = useState<PlataformaHeredando[] | null>(null);

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

    const { configuracion, plataformas: plataformasResueltas } = resVigente.data;
    setVigente(configuracion);
    setHistorial(resHistorial.data?.versiones ?? []);
    setPlataformas(plataformasResueltas);
    setEdiciones(construirEdiciones(plataformasResueltas, configuracion?.excepciones ?? []));
    if (configuracion) {
      setParametros({
        modo: configuracion.modo,
        valor: configuracion.valor,
        umbralCantidad: String(configuracion.umbralCantidad),
        umbralAmbito: configuracion.umbralAmbito,
        umbralPeriodo: configuracion.umbralPeriodo,
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

  const nombresDuplicados = useMemo(() => nombresRepetidos(plataformas), [plataformas]);

  const excepcionesActuales = useMemo(
    () => excepcionesParaEnviar(plataformas, ediciones),
    [plataformas, ediciones],
  );

  const erroresPorPlataforma = useMemo(() => {
    const errores: Record<string, string> = {};
    for (const p of plataformas) {
      const e = ediciones[p.plataformaId];
      if (!e) continue;
      const error = errorDeFila(e, parametros.modo, parametros.umbralAmbito);
      if (error) errores[p.plataformaId] = error;
    }
    return errores;
  }, [plataformas, ediciones, parametros.modo, parametros.umbralAmbito]);

  const hayConflictoUmbralTotal = useMemo(
    () =>
      parametros.umbralAmbito === "TOTAL" &&
      Object.values(ediciones).some((e) => e.comisiona && e.umbralCantidad !== ""),
    [parametros.umbralAmbito, ediciones],
  );

  const hayErroresExcepciones = Object.keys(erroresPorPlataforma).length > 0;

  function actualizarEdicion(plataformaId: string, cambios: Partial<EdicionFila>) {
    setEdiciones((actual) => ({
      ...actual,
      [plataformaId]: { ...(actual[plataformaId] ?? filaHereda()), ...cambios },
    }));
  }

  // Simulador: recalcula en vivo con lo que haya en los controles (default Y
  // tabla por plataforma), nunca con la configuración guardada (PROMPT-F6.5
  // Parte 3; PROMPT-F6.10 Parte 4) — así se puede mover el número y ver el
  // efecto antes de decidir si se guarda.
  useEffect(() => {
    if (!valorEsValido(parametros) || !desde || !hasta || hayErroresExcepciones) {
      setSimulacion(null);
      setErrorSimulacion(null);
      return;
    }

    let activo = true;
    const manija = setTimeout(async () => {
      setCargandoSimulacion(true);
      setErrorSimulacion(null);

      const { data, error } = await api.comisiones.simulacion.post({
        desde,
        hasta,
        modo: parametros.modo,
        valor: parametros.valor,
        umbralCantidad: Number(parametros.umbralCantidad),
        umbralAmbito: parametros.umbralAmbito,
        umbralPeriodo: parametros.umbralPeriodo,
        excepciones: excepcionesActuales,
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
  }, [parametros, desde, hasta, excepcionesActuales, hayErroresExcepciones]);

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
    if (!valorEsValido(parametros) || hayErroresExcepciones) return;
    setGuardando(true);
    setErrorGuardado(null);
    setPlataformasHeredando(null);

    const { data, error } = await api.comisiones.configuracion.put({
      modo: parametros.modo,
      valor: parametros.valor,
      umbralCantidad: Number(parametros.umbralCantidad),
      umbralAmbito: parametros.umbralAmbito,
      umbralPeriodo: parametros.umbralPeriodo,
      excepciones: excepcionesActuales,
    });

    setGuardando(false);
    // "/comisiones" también cuelga "/configuracion" como ruta literal, así
    // que Eden Treaty amplía el tipo de `data` con la forma de error
    // (mismo motivo que en instrucciones-contenido.tsx:597).
    if (error || !data || !("plataformasHeredando" in data)) {
      setErrorGuardado(mensajeDeError(error));
      return;
    }
    await cargarConfiguracion();
    setPlataformasHeredando(data.plataformasHeredando ?? []);
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
              {vigente.excepciones.length > 0 ? (
                <Pastilla tono="neutral" icono={Tv}>
                  {vigente.excepciones.length} plataforma(s) con regla propia
                </Pastilla>
              ) : null}
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
                    <TablaCeldaCabecera>Excepciones</TablaCeldaCabecera>
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
                      <TablaCelda>{version.excepciones.length}</TablaCelda>
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
        <TarjetaCabecera titulo="Política de comisiones" />
        <Aviso variante="info" className="mb-4">
          Esto es una simulación: no se guarda nada hasta que presiones "Guardar política" abajo, y guardar
          tampoco liquida comisiones a nadie — eso se hace en otra pantalla.
        </Aviso>

        <div>
          <h4 className="cuerpo font-semibold text-ink">Valor por defecto</h4>
          <p className="mb-3 text-xs text-ink-muted">
            Se aplica a cualquier plataforma que no tenga su propia regla en la tabla de abajo — incluidas las que
            se creen más adelante.
          </p>
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
        </div>

        <div className="mt-6 border-t border-borde pt-4">
          <h4 className="cuerpo font-semibold text-ink">Reglas por plataforma</h4>
          <p className="mb-3 text-xs text-ink-muted">
            Déjalas en blanco para heredar el valor por defecto. Un campo en gris muestra el valor heredado — no es
            cero, es "sin regla propia".
          </p>

          {hayConflictoUmbralTotal ? (
            <Aviso variante="aviso" className="mb-3">
              El ámbito del umbral por defecto es "Total de la empresa", que no admite un umbral propio por
              plataforma. Cambia el ámbito a "Por plataforma" arriba, o quita el umbral de las filas marcadas abajo.
            </Aviso>
          ) : null}

          {plataformas.length === 0 ? (
            <p className="cuerpo text-ink-muted">No hay plataformas activas.</p>
          ) : (
            <Tabla>
              <TablaCabecera>
                <TablaFila>
                  <TablaCeldaCabecera>Servicio</TablaCeldaCabecera>
                  <TablaCeldaCabecera>¿Comisiona?</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Modo</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Valor</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Umbral</TablaCeldaCabecera>
                </TablaFila>
              </TablaCabecera>
              <TablaCuerpo>
                {plataformas.map((p) => {
                  const e = ediciones[p.plataformaId] ?? filaHereda();
                  const error = erroresPorPlataforma[p.plataformaId];
                  const repetida = nombresDuplicados.has(normalizarNombre(p.nombre));
                  return (
                    <TablaFila key={p.plataformaId} className={cn(!e.comisiona && "opacity-60")}>
                      <TablaCelda>
                        <div className="flex items-center gap-2">
                          <span>{p.nombre}</span>
                          {repetida ? (
                            <Pastilla tono="aviso" icono={AlertTriangle}>
                              Nombre repetido
                            </Pastilla>
                          ) : null}
                        </div>
                      </TablaCelda>
                      <TablaCelda>
                        <Interruptor
                          checked={e.comisiona}
                          onCheckedChange={(checked) => actualizarEdicion(p.plataformaId, { comisiona: checked })}
                          aria-label={`¿${p.nombre} comisiona?`}
                        />
                      </TablaCelda>
                      <TablaCelda>
                        <SelectCampo
                          value={e.modo}
                          disabled={!e.comisiona}
                          onChange={(ev) =>
                            actualizarEdicion(p.plataformaId, { modo: ev.target.value as Modo | "" })
                          }
                        >
                          <option value="">Hereda ({etiquetaModo(parametros.modo)})</option>
                          <option value="FIJO_POR_PANTALLA">Monto fijo por pantalla</option>
                          <option value="PORCENTAJE_VENTA">Porcentaje de la venta</option>
                        </SelectCampo>
                      </TablaCelda>
                      <TablaCelda>
                        <EntradaCampo
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!e.comisiona}
                          placeholder={etiquetaValor(p.modo, p.valor)}
                          value={e.valor}
                          aria-invalid={Boolean(error)}
                          onChange={(ev) => actualizarEdicion(p.plataformaId, { valor: ev.target.value })}
                        />
                      </TablaCelda>
                      <TablaCelda>
                        <EntradaCampo
                          type="number"
                          min={0}
                          step="1"
                          disabled={!e.comisiona}
                          placeholder={String(p.umbralCantidad)}
                          value={e.umbralCantidad}
                          aria-invalid={Boolean(error)}
                          onChange={(ev) => actualizarEdicion(p.plataformaId, { umbralCantidad: ev.target.value })}
                        />
                        {error ? <p className="mt-1 text-xs font-medium text-critico">{error}</p> : null}
                      </TablaCelda>
                    </TablaFila>
                  );
                })}
              </TablaCuerpo>
            </Tabla>
          )}
        </div>

        <div className="mt-6 space-y-4 border-t border-borde pt-4">
          <h4 className="cuerpo font-semibold text-ink">Simulación en vivo</h4>
          {errorSimulacion ? <Aviso variante="critico">{errorSimulacion}</Aviso> : null}

          {!valorEsValido(parametros) ? (
            <p className="cuerpo text-ink-muted">Ingresa un valor válido para ver la simulación.</p>
          ) : hayErroresExcepciones ? (
            <p className="cuerpo text-ink-muted">Corrige las filas marcadas en rojo para ver la simulación.</p>
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

              {simulacion.porPlataforma.length === 0 ? null : (
                <Tabla>
                  <TablaCabecera>
                    <TablaFila>
                      <TablaCeldaCabecera>Plataforma</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Vendidas</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Absorbidas</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Excluidas</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Comisionadas</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Pozo</TablaCeldaCabecera>
                    </TablaFila>
                  </TablaCabecera>
                  <TablaCuerpo>
                    {simulacion.porPlataforma.map((fila) => (
                      <TablaFila key={fila.plataformaId}>
                        <TablaCelda>
                          {plataformas.find((p) => p.plataformaId === fila.plataformaId)?.nombre ?? fila.plataformaId}
                        </TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{fila.pantallasVendidas}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{fila.pantallasAbsorbidas}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{fila.pantallasExcluidas}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{fila.pantallasComisionadas}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.pozo)}</TablaCelda>
                      </TablaFila>
                    ))}
                  </TablaCuerpo>
                </Tabla>
              )}

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
          {plataformasHeredando ? (
            <Aviso variante="info">
              Política guardada como nueva versión vigente. No se liquidó ninguna comisión.{" "}
              {plataformasHeredando.length > 0
                ? `${plataformasHeredando.length} plataforma(s) activa(s) sin regla propia, heredando el valor por defecto: ${plataformasHeredando.map((p) => p.nombre).join(", ")}.`
                : "Todas las plataformas activas tienen su propia regla."}
            </Aviso>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">
              Guardar crea una versión nueva — nunca sobrescribe la anterior, que queda en el historial.
            </p>
            <Boton
              variante="principal"
              onClick={guardar}
              disabled={guardando || !valorEsValido(parametros) || hayErroresExcepciones}
            >
              {guardando ? "Guardando…" : "Guardar política"}
            </Boton>
          </div>
        </div>
      </Tarjeta>
    </div>
  );
}
