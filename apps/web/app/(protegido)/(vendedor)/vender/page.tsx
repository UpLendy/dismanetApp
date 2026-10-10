"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Package, Search, Tag, Tv, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";
import { Tarjeta } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Pastilla } from "@/components/ui/pastilla";
import { Modal } from "@/components/ui/modal";
import { LogoPlataforma } from "@/components/ui/logo-plataforma";
import { EVENTO_SALDO_ACTUALIZADO } from "@/lib/eventos";

interface Opcion {
  id: string;
  nombre: string;
}

interface PlataformaGrid {
  id: string;
  nombre: string;
  condiciones: string | null;
  logoUrl: string | null;
  pantallasLibres: number;
  tienePrecio: boolean;
}

interface ComponenteGrid {
  plataformaId: string;
  nombrePlataforma: string;
  logoUrl: string | null;
}

interface PaqueteGrid {
  id: string;
  nombre: string;
  esPromocion: boolean;
  componentes: ComponenteGrid[];
  armable: boolean;
  tienePrecio: boolean;
}

interface OpcionPrecio {
  duracionId: string;
  tipoClienteId: string;
  precioVenta: string;
}

type ItemSeleccionado =
  | { tipo: "UNIDAD"; id: string; nombre: string; logoUrl: string | null; condiciones: string | null; pantallasLibres: number }
  | { tipo: "PAQUETE"; id: string; nombre: string; componentes: ComponenteGrid[] };

interface VentaRealizada {
  codigoCompra: string;
  nombreItem: string;
  nombreDuracion: string;
  nombreTipoCliente: string;
  precioVenta: string;
  mensajeGenerado: string;
  costo?: string;
  utilidad?: string;
}

type Modo = "UNIDAD" | "PAQUETE" | "PROMOCION";

// Validación suave (CLAUDE.md Entrega 10, punto 2): dígitos, espacios y '+',
// entre 7 y 15 caracteres. Solo avisa — nunca bloquea el botón VENDER.
const CELULAR_VALIDO = /^[\d\s+]{7,15}$/;

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

// Solo manipulación de texto, nunca aritmética con number: precioVenta llega
// como string ("Dinero: Decimal... nunca number flotante" — CLAUDE.md).
function formatearPesos(valor: string): string {
  const [entero, decimal] = valor.split(".");
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal ? `$${conPuntos},${decimal}` : `$${conPuntos}`;
}

const TONO_PILDORA = {
  UNIDAD: "border-primario-suave bg-primario-suave text-primario-texto",
  PAQUETE: "border-categoria-paquete-suave bg-categoria-paquete-suave text-categoria-paquete-texto",
  PROMOCION: "border-categoria-promocion-suave bg-categoria-promocion-suave text-categoria-promocion-texto",
} as const;

// Paso 1 de /vender (DISENO.md §6): pastilla grande con ícono + nombre +
// conteo de ítems. UNIDAD reutiliza el rojo de marca a propósito — es el
// tipo de venta más frecuente. PAQUETE/PROMOCIÓN usan los tonos de
// categoría nuevos, nunca los tokens de estado.
function PildoraModo({
  modo,
  icono: Icono,
  nombre,
  conteo,
  cargando,
  onClick,
}: {
  modo: Modo;
  icono: React.ComponentType<{ className?: string }>;
  nombre: string;
  conteo: number;
  cargando: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-tarjeta border px-4 py-6 text-center transition-opacity hover:opacity-80",
        TONO_PILDORA[modo],
      )}
    >
      <Icono className="size-8" />
      <span className="titulo-tarjeta">{nombre}</span>
      <span className="text-xs opacity-80">
        {cargando ? "Cargando…" : `${conteo} ${conteo === 1 ? "ítem" : "ítems"}`}
      </span>
    </button>
  );
}

// Paso 2 de /vender — tarjeta del grid modal de plataformas (modo UNIDAD).
// Nunca se oculta por falta de cupo o de precio (R5 / CLAUDE.md): se
// deshabilita y dice el motivo.
function TarjetaPlataformaModal({ plataforma, onElegir }: { plataforma: PlataformaGrid; onElegir: () => void }) {
  const deshabilitada = plataforma.pantallasLibres === 0 || !plataforma.tienePrecio;
  const motivo = plataforma.pantallasLibres === 0 ? "Sin pantallas libres" : !plataforma.tienePrecio ? "Sin precio configurado" : null;

  return (
    <button
      type="button"
      disabled={deshabilitada}
      onClick={onElegir}
      title={motivo ?? undefined}
      className={cn(
        "flex flex-col items-center gap-2 rounded-tarjeta border border-borde p-3 text-center transition-colors",
        deshabilitada ? "cursor-not-allowed opacity-50" : "hover:bg-black/4 dark:hover:bg-white/5",
      )}
    >
      <LogoPlataforma logoUrl={plataforma.logoUrl} nombre={plataforma.nombre} className="size-12" />
      <span className="cuerpo font-medium text-ink">{plataforma.nombre}</span>
      <span className="text-xs text-ink-muted">{motivo ?? `${plataforma.pantallasLibres} libre(s)`}</span>
    </button>
  );
}

// Paso 2 de /vender — tarjeta del grid modal de paquetes (modo
// PAQUETE/PROMOCIÓN). armable es independiente de la duración (ver
// lib/paquetes.ts): esta grilla nunca pregunta duración para decidir si
// mostrar el paquete.
function TarjetaPaqueteModal({ paquete, onElegir }: { paquete: PaqueteGrid; onElegir: () => void }) {
  const deshabilitada = !paquete.armable || !paquete.tienePrecio;
  const motivo = !paquete.armable ? "Sin inventario para armarlo" : !paquete.tienePrecio ? "Sin precio configurado" : null;

  return (
    <button
      type="button"
      disabled={deshabilitada}
      onClick={onElegir}
      title={motivo ?? undefined}
      className={cn(
        "flex flex-col items-center gap-2 rounded-tarjeta border border-borde p-3 text-center transition-colors",
        deshabilitada ? "cursor-not-allowed opacity-50" : "hover:bg-black/4 dark:hover:bg-white/5",
      )}
    >
      <div className="flex -space-x-2">
        {paquete.componentes.map((c) => (
          <LogoPlataforma
            key={c.plataformaId}
            logoUrl={c.logoUrl}
            nombre={c.nombrePlataforma}
            className="size-8 border-2 border-superficie"
          />
        ))}
      </div>
      <span className="cuerpo font-medium text-ink">{paquete.nombre}</span>
      <span className="text-xs text-ink-muted">{motivo ?? "Disponible"}</span>
    </button>
  );
}

export default function PaginaVender() {
  const [tiposCliente, setTiposCliente] = useState<Opcion[]>([]);
  const [duraciones, setDuraciones] = useState<Opcion[]>([]);
  const [tipoClienteId, setTipoClienteId] = useState("");
  const [duracionId, setDuracionId] = useState("");

  // Grilla de los tres modos — cargada una sola vez al montar la pantalla
  // (no al presionar cada pastilla), para que el conteo de cada pastilla ya
  // esté listo desde el primer render.
  const [plataformasGrid, setPlataformasGrid] = useState<PlataformaGrid[]>([]);
  const [paquetesGrid, setPaquetesGrid] = useState<PaqueteGrid[]>([]);
  const [cargandoGrid, setCargandoGrid] = useState(true);

  const [modo, setModo] = useState<Modo | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [busquedaModal, setBusquedaModal] = useState("");

  const [itemSeleccionado, setItemSeleccionado] = useState<ItemSeleccionado | null>(null);
  const [opciones, setOpciones] = useState<OpcionPrecio[]>([]);
  const [cargandoOpciones, setCargandoOpciones] = useState(false);

  const [vendiendo, setVendiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ventaRealizada, setVentaRealizada] = useState<VentaRealizada | null>(null);
  const [avisoVenta, setAvisoVenta] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [celularCliente, setCelularCliente] = useState("");

  // Saldo propio del revendedor (null si usaSaldo es false): visible antes
  // de confirmar la venta, no solo en la barra superior.
  const [saldoPropio, setSaldoPropio] = useState<{ usaSaldo: boolean; saldo: string | null } | null>(null);

  const cargarSaldoPropio = useCallback(async () => {
    const { data } = await api.perfil.saldo.get();
    if (data) setSaldoPropio({ usaSaldo: data.usaSaldo, saldo: data.saldo });
  }, []);

  // Guarda síncrona contra doble envío: el estado `vendiendo` se actualiza en
  // el siguiente render, pero esta referencia se lee y escribe de inmediato,
  // así que dos clics rápidos en VENDER antes de ese render nunca producen
  // dos ventas.
  const enviandoRef = useRef(false);

  useEffect(() => {
    api.ventas["tipos-cliente"].get().then(({ data }) => {
      if (data) setTiposCliente(data.tiposCliente);
    });
    api.ventas.duraciones.get().then(({ data }) => {
      if (data) setDuraciones(data.duraciones);
    });
    cargarSaldoPropio();

    Promise.all([api.ventas.plataformas.get(), api.ventas.paquetes.get()]).then(([plataformas, paquetes]) => {
      if (plataformas.data) setPlataformasGrid(plataformas.data.plataformas);
      if (paquetes.data) setPaquetesGrid(paquetes.data.paquetes);
      setCargandoGrid(false);
    });
  }, [cargarSaldoPropio]);

  // Paso 3: combinaciones de precio para el ítem ya elegido (nunca antes).
  // NO limpiar el error acá. Esta función también se llama después de que
  // una venta falla, para refrescar cupos; si limpiara, borraría el mensaje
  // que vender() acaba de poner y la venta fallaría en silencio.
  const cargarOpciones = useCallback(async (tipo: "UNIDAD" | "PAQUETE", id: string) => {
    setCargandoOpciones(true);
    const { data, error: errorRespuesta } =
      tipo === "UNIDAD" ? await api.ventas.plataformas({ id }).opciones.get() : await api.ventas.paquetes({ id }).opciones.get();
    setCargandoOpciones(false);
    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    setOpciones(data.opciones);
  }, []);

  function abrirModal(nuevoModo: Modo) {
    setModo(nuevoModo);
    setModalAbierto(true);
    setBusquedaModal("");
  }

  function elegirPlataforma(p: PlataformaGrid) {
    setItemSeleccionado({
      tipo: "UNIDAD",
      id: p.id,
      nombre: p.nombre,
      logoUrl: p.logoUrl,
      condiciones: p.condiciones,
      pantallasLibres: p.pantallasLibres,
    });
    setModalAbierto(false);
    setOpciones([]);
    setDuracionId("");
    setTipoClienteId("");
    setCelularCliente("");
    setError(null);
    cargarOpciones("UNIDAD", p.id);
  }

  function elegirPaquete(p: PaqueteGrid) {
    setItemSeleccionado({ tipo: "PAQUETE", id: p.id, nombre: p.nombre, componentes: p.componentes });
    setModalAbierto(false);
    setOpciones([]);
    setDuracionId("");
    setTipoClienteId("");
    setCelularCliente("");
    setError(null);
    cargarOpciones("PAQUETE", p.id);
  }

  // Paso atrás, siempre visible desde el paso 3: vuelve al paso 1 sin
  // perder los datos ya cargados de la grilla (no hay refetch).
  function volverAPaso1() {
    setItemSeleccionado(null);
    setOpciones([]);
    setDuracionId("");
    setTipoClienteId("");
    setCelularCliente("");
    setError(null);
  }

  const itemsDelModal: (PlataformaGrid | PaqueteGrid)[] =
    modo === "UNIDAD" ? plataformasGrid : modo === "PAQUETE" ? paquetesGrid.filter((p) => !p.esPromocion) : modo === "PROMOCION" ? paquetesGrid.filter((p) => p.esPromocion) : [];

  const itemsFiltrados = busquedaModal.trim()
    ? itemsDelModal.filter((i) => i.nombre.toLowerCase().includes(busquedaModal.trim().toLowerCase()))
    : itemsDelModal;

  // Paso 3: duración y tipo de cliente solo muestran las opciones que
  // efectivamente tienen un precio activo para el ítem elegido — nunca la
  // lista completa del catálogo, que llevaría a un callejón sin salida.
  const duracionIdsConPrecio = new Set(opciones.map((o) => o.duracionId));
  const tipoClienteIdsConPrecio = new Set(opciones.map((o) => o.tipoClienteId));
  const duracionesDisponibles = duraciones.filter((d) => duracionIdsConPrecio.has(d.id));
  const tiposClienteDisponibles = tiposCliente.filter((tc) => tipoClienteIdsConPrecio.has(tc.id));
  const opcionElegida = opciones.find((o) => o.duracionId === duracionId && o.tipoClienteId === tipoClienteId);

  async function vender() {
    if (enviandoRef.current || !itemSeleccionado || !opcionElegida) return;
    enviandoRef.current = true;
    setVendiendo(true);
    setError(null);

    const item = itemSeleccionado;
    const celular = celularCliente.trim() || undefined;
    const { data, error: errorRespuesta } =
      item.tipo === "UNIDAD"
        ? await api.ventas.post({ tipoVenta: "UNIDAD", plataformaId: item.id, duracionId, tipoClienteId, celularCliente: celular })
        : await api.ventas.post({ tipoVenta: "PAQUETE", paqueteId: item.id, duracionId, tipoClienteId, celularCliente: celular });

    enviandoRef.current = false;
    setVendiendo(false);

    // `"venta" in data`: mismo patrón que usuarios/page.tsx y
    // empresas/page.tsx — Elysia no logra correlacionar los `set.status`
    // manuales con el `response` declarado, así que el tipo inferido del
    // POST mezcla las formas de éxito y error bajo un 200 implícito.
    if (errorRespuesta || !data || !("venta" in data) || !data.venta) {
      setError(mensajeDeError(errorRespuesta));
      // Alguien pudo agotar el inventario o desactivar el precio entre que
      // se cargó /opciones y este clic: refrescar para que la combinación
      // desaparezca o actualice su precio en vez de quedar mostrando una
      // que ya no existe.
      await cargarOpciones(item.tipo, item.id);
      return;
    }

    setVentaRealizada(data.venta);
    // La venta sí se registró (201); el aviso solo informa que se usó un
    // mensaje de respaldo porque la empresa no configuró su plantilla — no
    // es un error del camino de venta, y no debe perderse en silencio.
    setAvisoVenta("aviso" in data && data.aviso ? data.aviso.mensaje : null);
    if (saldoPropio?.usaSaldo) {
      window.dispatchEvent(new Event(EVENTO_SALDO_ACTUALIZADO));
      await cargarSaldoPropio();
    }
  }

  function nuevaVenta() {
    setVentaRealizada(null);
    setAvisoVenta(null);
    setModo(null);
    setItemSeleccionado(null);
    setOpciones([]);
    setTipoClienteId("");
    setDuracionId("");
    setError(null);
    setCopiado(false);
    setCelularCliente("");
  }

  async function copiarMensaje() {
    if (!ventaRealizada) return;
    await navigator.clipboard.writeText(ventaRealizada.mensajeGenerado);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  if (ventaRealizada) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="titulo-pagina text-ink">Venta registrada</h1>

        {avisoVenta ? <Aviso variante="aviso">{avisoVenta}</Aviso> : null}

        <Tarjeta className="space-y-3">
          <div>
            <p className="etiqueta-dato">Código de compra</p>
            <p className="titulo-seccion text-ink">{ventaRealizada.codigoCompra}</p>
          </div>
          <p className="cuerpo text-ink-2">
            {ventaRealizada.nombreItem} · {ventaRealizada.nombreDuracion} · {ventaRealizada.nombreTipoCliente}
          </p>
          <div>
            <p className="etiqueta-dato">Precio</p>
            <p className="valor-dato text-ink">{formatearPesos(ventaRealizada.precioVenta)}</p>
          </div>
          {ventaRealizada.costo && ventaRealizada.utilidad ? (
            <p className="cuerpo text-ink-muted">
              Costo: {formatearPesos(ventaRealizada.costo)} · Utilidad: {formatearPesos(ventaRealizada.utilidad)}
            </p>
          ) : null}
        </Tarjeta>

        <Tarjeta className="space-y-3 bg-plano">
          <p className="etiqueta-dato">Mensaje para WhatsApp</p>
          <pre className="whitespace-pre-wrap rounded-control border border-borde bg-superficie p-4 font-mono text-sm text-ink">
            {ventaRealizada.mensajeGenerado}
          </pre>
        </Tarjeta>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Boton variante="principal" tamano="lg" type="button" onClick={copiarMensaje} className="h-14 flex-1">
              <Copy />
              Copiar mensaje
            </Boton>
            {copiado ? (
              <Pastilla tono="bien" icono={Check}>
                Copiado
              </Pastilla>
            ) : null}
          </div>
          <Boton variante="contorno" type="button" onClick={nuevaVenta} className="w-full">
            Nueva venta
          </Boton>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="titulo-pagina text-ink">Vender</h1>
        <p className="cuerpo text-ink-muted">El precio no es editable. El celular del cliente final es opcional.</p>
      </div>

      {itemSeleccionado === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <PildoraModo
            modo="UNIDAD"
            icono={Tv}
            nombre="Unidad"
            conteo={plataformasGrid.length}
            cargando={cargandoGrid}
            onClick={() => abrirModal("UNIDAD")}
          />
          <PildoraModo
            modo="PAQUETE"
            icono={Package}
            nombre="Paquete"
            conteo={paquetesGrid.filter((p) => !p.esPromocion).length}
            cargando={cargandoGrid}
            onClick={() => abrirModal("PAQUETE")}
          />
          <PildoraModo
            modo="PROMOCION"
            icono={Tag}
            nombre="Promoción"
            conteo={paquetesGrid.filter((p) => p.esPromocion).length}
            cargando={cargandoGrid}
            onClick={() => abrirModal("PROMOCION")}
          />
        </div>
      ) : (
        <Tarjeta className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {itemSeleccionado.tipo === "UNIDAD" ? (
              <LogoPlataforma logoUrl={itemSeleccionado.logoUrl} nombre={itemSeleccionado.nombre} />
            ) : (
              <div className="flex -space-x-2">
                {itemSeleccionado.componentes.map((c) => (
                  <LogoPlataforma
                    key={c.plataformaId}
                    logoUrl={c.logoUrl}
                    nombre={c.nombrePlataforma}
                    className="size-8 border-2 border-superficie"
                  />
                ))}
              </div>
            )}
            <div>
              <p className="titulo-tarjeta text-ink">{itemSeleccionado.nombre}</p>
              {itemSeleccionado.tipo === "UNIDAD" ? (
                <p className="text-xs text-ink-muted">{itemSeleccionado.pantallasLibres} libre(s)</p>
              ) : null}
            </div>
          </div>
          <Boton variante="fantasma" tamano="sm" type="button" onClick={volverAPaso1}>
            <ArrowLeft />
            Cambiar
          </Boton>
        </Tarjeta>
      )}

      <Modal
        abierto={modalAbierto}
        onCambiarAbierto={setModalAbierto}
        titulo={modo === "UNIDAD" ? "Elige una plataforma" : modo === "PROMOCION" ? "Elige una promoción" : "Elige un paquete"}
        buscador={
          itemsDelModal.length > 12 ? (
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                autoFocus
                value={busquedaModal}
                onChange={(e) => setBusquedaModal(e.target.value)}
                placeholder="Buscar…"
                className="h-9 w-full rounded-control border border-borde bg-plano pl-8 pr-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-secundario"
              />
            </div>
          ) : undefined
        }
      >
        {itemsFiltrados.length === 0 ? (
          <p className="cuerpo text-ink-muted">
            {itemsDelModal.length === 0
              ? modo === "UNIDAD"
                ? "No hay plataformas activas."
                : modo === "PROMOCION"
                  ? "No hay promociones activas."
                  : "No hay paquetes activos."
              : "Ninguna coincide con la búsqueda."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {modo === "UNIDAD"
              ? (itemsFiltrados as PlataformaGrid[]).map((p) => (
                  <TarjetaPlataformaModal key={p.id} plataforma={p} onElegir={() => elegirPlataforma(p)} />
                ))
              : (itemsFiltrados as PaqueteGrid[]).map((p) => (
                  <TarjetaPaqueteModal key={p.id} paquete={p} onElegir={() => elegirPaquete(p)} />
                ))}
          </div>
        )}
      </Modal>

      {error ? (
        <Aviso variante="critico" titulo="No se pudo completar la operación">
          {error}
        </Aviso>
      ) : null}

      {itemSeleccionado ? (
        cargandoOpciones ? (
          <p className="cuerpo text-ink-muted">Cargando combinaciones de precio…</p>
        ) : opciones.length === 0 ? (
          <Aviso variante="info">
            {itemSeleccionado.tipo === "UNIDAD" ? "Esta plataforma" : "Este paquete"} no tiene combinaciones de precio
            configuradas.
          </Aviso>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Tipo de cliente">
                {(props) => (
                  <SelectCampo {...props} value={tipoClienteId} onChange={(e) => setTipoClienteId(e.target.value)}>
                    <option value="">Selecciona…</option>
                    {tiposClienteDisponibles.map((tc) => (
                      <option key={tc.id} value={tc.id}>
                        {tc.nombre}
                      </option>
                    ))}
                  </SelectCampo>
                )}
              </Campo>

              <Campo etiqueta="Duración">
                {(props) => (
                  <SelectCampo {...props} value={duracionId} onChange={(e) => setDuracionId(e.target.value)}>
                    <option value="">Selecciona…</option>
                    {duracionesDisponibles.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nombre}
                      </option>
                    ))}
                  </SelectCampo>
                )}
              </Campo>
            </div>

            {duracionId && tipoClienteId && !opcionElegida ? (
              <p className="text-xs text-ink-muted">No hay precio configurado para esa combinación.</p>
            ) : null}

            {opcionElegida ? (
              <Tarjeta className="space-y-3">
                <div>
                  <p className="etiqueta-dato">Precio</p>
                  <p className="valor-dato text-ink">{formatearPesos(opcionElegida.precioVenta)}</p>
                </div>
                {saldoPropio?.usaSaldo ? (
                  <div className="flex items-center justify-between border-t border-borde pt-3">
                    <span className="flex items-center gap-1.5 text-sm text-ink-2">
                      <Wallet className="size-4" />
                      Tu saldo
                    </span>
                    <span className="tabular-nums text-sm font-medium text-ink">
                      {formatearPesos(saldoPropio.saldo ?? "0")}
                    </span>
                  </div>
                ) : null}
              </Tarjeta>
            ) : null}

            <Campo
              etiqueta="Celular del cliente (opcional)"
              error={
                celularCliente.trim() && !CELULAR_VALIDO.test(celularCliente.trim())
                  ? "Revisa el formato: solo dígitos, espacios y '+', entre 7 y 15 caracteres."
                  : null
              }
            >
              {(props) => (
                <EntradaCampo
                  {...props}
                  type="tel"
                  placeholder="Ej. 3001234567"
                  value={celularCliente}
                  onChange={(e) => setCelularCliente(e.target.value)}
                />
              )}
            </Campo>

            <Boton
              variante="principal"
              type="button"
              disabled={!opcionElegida || vendiendo}
              onClick={vender}
              className="h-14 w-full text-base"
            >
              {vendiendo ? "Vendiendo…" : "Vender"}
            </Boton>
          </>
        )
      ) : null}
    </div>
  );
}
