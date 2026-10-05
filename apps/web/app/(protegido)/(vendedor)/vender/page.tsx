"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";
import { Tarjeta } from "@/components/ui/tarjeta";
import { Campo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Pastilla } from "@/components/ui/pastilla";

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

type Modo = "UNIDAD" | "PAQUETE";

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
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "flex-1 rounded-control border px-4 py-3 text-sm font-semibold transition-colors sm:flex-none sm:px-8",
        activo
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
  }, []);

  const cargarOpciones = useCallback(async () => {
    if (!modo || !tipoClienteId || !duracionId) return;
    setCargandoOpciones(true);
    setError(null);
    const query = { duracionId, tipoClienteId };

    if (modo === "UNIDAD") {
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
  }, [modo, tipoClienteId, duracionId]);

  useEffect(() => {
    setProductos([]);
    setProductoId("");
    cargarOpciones();
  }, [cargarOpciones]);

  function elegirModo(nuevoModo: Modo) {
    setModo(nuevoModo);
    setTipoClienteId("");
    setDuracionId("");
    setProductoId("");
    setProductos([]);
    setError(null);
  }

  const productoSeleccionado = productos.find((p) => p.id === productoId) ?? null;

  async function vender() {
    if (enviandoRef.current || !productoSeleccionado) return;
    enviandoRef.current = true;
    setVendiendo(true);
    setError(null);

    const item = productoSeleccionado;
    const { data, error: errorRespuesta } =
      modo === "UNIDAD"
        ? await api.ventas.post({ tipoVenta: "UNIDAD", plataformaId: item.id, duracionId, tipoClienteId })
        : await api.ventas.post({ tipoVenta: "PAQUETE", paqueteId: item.id, duracionId, tipoClienteId });

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
        <p className="cuerpo text-ink-muted">El precio no es editable y no se pide ningún dato del cliente final.</p>
      </div>

      <div className="flex gap-2">
        <PestanaModo activo={modo === "UNIDAD"} onClick={() => elegirModo("UNIDAD")}>
          Unidad
        </PestanaModo>
        <PestanaModo activo={modo === "PAQUETE"} onClick={() => elegirModo("PAQUETE")}>
          Paquete
        </PestanaModo>
      </div>

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
                {productos.map((p) => (
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

      {modo && tipoClienteId && duracionId && !cargandoOpciones && productos.length === 0 ? (
        <Aviso variante="info">
          No hay {modo === "UNIDAD" ? "plataformas" : "paquetes"} disponibles para esta combinación.
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
        </Tarjeta>
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
