"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronDown, ChevronUp, Copy, MonitorCheck, PhoneCall, RefreshCcw, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { Tarjeta } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo, AreaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Pastilla } from "@/components/ui/pastilla";
import { Dialogo } from "@/components/ui/dialogo";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { CargandoTabla } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";
import { satisfaceRol, type Rol } from "@/lib/rol";

type Estado = "VIGENTE" | "VENCIDA" | "REEMPLAZADA" | "VENTA_ANULADA";

interface GarantiaDetalle {
  id: string;
  motivo: string | null;
  creadoEn: string;
  creadoPor: { id: string; nombre: string };
  correoCuentaReemplazo: string | null;
  costoAsumido?: string;
}

interface PantallaVendida {
  id: string;
  plataformaId: string;
  nombrePlataforma: string;
  correoCuenta: string | null;
  claveCuenta: string;
  perfil: string | null;
  pin: string | null;
  codigoCompra: string;
  vendedor: { id: string; nombre: string };
  fechaEntrega: string;
  fechaVencimiento: string;
  estado: Estado;
  puedeReemplazar: boolean;
  garantia: GarantiaDetalle | null;
  // F4.3 — true si esta pantalla se entregó por una garantía de una venta
  // hecha fuera del sistema: codigoCompra es el de la Venta mínima
  // sintética, no el de una compra real. Se muestra celularExterno en su lugar.
  esExterna: boolean;
  celularExterno: string | null;
}

interface Opcion {
  id: string;
  nombre: string;
}

interface PlataformaExterna {
  id: string;
  nombre: string;
  condiciones: string | null;
  pantallasLibres: number;
}

interface DuracionExterna {
  id: string;
  nombre: string;
}

const FORM_EXTERNA_VACIO = {
  plataformaId: "",
  duracionId: "",
  fechaVencimiento: "",
  celularCliente: "",
  motivo: "",
};

const ESTADOS: Record<Estado, { texto: string; tono: "bien" | "neutral" | "secundario" | "critico" }> = {
  VIGENTE: { texto: "Vigente", tono: "bien" },
  VENCIDA: { texto: "Vencida", tono: "neutral" },
  REEMPLAZADA: { texto: "Reemplazada", tono: "secundario" },
  VENTA_ANULADA: { texto: "De la venta anulada", tono: "critico" },
};

const FILTROS_VACIOS = {
  plataformaId: "",
  vendedorId: "",
  codigoCompra: "",
  correoCuenta: "",
  soloVigentes: false,
};

function construirQuery(filtrosActuales: typeof FILTROS_VACIOS): Record<string, string> {
  const query: Record<string, string> = {};
  if (filtrosActuales.plataformaId) query.plataformaId = filtrosActuales.plataformaId;
  if (filtrosActuales.vendedorId) query.vendedorId = filtrosActuales.vendedorId;
  if (filtrosActuales.codigoCompra) query.codigoCompra = filtrosActuales.codigoCompra;
  if (filtrosActuales.correoCuenta) query.correoCuenta = filtrosActuales.correoCuenta;
  if (filtrosActuales.soloVigentes) query.soloVigentes = "true";
  return query;
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

function DetalleFila({ fila }: { fila: PantallaVendida }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p>
          <span className="text-ink-muted">Correo: </span>
          <span className="text-ink">{fila.correoCuenta ?? "—"}</span>
        </p>
        <p>
          <span className="text-ink-muted">Clave: </span>
          <span className="text-ink">{fila.claveCuenta}</span>
        </p>
        {fila.perfil ? (
          <p>
            <span className="text-ink-muted">Perfil: </span>
            <span className="text-ink">{fila.perfil}</span>
          </p>
        ) : null}
        {fila.pin ? (
          <p>
            <span className="text-ink-muted">PIN: </span>
            <span className="text-ink">{fila.pin}</span>
          </p>
        ) : null}
      </div>
      {fila.garantia ? (
        <div className="rounded-control bg-superficie p-3 text-sm">
          <p className="font-medium text-ink">Reemplazada por garantía</p>
          <p className="text-ink-muted">
            {formatearFecha(fila.garantia.creadoEn)} · {fila.garantia.creadoPor.nombre}
          </p>
          {fila.garantia.motivo ? <p className="mt-1 text-ink-2">Motivo: {fila.garantia.motivo}</p> : null}
          <p className="mt-1 text-ink-2">Pasó a la cuenta {fila.garantia.correoCuentaReemplazo ?? "—"}</p>
          {fila.garantia.costoAsumido !== undefined ? (
            <p className="mt-1 text-ink-muted">Pérdida asumida: {fila.garantia.costoAsumido}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PantallasVendidasContenido({ rol }: { rol: Rol }) {
  // F4.7, arreglo 2 — /garantias/costo-externo es ADMIN-only (R4): un
  // EMPLEADO ni pide el costo asumido ni lo ve en el diálogo.
  const esAdmin = satisfaceRol(rol, "ADMIN");
  const searchParams = useSearchParams();
  // F4.6 — abrirExterna() debe disparar una sola vez al llegar con
  // garantiaExterna=1 (viene de Vender), nunca otra vez: cerrar el diálogo
  // no debe reabrirlo en el siguiente render.
  const externaDisparadaRef = useRef(false);

  const [pantallas, setPantallas] = useState<PantallaVendida[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  // F4.6 — llega desde Vender con codigoCompra o correoCuenta en la URL: el
  // filtro arranca aplicado, no vacío a la espera de que alguien lo escriba
  // de nuevo.
  const [filtros, setFiltros] = useState(() => ({
    ...FILTROS_VACIOS,
    codigoCompra: searchParams.get("codigoCompra") ?? "",
    correoCuenta: searchParams.get("correoCuenta") ?? "",
  }));

  // Las opciones de los selects de plataforma/vendedor se derivan de la
  // primera carga (sin filtros), no de /plataformas ni /usuarios: esos dos
  // endpoints exigen ADMIN y esta vista también la usa el VENDEDOR.
  const [opcionesPlataforma, setOpcionesPlataforma] = useState<Opcion[]>([]);
  const [opcionesVendedor, setOpcionesVendedor] = useState<Opcion[]>([]);
  const opcionesListas = useRef(false);

  const [reemplazando, setReemplazando] = useState<PantallaVendida | null>(null);
  const [motivo, setMotivo] = useState("");
  const [procesandoReemplazo, setProcesandoReemplazo] = useState(false);
  const [errorReemplazo, setErrorReemplazo] = useState<string | null>(null);

  const [mensajeExitoso, setMensajeExitoso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  // F4.3 — garantía de una venta hecha fuera del sistema: no hay pantalla
  // original en la tabla de donde colgar el botón, así que es una acción de
  // la página, no de un renglón.
  const [registrandoExterna, setRegistrandoExterna] = useState(false);
  const [catalogoExterna, setCatalogoExterna] = useState<{
    plataformas: PlataformaExterna[];
    duraciones: DuracionExterna[];
  } | null>(null);
  const [formExterna, setFormExterna] = useState(FORM_EXTERNA_VACIO);
  const [costoExterna, setCostoExterna] = useState<string | null>(null);
  const [procesandoExterna, setProcesandoExterna] = useState(false);
  const [errorExterna, setErrorExterna] = useState<string | null>(null);

  const cargar = useCallback(async (filtrosActuales: typeof FILTROS_VACIOS) => {
    setCargando(true);
    const { data, error: errorRespuesta } = await api.garantias["pantallas-vendidas"].get({
      query: construirQuery(filtrosActuales),
    });
    setCargando(false);
    if (errorRespuesta || !data) {
      setErrorLista(mensajeDeError(errorRespuesta));
      return;
    }
    setErrorLista(null);
    setPantallas(data.pantallas);

    if (!opcionesListas.current) {
      opcionesListas.current = true;
      const plataformas = new Map<string, string>();
      const vendedores = new Map<string, string>();
      for (const fila of data.pantallas) {
        plataformas.set(fila.plataformaId, fila.nombrePlataforma);
        vendedores.set(fila.vendedor.id, fila.vendedor.nombre);
      }
      setOpcionesPlataforma(
        Array.from(plataformas, ([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
      );
      setOpcionesVendedor(
        Array.from(vendedores, ([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
      );
    }
  }, []);

  useEffect(() => {
    cargar(filtros);

    // F4.6 — abrirExterna() abre sola el diálogo de garantía externa al
    // llegar con garantiaExterna=1 (viene de Vender). Guardado por
    // externaDisparadaRef para que cerrar el diálogo no lo vuelva a abrir
    // en un render posterior.
    if (!externaDisparadaRef.current && searchParams.get("garantiaExterna") === "1") {
      externaDisparadaRef.current = true;
      abrirExterna();
    }
    // Solo al montar, con los filtros iniciales ya leídos de la URL: no debe
    // volver a correr si `filtros` cambia después por una búsqueda manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function actualizarFiltro<K extends keyof typeof FILTROS_VACIOS>(campo: K, valor: (typeof FILTROS_VACIOS)[K]) {
    setFiltros((previo) => ({ ...previo, [campo]: valor }));
  }

  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    cargar(filtros);
  }

  function limpiarFiltros() {
    setFiltros(FILTROS_VACIOS);
    cargar(FILTROS_VACIOS);
  }

  function abrirReemplazo(fila: PantallaVendida) {
    setErrorReemplazo(null);
    setMotivo("");
    setReemplazando(fila);
  }

  async function confirmarReemplazo() {
    if (!reemplazando) return;
    setProcesandoReemplazo(true);
    setErrorReemplazo(null);
    const { data, error: errorRespuesta } = await api
      .garantias({ id: reemplazando.id })
      .reemplazar.post({ motivo: motivo.trim() || undefined });
    setProcesandoReemplazo(false);

    // `"mensajeGenerado" in data`: mismo patrón que vender/page.tsx — Elysia
    // no logra correlacionar los `set.status` manuales con el `response`
    // declarado, así que el tipo inferido mezcla las formas de éxito y error.
    if (errorRespuesta || !data || !("mensajeGenerado" in data) || typeof data.mensajeGenerado !== "string") {
      setErrorReemplazo(mensajeDeError(errorRespuesta));
      return;
    }

    setReemplazando(null);
    setMensajeExitoso(data.mensajeGenerado);
    setCopiado(false);
    cargar(filtros);
  }

  async function copiarMensaje() {
    if (!mensajeExitoso) return;
    await navigator.clipboard.writeText(mensajeExitoso);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  async function abrirExterna() {
    setErrorExterna(null);
    setFormExterna(FORM_EXTERNA_VACIO);
    setCostoExterna(null);
    setRegistrandoExterna(true);
    if (!catalogoExterna) {
      const { data, error: errorRespuesta } = await api.garantias["catalogo-externa"].get();
      if (!errorRespuesta && data) setCatalogoExterna(data);
    }
  }

  async function confirmarExterna() {
    if (!formExterna.plataformaId || !formExterna.duracionId || !formExterna.fechaVencimiento) {
      setErrorExterna("Completa plataforma, duración y fecha de vencimiento.");
      return;
    }
    setProcesandoExterna(true);
    setErrorExterna(null);
    const { data, error: errorRespuesta } = await api.garantias.externa.post({
      plataformaId: formExterna.plataformaId,
      duracionId: formExterna.duracionId,
      // Fin del día: así "hoy" sigue siendo una fecha futura válida frente
      // a la hora actual, no solo "mañana en adelante".
      fechaVencimiento: `${formExterna.fechaVencimiento}T23:59:00`,
      celularCliente: formExterna.celularCliente.trim() || undefined,
      motivo: formExterna.motivo.trim() || undefined,
    });
    setProcesandoExterna(false);

    if (errorRespuesta || !data || !("mensajeGenerado" in data) || typeof data.mensajeGenerado !== "string") {
      setErrorExterna(mensajeDeError(errorRespuesta));
      return;
    }

    setRegistrandoExterna(false);
    setMensajeExitoso(data.mensajeGenerado);
    setCopiado(false);
    cargar(filtros);
  }

  const plataformaExternaSeleccionada = catalogoExterna?.plataformas.find(
    (plataforma) => plataforma.id === formExterna.plataformaId,
  );

  useEffect(() => {
    if (!esAdmin || !registrandoExterna || !formExterna.plataformaId || !formExterna.duracionId) {
      setCostoExterna(null);
      return;
    }
    let cancelado = false;
    (async () => {
      const { data, error: errorRespuesta } = await api.garantias["costo-externo"].get({
        query: { plataformaId: formExterna.plataformaId, duracionId: formExterna.duracionId },
      });
      if (!cancelado && !errorRespuesta && data) setCostoExterna(data.costoAsumido);
    })();
    return () => {
      cancelado = true;
    };
  }, [esAdmin, registrandoExterna, formExterna.plataformaId, formExterna.duracionId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Pantallas vendidas</h1>
          <p className="cuerpo text-ink-muted">
            Una fila por pantalla entregada. Si una cuenta no sirve, reemplázala por otra de la misma plataforma.
          </p>
        </div>
        <Boton variante="contorno" type="button" onClick={abrirExterna}>
          <PhoneCall />
          Registrar garantía externa
        </Boton>
      </div>

      {mensajeExitoso ? (
        <Tarjeta className="space-y-3 bg-plano">
          <p className="etiqueta-dato">Mensaje de reemplazo para WhatsApp</p>
          <pre className="whitespace-pre-wrap rounded-control border border-borde bg-superficie p-4 font-mono text-sm text-ink">
            {mensajeExitoso}
          </pre>
          <div className="flex items-center gap-3">
            <Boton variante="principal" type="button" onClick={copiarMensaje}>
              <Copy />
              Copiar mensaje
            </Boton>
            {copiado ? (
              <Pastilla tono="bien" icono={Check}>
                Copiado
              </Pastilla>
            ) : null}
            <Boton variante="contorno" type="button" onClick={() => setMensajeExitoso(null)}>
              Cerrar
            </Boton>
          </div>
        </Tarjeta>
      ) : null}

      <Tarjeta>
        <form onSubmit={buscar} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Campo etiqueta="Plataforma">
            {(p) => (
              <SelectCampo {...p} value={filtros.plataformaId} onChange={(e) => actualizarFiltro("plataformaId", e.target.value)}>
                <option value="">Todas</option>
                {opcionesPlataforma.map((plataforma) => (
                  <option key={plataforma.id} value={plataforma.id}>
                    {plataforma.nombre}
                  </option>
                ))}
              </SelectCampo>
            )}
          </Campo>
          <Campo etiqueta="Vendedor">
            {(p) => (
              <SelectCampo {...p} value={filtros.vendedorId} onChange={(e) => actualizarFiltro("vendedorId", e.target.value)}>
                <option value="">Todos</option>
                {opcionesVendedor.map((vendedor) => (
                  <option key={vendedor.id} value={vendedor.id}>
                    {vendedor.nombre}
                  </option>
                ))}
              </SelectCampo>
            )}
          </Campo>
          <Campo etiqueta="Código de compra" ayuda="Busca por fragmento.">
            {(p) => (
              <EntradaCampo
                {...p}
                placeholder="DIS995865"
                value={filtros.codigoCompra}
                onChange={(e) => actualizarFiltro("codigoCompra", e.target.value)}
              />
            )}
          </Campo>
          <Campo etiqueta="Correo de la cuenta" ayuda="Busca por fragmento.">
            {(p) => (
              <EntradaCampo
                {...p}
                placeholder="cuenta@correo.com"
                value={filtros.correoCuenta}
                onChange={(e) => actualizarFiltro("correoCuenta", e.target.value)}
              />
            )}
          </Campo>
          <div className="flex items-end gap-2">
            <label className="flex h-10 items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                className="size-4 rounded border-borde"
                checked={filtros.soloVigentes}
                onChange={(e) => actualizarFiltro("soloVigentes", e.target.checked)}
              />
              Solo vigentes
            </label>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
            <Boton type="submit" variante="principal" className="flex-1">
              <Search />
              Buscar
            </Boton>
            <Boton type="button" variante="contorno" onClick={limpiarFiltros}>
              Limpiar
            </Boton>
          </div>
        </form>
      </Tarjeta>

      {errorLista ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar el listado"
          accion={
            <Boton variante="contorno" onClick={() => cargar(filtros)}>
              Reintentar
            </Boton>
          }
        >
          {errorLista}
        </Aviso>
      ) : cargando ? (
        <CargandoTabla filas={8} columnas={8} />
      ) : pantallas.length === 0 ? (
        <EstadoVacio
          icono={MonitorCheck}
          titulo="No hay pantallas con estos filtros"
          descripcion="Ajusta los filtros o límpialos para ver el listado completo."
          accion={
            <Boton variante="contorno" onClick={limpiarFiltros}>
              Limpiar filtros
            </Boton>
          }
        />
      ) : (
        <Tabla>
          <TablaCabecera>
            <tr>
              <TablaCeldaCabecera>Plataforma</TablaCeldaCabecera>
              <TablaCeldaCabecera>Correo de la cuenta</TablaCeldaCabecera>
              <TablaCeldaCabecera>Perfil</TablaCeldaCabecera>
              <TablaCeldaCabecera>Comprador</TablaCeldaCabecera>
              <TablaCeldaCabecera>Vendedor</TablaCeldaCabecera>
              <TablaCeldaCabecera>Entrega</TablaCeldaCabecera>
              <TablaCeldaCabecera>Vencimiento</TablaCeldaCabecera>
              <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
              <TablaCeldaCabecera></TablaCeldaCabecera>
            </tr>
          </TablaCabecera>
          <TablaCuerpo>
            {pantallas.map((fila) => {
              const expandido = expandidoId === fila.id;
              const estado = ESTADOS[fila.estado];
              return (
                <Fragment key={fila.id}>
                  <TablaFila>
                    <TablaCelda className="font-medium text-ink">{fila.nombrePlataforma}</TablaCelda>
                    <TablaCelda className="text-ink-2">{fila.correoCuenta ?? "—"}</TablaCelda>
                    <TablaCelda className="text-ink-muted">{fila.perfil ?? "—"}</TablaCelda>
                    <TablaCelda className="text-ink-2">
                      {fila.esExterna ? (
                        <span className="inline-flex items-center gap-2">
                          <Pastilla tono="secundario">Externa</Pastilla>
                          {fila.celularExterno ?? "—"}
                        </span>
                      ) : (
                        fila.codigoCompra
                      )}
                    </TablaCelda>
                    <TablaCelda className="text-ink-muted">{fila.vendedor.nombre}</TablaCelda>
                    <TablaCelda className="text-ink-muted">{formatearFecha(fila.fechaEntrega)}</TablaCelda>
                    <TablaCelda className="text-ink-muted">{formatearFecha(fila.fechaVencimiento)}</TablaCelda>
                    <TablaCelda>
                      <Pastilla tono={estado.tono}>{estado.texto}</Pastilla>
                    </TablaCelda>
                    <TablaCelda>
                      <div className="flex justify-end gap-2">
                        <Boton variante="contorno" tamano="sm" onClick={() => setExpandidoId(expandido ? null : fila.id)}>
                          {expandido ? <ChevronUp /> : <ChevronDown />}
                          Detalle
                        </Boton>
                        {fila.puedeReemplazar ? (
                          <Boton variante="contorno" tamano="sm" onClick={() => abrirReemplazo(fila)}>
                            <RefreshCcw />
                            Reemplazar
                          </Boton>
                        ) : null}
                      </div>
                    </TablaCelda>
                  </TablaFila>
                  {expandido ? (
                    <TablaFila>
                      <TablaCelda colSpan={9} className="bg-plano">
                        <DetalleFila fila={fila} />
                      </TablaCelda>
                    </TablaFila>
                  ) : null}
                </Fragment>
              );
            })}
          </TablaCuerpo>
        </Tabla>
      )}

      <Dialogo
        abierto={reemplazando !== null}
        onCambiarAbierto={(abierto) => !abierto && setReemplazando(null)}
        titulo={reemplazando ? `Reemplazar pantalla de ${reemplazando.nombrePlataforma} — ${reemplazando.codigoCompra}` : ""}
        descripcion={`Se entrega una pantalla nueva de ${reemplazando?.nombrePlataforma ?? ""} por los días que le quedaban a esta venta. La pérdida la asume la empresa.`}
        textoConfirmar="Reemplazar"
        varianteConfirmar="principal"
        confirmando={procesandoReemplazo}
        onConfirmar={confirmarReemplazo}
      >
        {errorReemplazo ? <Aviso variante="critico">{errorReemplazo}</Aviso> : null}
        <Campo etiqueta="Motivo (opcional)">
          {(p) => (
            <AreaCampo {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Qué falló" />
          )}
        </Campo>
      </Dialogo>

      <Dialogo
        abierto={registrandoExterna}
        onCambiarAbierto={(abierto) => !abierto && setRegistrandoExterna(false)}
        titulo="Registrar garantía externa"
        descripcion={
          plataformaExternaSeleccionada && formExterna.fechaVencimiento
            ? esAdmin
              ? `Se va a entregar una pantalla de ${plataformaExternaSeleccionada.nombre} del inventario, ocupada hasta ${formExterna.fechaVencimiento}, y se va a registrar una pérdida de ${costoExterna ?? "—"}.`
              : `Se va a entregar una pantalla de ${plataformaExternaSeleccionada.nombre} del inventario, ocupada hasta ${formExterna.fechaVencimiento}.`
            : "Para una venta que se hizo por fuera del sistema: entrega una pantalla del inventario y registra la pérdida."
        }
        textoConfirmar="Registrar"
        varianteConfirmar="principal"
        confirmando={procesandoExterna}
        onConfirmar={confirmarExterna}
      >
        {errorExterna ? <Aviso variante="critico">{errorExterna}</Aviso> : null}
        <Campo etiqueta="Plataforma">
          {(p) => (
            <SelectCampo
              {...p}
              value={formExterna.plataformaId}
              onChange={(e) => setFormExterna((f) => ({ ...f, plataformaId: e.target.value }))}
            >
              <option value="">Selecciona...</option>
              {(catalogoExterna?.plataformas ?? []).map((plataforma) => (
                <option key={plataforma.id} value={plataforma.id}>
                  {plataforma.nombre} ({plataforma.pantallasLibres} libres)
                </option>
              ))}
            </SelectCampo>
          )}
        </Campo>
        <Campo etiqueta="Duración">
          {(p) => (
            <SelectCampo
              {...p}
              value={formExterna.duracionId}
              onChange={(e) => setFormExterna((f) => ({ ...f, duracionId: e.target.value }))}
            >
              <option value="">Selecciona...</option>
              {(catalogoExterna?.duraciones ?? []).map((duracion) => (
                <option key={duracion.id} value={duracion.id}>
                  {duracion.nombre}
                </option>
              ))}
            </SelectCampo>
          )}
        </Campo>
        <Campo etiqueta="Fecha de vencimiento">
          {(p) => (
            <EntradaCampo
              {...p}
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={formExterna.fechaVencimiento}
              onChange={(e) => setFormExterna((f) => ({ ...f, fechaVencimiento: e.target.value }))}
            />
          )}
        </Campo>
        <Campo etiqueta="Celular del cliente (opcional)">
          {(p) => (
            <EntradaCampo
              {...p}
              placeholder="3001234567"
              value={formExterna.celularCliente}
              onChange={(e) => setFormExterna((f) => ({ ...f, celularCliente: e.target.value }))}
            />
          )}
        </Campo>
        <Campo etiqueta="Motivo (opcional)">
          {(p) => (
            <AreaCampo
              {...p}
              value={formExterna.motivo}
              onChange={(e) => setFormExterna((f) => ({ ...f, motivo: e.target.value }))}
              placeholder="Qué pasó"
            />
          )}
        </Campo>
      </Dialogo>
    </div>
  );
}
