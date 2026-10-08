"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";
import { Tarjeta } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Pastilla } from "@/components/ui/pastilla";
import { EVENTO_SALDO_ACTUALIZADO } from "@/lib/eventos";

interface Opcion {
  id: string;
  nombre: string;
}

interface PlataformaDisponible {
  id: string;
  nombre: string;
  condiciones: string | null;
  pantallasLibres: number;
  precioVenta: string;
}

interface PaqueteDisponible {
  id: string;
  nombre: string;
  precioVenta: string;
  esPromocion: boolean;
}

type ProductoDisponible = PlataformaDisponible | PaqueteDisponible;

function esPlataforma(p: ProductoDisponible): p is PlataformaDisponible {
  return "pantallasLibres" in p;
}

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

function PestanaModo({
  activo,
  deshabilitado,
  titulo,
  onClick,
  children,
}: {
  activo: boolean;
  deshabilitado?: boolean;
  titulo?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      aria-pressed={activo}
      title={titulo}
      className={cn(
        // 3 pestañas: en móvil, selector segmentado de ancho completo
        // (flex-1, mismo texto 14px) con menos padding horizontal que en
        // sm: para que "Promoción" no desborde.
        "flex-1 rounded-control border px-2 py-3 text-sm font-semibold transition-colors sm:flex-none sm:px-8",
        deshabilitado
          ? "cursor-not-allowed border-borde bg-superficie text-ink-muted opacity-60"
          : activo
            ? "border-primario-suave bg-primario-suave text-primario-texto"
            : "border-borde bg-superficie text-ink-2 hover:bg-black/4 dark:hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );
}

export default function PaginaVender() {
  const [modo, setModo] = useState<Modo | null>(null);
  const [tiposCliente, setTiposCliente] = useState<Opcion[]>([]);
  const [duraciones, setDuraciones] = useState<Opcion[]>([]);
  const [tipoClienteId, setTipoClienteId] = useState("");
  const [duracionId, setDuracionId] = useState("");
  const [productoId, setProductoId] = useState("");

  const [productos, setProductos] = useState<ProductoDisponible[]>([]);
  const [cargandoOpciones, setCargandoOpciones] = useState(false);

  const [vendiendo, setVendiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ventaRealizada, setVentaRealizada] = useState<VentaRealizada | null>(null);
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
  }, [cargarSaldoPropio]);

  // Paquete y Promoción son la misma categoría de producto a efectos de la
  // petición: un solo endpoint (`/ventas/paquetes`), una sola petición. El
  // frontend reparte el resultado por `esPromocion` (ver productosVisibles).
  // Esto también evita refetch al alternar entre esas dos pestañas.
  const categoria: "UNIDAD" | "PAQUETE" | null = modo === "UNIDAD" ? "UNIDAD" : modo ? "PAQUETE" : null;

  const cargarOpciones = useCallback(async () => {
    if (!categoria || !tipoClienteId || !duracionId) return;
    setCargandoOpciones(true);
    // NO limpiar el error acá. Esta función también se llama después de que
    // una venta falla, para refrescar cupos; si limpiara, borraría el mensaje
    // que vender() acaba de poner y la venta fallaría en silencio. Limpiar al
    // cambiar de selección es responsabilidad del efecto de abajo.
    const query = { duracionId, tipoClienteId };

    if (categoria === "UNIDAD") {
      const { data, error: errorRespuesta } = await api.ventas.plataformas.get({ query });
      setCargandoOpciones(false);
      if (errorRespuesta || !data) {
        setError(mensajeDeError(errorRespuesta));
        return;
      }
      setProductos(data.plataformas);
    } else {
      const { data, error: errorRespuesta } = await api.ventas.paquetes.get({ query });
      setCargandoOpciones(false);
      if (errorRespuesta || !data) {
        setError(mensajeDeError(errorRespuesta));
        return;
      }
      setProductos(data.paquetes);
    }
  }, [categoria, tipoClienteId, duracionId]);

  useEffect(() => {
    setProductos([]);
    setProductoId("");
    setError(null);
    cargarOpciones();
  }, [cargarOpciones]);

  function elegirModo(nuevoModo: Modo) {
    // Paquete <-> Promoción comparten categoría: conservar tipo de cliente,
    // duración y la lista ya cargada (no hace falta refetch ni vaciar el
    // formulario). Entrar o salir de Unidad sí reinicia todo.
    const mismaCategoria = modo !== null && modo !== "UNIDAD" && nuevoModo !== "UNIDAD";
    setModo(nuevoModo);
    setProductoId("");
    setError(null);
    if (!mismaCategoria) {
      setTipoClienteId("");
      setDuracionId("");
      setProductos([]);
    }
  }

  // Un paquete aparece en una sola pestaña: Paquete lista esPromocion=false,
  // Promoción lista esPromocion=true. En Unidad, productos ya son solo
  // plataformas.
  const productosVisibles: ProductoDisponible[] =
    modo === "PAQUETE"
      ? productos.filter((p) => !esPlataforma(p) && !p.esPromocion)
      : modo === "PROMOCION"
        ? productos.filter((p) => !esPlataforma(p) && p.esPromocion)
        : productos;

  // Deshabilitar la pestaña Promoción solo cuando ya se intentó cargar la
  // categoría Paquete con un tipo de cliente y duración elegidos y el
  // resultado no trajo ninguna promoción: antes de eso no hay evidencia
  // para deshabilitarla (podría tenerla con otra combinación).
  const promocionSinOpciones =
    categoria === "PAQUETE" &&
    tipoClienteId !== "" &&
    duracionId !== "" &&
    !cargandoOpciones &&
    productos.some((p) => !esPlataforma(p)) &&
    !productos.some((p) => !esPlataforma(p) && p.esPromocion);

  const productoSeleccionado = productosVisibles.find((p) => p.id === productoId) ?? null;

  async function vender() {
    if (enviandoRef.current || !productoSeleccionado) return;
    enviandoRef.current = true;
    setVendiendo(true);
    setError(null);

    const item = productoSeleccionado;
    const celular = celularCliente.trim() || undefined;
    const { data, error: errorRespuesta } =
      modo === "UNIDAD"
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
      // Alguien pudo agotar el inventario entre que se cargó la lista y
      // este clic: refrescar para que la opción desaparezca o actualice su
      // contador en vez de quedar mostrando un cupo que ya no existe.
      await cargarOpciones();
      return;
    }

    setVentaRealizada(data.venta);
    if (saldoPropio?.usaSaldo) {
      window.dispatchEvent(new Event(EVENTO_SALDO_ACTUALIZADO));
      await cargarSaldoPropio();
    }
  }

  function nuevaVenta() {
    setVentaRealizada(null);
    setModo(null);
    setTipoClienteId("");
    setDuracionId("");
    setProductoId("");
    setProductos([]);
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

      <div className="flex gap-2">
        <PestanaModo activo={modo === "UNIDAD"} onClick={() => elegirModo("UNIDAD")}>
          Unidad
        </PestanaModo>
        <PestanaModo activo={modo === "PAQUETE"} onClick={() => elegirModo("PAQUETE")}>
          Paquete
        </PestanaModo>
        <PestanaModo
          activo={modo === "PROMOCION"}
          deshabilitado={promocionSinOpciones}
          titulo={promocionSinOpciones ? "No hay promociones activas con precio para esta combinación." : undefined}
          onClick={() => elegirModo("PROMOCION")}
        >
          Promoción
        </PestanaModo>
      </div>

      {promocionSinOpciones ? (
        <p className="text-xs text-ink-muted">
          No hay promociones activas con precio para el tipo de cliente y la duración elegidos.
        </p>
      ) : null}

      {modo ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo etiqueta="Tipo de cliente">
            {(props) => (
              <SelectCampo
                {...props}
                value={tipoClienteId}
                onChange={(e) => setTipoClienteId(e.target.value)}
              >
                <option value="">Selecciona…</option>
                {tiposCliente.map((tc) => (
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
                {duraciones.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </SelectCampo>
            )}
          </Campo>

          <Campo etiqueta="Producto">
            {(props) => (
              <SelectCampo
                {...props}
                value={productoId}
                disabled={!tipoClienteId || !duracionId || cargandoOpciones}
                onChange={(e) => setProductoId(e.target.value)}
              >
                <option value="">{cargandoOpciones ? "Cargando…" : "Selecciona…"}</option>
                {productosVisibles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                    {esPlataforma(p) ? ` — ${p.pantallasLibres} libre(s)` : ""}
                  </option>
                ))}
              </SelectCampo>
            )}
          </Campo>
        </div>
      ) : null}

      {error ? (
        <Aviso variante="critico" titulo="No se pudo completar la operación">
          {error}
        </Aviso>
      ) : null}

      {modo && tipoClienteId && duracionId && !cargandoOpciones && productosVisibles.length === 0 ? (
        <Aviso variante="info">
          No hay {modo === "UNIDAD" ? "plataformas" : modo === "PROMOCION" ? "promociones" : "paquetes"} disponibles
          para esta combinación.
        </Aviso>
      ) : null}

      {productoSeleccionado ? (
        <Tarjeta className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="titulo-tarjeta text-ink">{productoSeleccionado.nombre}</p>
            {esPlataforma(productoSeleccionado) ? (
              <span className="shrink-0 text-xs text-ink-muted">{productoSeleccionado.pantallasLibres} libre(s)</span>
            ) : null}
          </div>
          {esPlataforma(productoSeleccionado) && productoSeleccionado.condiciones ? (
            <p className="cuerpo text-ink-2">{productoSeleccionado.condiciones}</p>
          ) : null}
          <div>
            <p className="etiqueta-dato">Precio</p>
            <p className="valor-dato text-ink">{formatearPesos(productoSeleccionado.precioVenta)}</p>
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

      {modo ? (
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
      ) : null}

      <Boton
        variante="principal"
        type="button"
        disabled={!productoSeleccionado || vendiendo}
        onClick={vender}
        className="h-14 w-full text-base"
      >
        {vendiendo ? "Vendiendo…" : "Vender"}
      </Boton>
    </div>
  );
}
