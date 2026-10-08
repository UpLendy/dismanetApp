"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { Ban, Check, ChevronDown, ChevronUp, Copy, Receipt, Search, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Pastilla, PastillaEstado } from "@/components/ui/pastilla";
import { Dialogo } from "@/components/ui/dialogo";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { CargandoTabla, CargandoTarjeta } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

type Rol = "VENDEDOR" | "ADMIN" | "SUPER_ADMIN";
type TipoVenta = "UNIDAD" | "PAQUETE";

interface DetalleVenta {
  id: string;
  plataformaId: string;
  nombrePlataforma: string;
  correoCuenta: string;
  fechaVencimiento: string;
}

interface VentaVendedor {
  id: string;
  codigoCompra: string;
  tipoVenta: string;
  nombreItem: string;
  nombreDuracion: string;
  nombreTipoCliente: string;
  precioVenta: string;
  celularCliente: string | null;
  fechaVenta: string;
  fechaVencimientoMax: string;
  mensajeGenerado: string;
  anulada: boolean;
  esPromocion: boolean;
  detalles: DetalleVenta[];
}

interface VentaAdmin extends VentaVendedor {
  costo: string;
  utilidad: string;
  anuladaEn: string | null;
  vendedor: { id: string; nombre: string };
  anuladaPor: { id: string; nombre: string } | null;
}

interface TotalesPeriodo {
  numeroVentas: number;
  ingresos: string;
  costos: string;
  utilidad: string;
}

interface Totales {
  hoy: TotalesPeriodo;
  semana: TotalesPeriodo;
  mes: TotalesPeriodo;
}

interface Opcion {
  id: string;
  nombre: string;
}

// Solo manipulación de texto, nunca aritmética con number (CLAUDE.md).
function formatearPesos(valor: string): string {
  const [entero, decimal] = valor.split(".");
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal ? `$${conPuntos},${decimal}` : `$${conPuntos}`;
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

const ETIQUETA_PERIODO: Record<keyof Totales, string> = {
  hoy: "Hoy",
  semana: "Esta semana",
  mes: "Este mes",
};

const FILTROS_VACIOS = {
  desde: "",
  hasta: "",
  vendedorId: "",
  tipoVenta: "" as TipoVenta | "",
  plataformaId: "",
  paqueteId: "",
  esPromocion: "" as "true" | "false" | "",
  codigoCompra: "",
  celularCliente: "",
};

function construirQuery(filtrosActuales: typeof FILTROS_VACIOS): Record<string, string> {
  const query: Record<string, string> = {};
  if (filtrosActuales.desde) query.desde = filtrosActuales.desde;
  if (filtrosActuales.hasta) query.hasta = filtrosActuales.hasta;
  if (filtrosActuales.vendedorId) query.vendedorId = filtrosActuales.vendedorId;
  if (filtrosActuales.tipoVenta) query.tipoVenta = filtrosActuales.tipoVenta;
  if (filtrosActuales.plataformaId) query.plataformaId = filtrosActuales.plataformaId;
  if (filtrosActuales.paqueteId) query.paqueteId = filtrosActuales.paqueteId;
  // Venta.esPromocion directamente (R3): filtra por lo que la venta era al
  // vender, no por lo que el paquete relacionado es hoy.
  if (filtrosActuales.esPromocion) query.esPromocion = filtrosActuales.esPromocion;
  if (filtrosActuales.codigoCompra) query.codigoCompra = filtrosActuales.codigoCompra;
  if (filtrosActuales.celularCliente) query.celularCliente = filtrosActuales.celularCliente;
  return query;
}

function DetalleCuentas({ detalles }: { detalles: DetalleVenta[] }) {
  return (
    <ul className="space-y-1.5">
      {detalles.map((detalle) => (
        <li key={detalle.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-ink">
            {detalle.nombrePlataforma} · <span className="text-ink-muted">{detalle.correoCuenta}</span>
          </span>
          <span className="text-xs text-ink-muted">Vence {formatearFecha(detalle.fechaVencimiento)}</span>
        </li>
      ))}
    </ul>
  );
}

function VentasVendedor() {
  const [ventas, setVentas] = useState<VentaVendedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error: errorRespuesta } = await api.ventas.mias.get();
    setCargando(false);
    if (errorRespuesta || !data) {
      setErrorLista(mensajeDeError(errorRespuesta));
      return;
    }
    setErrorLista(null);
    setVentas(data.ventas);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function copiarMensaje(venta: VentaVendedor) {
    await navigator.clipboard.writeText(venta.mensajeGenerado);
    setCopiadoId(venta.id);
    setTimeout(() => setCopiadoId(null), 2000);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina text-ink">Ventas</h1>
        <p className="cuerpo text-ink-muted">Tus ventas registradas. Vuelve a copiar el mensaje cuando lo necesites.</p>
      </div>

      {errorLista ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar tus ventas"
          accion={
            <Boton variante="contorno" onClick={cargar}>
              Reintentar
            </Boton>
          }
        >
          {errorLista}
        </Aviso>
      ) : cargando ? (
        <CargandoTabla filas={6} columnas={6} />
      ) : ventas.length === 0 ? (
        <EstadoVacio
          icono={Receipt}
          titulo="Aún no tienes ventas"
          descripcion="Cuando registres una venta en Vender, aparecerá aquí."
        />
      ) : (
        <Tabla>
          <TablaCabecera>
            <tr>
              <TablaCeldaCabecera>Código</TablaCeldaCabecera>
              <TablaCeldaCabecera>Ítem</TablaCeldaCabecera>
              <TablaCeldaCabecera>Duración</TablaCeldaCabecera>
              <TablaCeldaCabecera className="text-right">Precio</TablaCeldaCabecera>
              <TablaCeldaCabecera>Celular</TablaCeldaCabecera>
              <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
              <TablaCeldaCabecera></TablaCeldaCabecera>
            </tr>
          </TablaCabecera>
          <TablaCuerpo>
            {ventas.map((venta) => {
              const expandido = expandidoId === venta.id;
              return (
                <Fragment key={venta.id}>
                  <TablaFila>
                    <TablaCelda className="font-medium text-ink">{venta.codigoCompra}</TablaCelda>
                    <TablaCelda>
                      {venta.nombreItem}
                      <span className="block text-xs text-ink-muted">{venta.nombreTipoCliente}</span>
                    </TablaCelda>
                    <TablaCelda>{venta.nombreDuracion}</TablaCelda>
                    <TablaCelda className="text-right tabular-nums">{formatearPesos(venta.precioVenta)}</TablaCelda>
                    <TablaCelda className="text-ink-muted">{venta.celularCliente ?? "—"}</TablaCelda>
                    <TablaCelda>
                      <div className="flex flex-wrap gap-1.5">
                        <PastillaEstado estado={venta.anulada ? "anulada" : "activo"} />
                        {venta.esPromocion ? (
                          <Pastilla tono="secundario" icono={Sparkles}>
                            Promoción
                          </Pastilla>
                        ) : null}
                      </div>
                    </TablaCelda>
                    <TablaCelda>
                      <div className="flex justify-end gap-2">
                        <Boton
                          variante="contorno"
                          tamano="sm"
                          onClick={() => setExpandidoId(expandido ? null : venta.id)}
                        >
                          {expandido ? <ChevronUp /> : <ChevronDown />}
                          Cuentas
                        </Boton>
                        <Boton variante="contorno" tamano="sm" onClick={() => copiarMensaje(venta)}>
                          <Copy />
                          Copiar
                        </Boton>
                        {copiadoId === venta.id ? (
                          <Pastilla tono="bien" icono={Check}>
                            Copiado
                          </Pastilla>
                        ) : null}
                      </div>
                    </TablaCelda>
                  </TablaFila>
                  {expandido ? (
                    <TablaFila>
                      <TablaCelda colSpan={7} className="bg-plano">
                        <DetalleCuentas detalles={venta.detalles} />
                      </TablaCelda>
                    </TablaFila>
                  ) : null}
                </Fragment>
              );
            })}
          </TablaCuerpo>
        </Tabla>
      )}
    </div>
  );
}

function VentasAdmin() {
  const [ventas, setVentas] = useState<VentaAdmin[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [errorFila, setErrorFila] = useState<string | null>(null);

  const [totales, setTotales] = useState<Totales | null>(null);
  const [cargandoTotales, setCargandoTotales] = useState(true);

  const [vendedores, setVendedores] = useState<Opcion[]>([]);
  const [plataformas, setPlataformas] = useState<Opcion[]>([]);
  const [paquetes, setPaquetes] = useState<Opcion[]>([]);

  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  const [confirmandoAnular, setConfirmandoAnular] = useState<VentaAdmin | null>(null);
  const [anulando, setAnulando] = useState(false);

  const [copiandoCodigos, setCopiandoCodigos] = useState(false);
  const [codigosCopiados, setCodigosCopiados] = useState<number | null>(null);
  const [errorCodigos, setErrorCodigos] = useState<string | null>(null);

  const cargarVentas = useCallback(async (filtrosActuales: typeof FILTROS_VACIOS) => {
    setCargandoLista(true);
    const { data, error: errorRespuesta } = await api.ventas.listado.get({ query: construirQuery(filtrosActuales) });
    setCargandoLista(false);
    if (errorRespuesta || !data) {
      setErrorLista(mensajeDeError(errorRespuesta));
      return;
    }
    setErrorLista(null);
    setVentas(data.ventas);
  }, []);

  const cargarTotales = useCallback(async () => {
    setCargandoTotales(true);
    const { data, error: errorRespuesta } = await api.ventas.totales.get();
    setCargandoTotales(false);
    if (!errorRespuesta && data) setTotales(data);
  }, []);

  useEffect(() => {
    cargarVentas(FILTROS_VACIOS);
    cargarTotales();
    (async () => {
      const [resUsuarios, resPlataformas, resPaquetes] = await Promise.all([
        api.usuarios.get(),
        api.plataformas.get(),
        api.paquetes.get(),
      ]);
      if (resUsuarios.data) setVendedores(resUsuarios.data.usuarios);
      if (resPlataformas.data) setPlataformas(resPlataformas.data.plataformas);
      if (resPaquetes.data) setPaquetes(resPaquetes.data.paquetes);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function actualizarFiltro<K extends keyof typeof FILTROS_VACIOS>(campo: K, valor: (typeof FILTROS_VACIOS)[K]) {
    setFiltros((previo) => ({ ...previo, [campo]: valor }));
  }

  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setCodigosCopiados(null);
    setErrorCodigos(null);
    cargarVentas(filtros);
  }

  function limpiarFiltros() {
    setFiltros(FILTROS_VACIOS);
    setCodigosCopiados(null);
    setErrorCodigos(null);
    cargarVentas(FILTROS_VACIOS);
  }

  // Entrega 10 — copia los códigos del conjunto FILTRADO completo (no solo la
  // página visible): el endpoint /ventas/codigos vuelve a aplicar los mismos
  // filtros contra toda la tabla, sin paginar y sin anuladas.
  async function copiarCodigos() {
    setCopiandoCodigos(true);
    setErrorCodigos(null);
    const { data, error: errorRespuesta } = await api.ventas.codigos.get({ query: construirQuery(filtros) });
    setCopiandoCodigos(false);
    if (errorRespuesta || !data) {
      setErrorCodigos(mensajeDeError(errorRespuesta));
      return;
    }
    await navigator.clipboard.writeText(data.codigos.join("\n"));
    setCodigosCopiados(data.codigos.length);
  }

  async function confirmarAnular() {
    if (!confirmandoAnular) return;
    setAnulando(true);
    const { error: errorRespuesta } = await api.ventas({ id: confirmandoAnular.id }).anular.patch();
    setAnulando(false);
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      setConfirmandoAnular(null);
      return;
    }
    setConfirmandoAnular(null);
    cargarVentas(filtros);
    cargarTotales();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina text-ink">Ventas</h1>
        <p className="cuerpo text-ink-muted">Listado completo de la empresa, con filtros y totales por periodo.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {cargandoTotales ? (
          <>
            <CargandoTarjeta />
            <CargandoTarjeta />
            <CargandoTarjeta />
          </>
        ) : (
          (Object.keys(ETIQUETA_PERIODO) as (keyof Totales)[]).map((periodo) => (
            <Tarjeta key={periodo}>
              <TarjetaCabecera titulo={ETIQUETA_PERIODO[periodo]} />
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <p className="etiqueta-dato">Ventas</p>
                  <p className="valor-dato text-ink">{totales?.[periodo].numeroVentas ?? 0}</p>
                </div>
                <div>
                  <p className="etiqueta-dato">Ingresos</p>
                  <p className="valor-dato text-ink">{formatearPesos(totales?.[periodo].ingresos ?? "0")}</p>
                </div>
                <div>
                  <p className="etiqueta-dato">Costos</p>
                  <p className="valor-dato text-ink-muted">{formatearPesos(totales?.[periodo].costos ?? "0")}</p>
                </div>
                <div>
                  <p className="etiqueta-dato">Utilidad</p>
                  <p className="valor-dato text-bien">{formatearPesos(totales?.[periodo].utilidad ?? "0")}</p>
                </div>
              </div>
            </Tarjeta>
          ))
        )}
      </div>

      <Tarjeta>
        <form onSubmit={buscar} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo etiqueta="Desde">
            {(p) => (
              <EntradaCampo {...p} type="date" value={filtros.desde} onChange={(e) => actualizarFiltro("desde", e.target.value)} />
            )}
          </Campo>
          <Campo etiqueta="Hasta">
            {(p) => (
              <EntradaCampo {...p} type="date" value={filtros.hasta} onChange={(e) => actualizarFiltro("hasta", e.target.value)} />
            )}
          </Campo>
          <Campo etiqueta="Vendedor">
            {(p) => (
              <SelectCampo {...p} value={filtros.vendedorId} onChange={(e) => actualizarFiltro("vendedorId", e.target.value)}>
                <option value="">Todos</option>
                {vendedores.map((vendedor) => (
                  <option key={vendedor.id} value={vendedor.id}>
                    {vendedor.nombre}
                  </option>
                ))}
              </SelectCampo>
            )}
          </Campo>
          <Campo etiqueta="Tipo de venta">
            {(p) => (
              <SelectCampo
                {...p}
                value={filtros.tipoVenta}
                onChange={(e) => actualizarFiltro("tipoVenta", e.target.value as TipoVenta | "")}
              >
                <option value="">Todos</option>
                <option value="UNIDAD">Unidad</option>
                <option value="PAQUETE">Paquete</option>
              </SelectCampo>
            )}
          </Campo>
          <Campo etiqueta="Plataforma">
            {(p) => (
              <SelectCampo {...p} value={filtros.plataformaId} onChange={(e) => actualizarFiltro("plataformaId", e.target.value)}>
                <option value="">Todas</option>
                {plataformas.map((plataforma) => (
                  <option key={plataforma.id} value={plataforma.id}>
                    {plataforma.nombre}
                  </option>
                ))}
              </SelectCampo>
            )}
          </Campo>
          <Campo etiqueta="Paquete">
            {(p) => (
              <SelectCampo {...p} value={filtros.paqueteId} onChange={(e) => actualizarFiltro("paqueteId", e.target.value)}>
                <option value="">Todos</option>
                {paquetes.map((paquete) => (
                  <option key={paquete.id} value={paquete.id}>
                    {paquete.nombre}
                  </option>
                ))}
              </SelectCampo>
            )}
          </Campo>
          <Campo etiqueta="Promoción">
            {(p) => (
              <SelectCampo
                {...p}
                value={filtros.esPromocion}
                onChange={(e) => actualizarFiltro("esPromocion", e.target.value as "true" | "false" | "")}
              >
                <option value="">Todos</option>
                <option value="true">Promoción</option>
                <option value="false">No promoción</option>
              </SelectCampo>
            )}
          </Campo>
          <Campo etiqueta="Código de compra" ayuda="Busca por fragmento, sin distinguir mayúsculas.">
            {(p) => (
              <EntradaCampo
                {...p}
                placeholder="DIS995865"
                value={filtros.codigoCompra}
                onChange={(e) => actualizarFiltro("codigoCompra", e.target.value)}
              />
            )}
          </Campo>
          <Campo etiqueta="Celular del cliente" ayuda="Busca por fragmento, sin distinguir mayúsculas.">
            {(p) => (
              <EntradaCampo
                {...p}
                placeholder="3001234567"
                value={filtros.celularCliente}
                onChange={(e) => actualizarFiltro("celularCliente", e.target.value)}
              />
            )}
          </Campo>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Boton type="submit" variante="principal" className="flex-1">
              <Search />
              Buscar
            </Boton>
            <Boton type="button" variante="contorno" onClick={limpiarFiltros}>
              Limpiar
            </Boton>
            <Boton
              type="button"
              variante="contorno"
              disabled={ventas.length === 0 || copiandoCodigos}
              onClick={copiarCodigos}
            >
              <Copy />
              {copiandoCodigos ? "Copiando…" : "Copiar códigos"}
            </Boton>
          </div>
        </form>
      </Tarjeta>

      {codigosCopiados !== null ? (
        <Aviso variante="info">{`${codigosCopiados} ${codigosCopiados === 1 ? "código" : "códigos"} copiados`}</Aviso>
      ) : null}

      {errorCodigos ? <Aviso variante="critico">{errorCodigos}</Aviso> : null}

      {errorFila ? <Aviso variante="critico">{errorFila}</Aviso> : null}

      {errorLista ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar el listado"
          accion={
            <Boton variante="contorno" onClick={() => cargarVentas(filtros)}>
              Reintentar
            </Boton>
          }
        >
          {errorLista}
        </Aviso>
      ) : cargandoLista ? (
        <CargandoTabla filas={8} columnas={8} />
      ) : ventas.length === 0 ? (
        <EstadoVacio
          icono={Receipt}
          titulo="No hay ventas con estos filtros"
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
              <TablaCeldaCabecera>Código</TablaCeldaCabecera>
              <TablaCeldaCabecera>Vendedor</TablaCeldaCabecera>
              <TablaCeldaCabecera>Ítem</TablaCeldaCabecera>
              <TablaCeldaCabecera className="text-right">Precio</TablaCeldaCabecera>
              <TablaCeldaCabecera className="text-right">Costo</TablaCeldaCabecera>
              <TablaCeldaCabecera className="text-right">Utilidad</TablaCeldaCabecera>
              <TablaCeldaCabecera>Celular</TablaCeldaCabecera>
              <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
              <TablaCeldaCabecera></TablaCeldaCabecera>
            </tr>
          </TablaCabecera>
          <TablaCuerpo>
            {ventas.map((venta) => {
              const expandido = expandidoId === venta.id;
              return (
                <Fragment key={venta.id}>
                  <TablaFila>
                    <TablaCelda className="font-medium text-ink">{venta.codigoCompra}</TablaCelda>
                    <TablaCelda>{venta.vendedor.nombre}</TablaCelda>
                    <TablaCelda>
                      {venta.nombreItem}
                      <span className="block text-xs text-ink-muted">
                        {venta.nombreDuracion} · {venta.nombreTipoCliente}
                      </span>
                    </TablaCelda>
                    <TablaCelda className="text-right tabular-nums">{formatearPesos(venta.precioVenta)}</TablaCelda>
                    <TablaCelda className="text-right tabular-nums text-ink-muted">{formatearPesos(venta.costo)}</TablaCelda>
                    <TablaCelda className="text-right tabular-nums text-bien">{formatearPesos(venta.utilidad)}</TablaCelda>
                    <TablaCelda className="text-ink-muted">{venta.celularCliente ?? "—"}</TablaCelda>
                    <TablaCelda>
                      <div className="flex flex-wrap gap-1.5">
                        <PastillaEstado estado={venta.anulada ? "anulada" : "activo"} />
                        {venta.esPromocion ? (
                          <Pastilla tono="secundario" icono={Sparkles}>
                            Promoción
                          </Pastilla>
                        ) : null}
                      </div>
                    </TablaCelda>
                    <TablaCelda>
                      <div className="flex justify-end gap-2">
                        <Boton
                          variante="contorno"
                          tamano="sm"
                          onClick={() => setExpandidoId(expandido ? null : venta.id)}
                        >
                          {expandido ? <ChevronUp /> : <ChevronDown />}
                          Cuentas
                        </Boton>
                        {!venta.anulada ? (
                          <Boton variante="destructivo" tamano="sm" onClick={() => setConfirmandoAnular(venta)}>
                            <Ban />
                            Anular
                          </Boton>
                        ) : null}
                      </div>
                    </TablaCelda>
                  </TablaFila>
                  {expandido ? (
                    <TablaFila>
                      <TablaCelda colSpan={9} className="bg-plano">
                        <DetalleCuentas detalles={venta.detalles} />
                        {venta.anulada && venta.anuladaPor ? (
                          <p className="mt-2 text-xs text-ink-muted">
                            Anulada por {venta.anuladaPor.nombre}
                            {venta.anuladaEn ? ` el ${formatearFecha(venta.anuladaEn)}` : ""}.
                          </p>
                        ) : null}
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
        abierto={confirmandoAnular !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmandoAnular(null)}
        titulo={`Anular venta ${confirmandoAnular?.codigoCompra}`}
        descripcion="Libera todas sus pantallas de inmediato. No se puede revertir."
        textoConfirmar="Anular"
        confirmando={anulando}
        onConfirmar={confirmarAnular}
      />
    </div>
  );
}

export function VentasContenido({ rol }: { rol: Rol }) {
  return rol === "VENDEDOR" ? <VentasVendedor /> : <VentasAdmin />;
}
