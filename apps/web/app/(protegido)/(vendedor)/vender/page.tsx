"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Plus, ShieldAlert, Trash2, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { satisfaceRol, type Rol } from "@/lib/rol";
import { Boton } from "@/components/ui/boton";
import { Tarjeta } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo, SelectCampo, idUnico } from "@/components/ui/campo";
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

// Una fila = un servicio dentro de una venta UNIDAD (F4.4). Repetir la misma
// plataformaId en dos filas es válido (pide dos pantallas de esa
// plataforma) — por eso se identifican por `key`, no por `plataformaId`.
interface FilaUnidad {
  key: string;
  plataformaId: string;
}

function filaVacia(): FilaUnidad {
  return { key: idUnico("fila"), plataformaId: "" };
}

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

// Suma de precios en centavos (BigInt), nunca Number: dos decimales de
// redondeo flotante en una suma visible de varios servicios sería un bug de
// plata, no solo de estética (CLAUDE.md — dinero nunca number flotante).
function centavos(valor: string): bigint {
  const [entero, decimal = ""] = valor.split(".");
  const decimalCentavos = (decimal + "00").slice(0, 2) || "00";
  return BigInt(entero || "0") * BigInt(100) + BigInt(decimalCentavos);
}

function sumarPesos(valores: string[]): string {
  const totalCentavos = valores.reduce((suma, valor) => suma + centavos(valor), BigInt(0));
  const enteroTotal = totalCentavos / BigInt(100);
  const decimalTotal = (totalCentavos % BigInt(100)).toString().padStart(2, "0");
  return decimalTotal === "00" ? enteroTotal.toString() : `${enteroTotal.toString()}.${decimalTotal}`;
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
  const router = useRouter();

  // Arranca en UNIDAD: es la pantalla de más prisa del sistema y abrir sin
  // modo deja al vendedor viendo tres pestañas, ningún formulario y un botón
  // muerto. Con dos pestañas venía seleccionado; se perdió al entrar la
  // tercera. El tipo sigue admitiendo null porque elegirModo lo usa.
  const [modo, setModo] = useState<Modo | null>("UNIDAD");
  const [tiposCliente, setTiposCliente] = useState<Opcion[]>([]);
  const [duraciones, setDuraciones] = useState<Opcion[]>([]);
  const [tipoClienteId, setTipoClienteId] = useState("");
  const [duracionId, setDuracionId] = useState("");
  const [productoId, setProductoId] = useState("");

  // F4.4: solo para modo UNIDAD. Paquete y Promoción siguen con un único
  // producto (productoId) — esa parte del formulario no cambia.
  const [filasUnidad, setFilasUnidad] = useState<FilaUnidad[]>(() => [filaVacia()]);
  const [precioFinalTexto, setPrecioFinalTexto] = useState("");

  const [productos, setProductos] = useState<ProductoDisponible[]>([]);
  const [cargandoOpciones, setCargandoOpciones] = useState(false);

  const [vendiendo, setVendiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ventaRealizada, setVentaRealizada] = useState<VentaRealizada | null>(null);
  const [avisoVenta, setAvisoVenta] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [celularCliente, setCelularCliente] = useState("");

  // Rol propio (F4.4 Parte 3): el precio final solo se ofrece a EMPLEADO+.
  // R4 — esto es solo UX; el servidor rechaza con 403 igual si alguien
  // manda el campo a mano sin el rol, ocultar el input no es el control.
  const [rol, setRol] = useState<Rol | null>(null);

  // F4.6: Garantía es una operación, no un producto — NO entra en `Modo`
  // (ese tipo significa "qué categoría de producto"). Vive en su propio
  // estado: abierta/cerrada, la respuesta a "¿está en el sistema?" (null =
  // sin responder) y el valor del campo de búsqueda.
  const [garantiaAbierta, setGarantiaAbierta] = useState(false);
  const [garantiaEnSistema, setGarantiaEnSistema] = useState<boolean | null>(null);
  const [garantiaValor, setGarantiaValor] = useState("");

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
    api.perfil.get().then(({ data }) => {
      if (data) setRol(data.usuario.rol);
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
    setFilasUnidad([filaVacia()]);
    setPrecioFinalTexto("");
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
    setFilasUnidad([filaVacia()]);
    setPrecioFinalTexto("");
    setError(null);
    if (!mismaCategoria) {
      setTipoClienteId("");
      setDuracionId("");
      setProductos([]);
    }
  }

  // F4.6 — abre/cierra el tile de Garantía sin tocar `modo`: es una
  // operación distinta, no una cuarta pestaña de producto. Cerrarlo
  // (segundo clic) limpia la respuesta y el campo para la próxima vez.
  function alternarGarantia() {
    setGarantiaAbierta((abierta) => {
      const siguiente = !abierta;
      if (!siguiente) {
        setGarantiaEnSistema(null);
        setGarantiaValor("");
      }
      return siguiente;
    });
  }

  // La venta fue hecha por fuera del sistema: no hay fila que buscar, abre
  // directo el diálogo de garantía externa en /pantallas-vendidas.
  function elegirGarantiaExterna() {
    router.push("/pantallas-vendidas?garantiaExterna=1");
  }

  // Un solo campo para código de compra o correo de cuenta (spec F4.6): se
  // decide cuál enviar por la forma del valor, un correo siempre tiene '@'
  // y un código de compra nunca lo tiene. routes/garantias.ts ya acepta
  // ambos por `contains` insensible a mayúsculas.
  function continuarGarantiaEnSistema() {
    const valor = garantiaValor.trim();
    if (!valor) return;
    const parametro = valor.includes("@") ? "correoCuenta" : "codigoCompra";
    router.push(`/pantallas-vendidas?${parametro}=${encodeURIComponent(valor)}`);
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

  // Misma regla, en sentido contrario: si el día que no haya paquetes
  // normales (solo promociones), la pestaña Paquete se deshabilita igual.
  const paqueteSinOpciones =
    categoria === "PAQUETE" &&
    tipoClienteId !== "" &&
    duracionId !== "" &&
    !cargandoOpciones &&
    productos.some((p) => !esPlataforma(p)) &&
    !productos.some((p) => !esPlataforma(p) && !p.esPromocion);

  // F4.4: "renglón" cuenta cada fila elegida, repetidos incluidos — es la
  // misma cuenta que hace el servidor para decidir plantilla UNIDAD vs
  // PAQUETE y para exigir 2+ antes de aceptar un precio final.
  const filasCompletas = filasUnidad.filter((f) => f.plataformaId !== "");
  const esMultiProducto = modo === "UNIDAD" && filasCompletas.length >= 2;
  const puedeDescuento = rol !== null && satisfaceRol(rol, "EMPLEADO");

  // F4.6: mismo mecanismo que puedeDescuento (ya trae el rol del vendedor
  // vía api.perfil.get) — nombre propio porque es una decisión distinta
  // (mostrar el tile de Garantía, no el campo de precio final). Ausente
  // para VENDEDOR, no deshabilitado: las garantías son requiereRol(EMPLEADO)
  // en el servidor (R4), esto es solo ocultar lo que ya rechazaría un 403.
  const puedeGarantia = rol !== null && satisfaceRol(rol, "EMPLEADO");

  function plataformaPorId(id: string): PlataformaDisponible | undefined {
    const p = productos.find((prod) => prod.id === id);
    return p && esPlataforma(p) ? p : undefined;
  }

  const totalSugeridoTexto = sumarPesos(filasCompletas.map((f) => plataformaPorId(f.plataformaId)?.precioVenta ?? "0"));

  // Vista de un solo producto: la misma tarjeta de siempre, ya sea un único
  // servicio en modo Unidad, un paquete o una promoción. En 2+ renglones de
  // Unidad no hay "un" producto que mostrar — ver el resumen más abajo.
  const productoSeleccionado: ProductoDisponible | null =
    modo === "UNIDAD"
      ? filasCompletas.length === 1
        ? productosVisibles.find((p) => p.id === filasCompletas[0]!.plataformaId) ?? null
        : null
      : (productosVisibles.find((p) => p.id === productoId) ?? null);

  const listoParaVender =
    modo === "UNIDAD" ? filasUnidad.length > 0 && filasUnidad.every((f) => f.plataformaId !== "") : !!productoSeleccionado;

  function agregarFila() {
    setFilasUnidad((filas) => [...filas, filaVacia()]);
  }

  function quitarFila(key: string) {
    // Nunca deja la lista en cero: siempre hay al menos una fila que llenar.
    setFilasUnidad((filas) => (filas.length > 1 ? filas.filter((f) => f.key !== key) : filas));
  }

  function actualizarFila(key: string, plataformaId: string) {
    setFilasUnidad((filas) => filas.map((f) => (f.key === key ? { ...f, plataformaId } : f)));
  }

  async function vender() {
    if (enviandoRef.current || !listoParaVender) return;
    enviandoRef.current = true;
    setVendiendo(true);
    setError(null);

    const celular = celularCliente.trim() || undefined;
    const precioFinalRecortado = precioFinalTexto.trim();
    const incluirPrecioFinal = esMultiProducto && puedeDescuento && precioFinalRecortado !== "";

    const { data, error: errorRespuesta } =
      modo === "UNIDAD"
        ? await api.ventas.post({
            tipoVenta: "UNIDAD",
            plataformas: filasCompletas.map((f) => f.plataformaId),
            duracionId,
            tipoClienteId,
            celularCliente: celular,
            ...(incluirPrecioFinal ? { precioFinal: precioFinalRecortado } : {}),
          })
        : await api.ventas.post({
            tipoVenta: "PAQUETE",
            paqueteId: (productoSeleccionado as PaqueteDisponible).id,
            duracionId,
            tipoClienteId,
            celularCliente: celular,
          });

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
    setTipoClienteId("");
    setDuracionId("");
    setProductoId("");
    setFilasUnidad([filaVacia()]);
    setPrecioFinalTexto("");
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

        {avisoVenta ? <Aviso variante="aviso">{avisoVenta}</Aviso> : null}

        <Tarjeta className="space-y-3">
          <div>
            <p className="etiqueta-dato">Código de compra</p>
            <p className="titulo-seccion text-ink">{ventaRealizada.codigoCompra}</p>
          </div>
          <p className="cuerpo text-ink-2">
            {ventaRealizada.nombreItem} · {ventaRealizada.nombreDuracion} · {ventaRealizada.nombreTipoCliente}
          </p>
          <div className="@container">
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
        <p className="cuerpo text-ink-muted">El celular del cliente final es opcional.</p>
      </div>

      <div className="flex gap-2">
        <PestanaModo activo={modo === "UNIDAD"} onClick={() => elegirModo("UNIDAD")}>
          Unidad
        </PestanaModo>
        <PestanaModo
          activo={modo === "PAQUETE"}
          deshabilitado={paqueteSinOpciones}
          titulo={paqueteSinOpciones ? "No hay paquetes activos con precio para esta combinación." : undefined}
          onClick={() => elegirModo("PAQUETE")}
        >
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

      {/* F4.6 — fila separada, nunca una cuarta pestaña: Unidad/Paquete/
          Promoción traen plata, Garantía saca inventario y registra
          pérdida. La distinción va por forma (contorno, nunca el relleno
          de "Vender"), no por color (DISENO.md §2 reserva los colores de
          estado). Nota para el futuro: al restaurar F3.3 (grilla de
          productos nueva), este tile viaja con ella — no se agrega solo
          a la grilla, se mueve. */}
      {puedeGarantia ? (
        <div className="space-y-3 border-t border-borde pt-4">
          <Boton variante="contorno" type="button" onClick={alternarGarantia} className="w-full sm:w-auto">
            <ShieldAlert className="size-4" />
            Garantía
          </Boton>

          {garantiaAbierta ? (
            <Tarjeta className="space-y-3">
              <p className="titulo-tarjeta text-ink">¿La venta está en el sistema?</p>
              {garantiaEnSistema === null ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Boton variante="contorno" type="button" onClick={() => setGarantiaEnSistema(true)} className="flex-1">
                    Sí
                  </Boton>
                  <Boton variante="contorno" type="button" onClick={elegirGarantiaExterna} className="flex-1">
                    No, fue una venta hecha por fuera
                  </Boton>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    continuarGarantiaEnSistema();
                  }}
                  className="space-y-3"
                >
                  <Campo etiqueta="Código de compra o correo de la cuenta">
                    {(props) => (
                      <EntradaCampo
                        {...props}
                        type="text"
                        placeholder="DIS995865 o cuenta@correo.com"
                        value={garantiaValor}
                        onChange={(e) => setGarantiaValor(e.target.value)}
                      />
                    )}
                  </Campo>
                  <div className="flex gap-2">
                    <Boton variante="contorno" type="button" onClick={() => setGarantiaEnSistema(null)}>
                      Atrás
                    </Boton>
                    <Boton variante="secundario" type="submit" disabled={!garantiaValor.trim()} className="flex-1">
                      Buscar
                    </Boton>
                  </div>
                </form>
              )}
            </Tarjeta>
          ) : null}
        </div>
      ) : null}

      {modo ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Tipo de cliente">
              {(props) => (
                <SelectCampo {...props} value={tipoClienteId} onChange={(e) => setTipoClienteId(e.target.value)}>
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
          </div>

          {modo === "UNIDAD" ? (
            <div className="space-y-3">
              {filasUnidad.map((fila, indice) => (
                <div key={fila.key} className="flex items-end gap-2">
                  <Campo etiqueta={indice === 0 ? "Producto" : `Servicio ${indice + 1}`} className="flex-1">
                    {(props) => (
                      <SelectCampo
                        {...props}
                        value={fila.plataformaId}
                        disabled={!tipoClienteId || !duracionId || cargandoOpciones}
                        onChange={(e) => actualizarFila(fila.key, e.target.value)}
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
                  {filasUnidad.length > 1 ? (
                    <Boton
                      variante="contorno"
                      type="button"
                      aria-label="Quitar servicio"
                      onClick={() => quitarFila(fila.key)}
                      className="h-10 shrink-0 px-3"
                    >
                      <Trash2 className="size-4" />
                    </Boton>
                  ) : null}
                </div>
              ))}
              <Boton
                variante="contorno"
                type="button"
                disabled={!tipoClienteId || !duracionId || cargandoOpciones}
                onClick={agregarFila}
                className="w-full"
              >
                <Plus className="size-4" />
                Agregar otro servicio
              </Boton>
            </div>
          ) : (
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
          )}
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

      {esMultiProducto ? (
        <Tarjeta className="space-y-3">
          <ul className="space-y-1">
            {filasCompletas.map((fila) => {
              const plataforma = plataformaPorId(fila.plataformaId);
              if (!plataforma) return null;
              return (
                <li key={fila.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink">{plataforma.nombre}</span>
                  <span className="tabular-nums text-ink-2">{formatearPesos(plataforma.precioVenta)}</span>
                </li>
              );
            })}
          </ul>
          <div className="@container flex items-center justify-between gap-3 border-t border-borde pt-3">
            <p className="etiqueta-dato shrink-0">Total sugerido</p>
            <p className="valor-dato min-w-0 text-ink">{formatearPesos(totalSugeridoTexto)}</p>
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
          {puedeDescuento ? (
            <div className="border-t border-borde pt-3">
              <Campo
                etiqueta="Precio final (opcional)"
                ayuda={`Déjalo vacío para cobrar el sugerido, ${formatearPesos(totalSugeridoTexto)}.`}
              >
                {(props) => (
                  <EntradaCampo
                    {...props}
                    type="text"
                    inputMode="decimal"
                    placeholder={totalSugeridoTexto}
                    value={precioFinalTexto}
                    onChange={(e) => setPrecioFinalTexto(e.target.value)}
                  />
                )}
              </Campo>
            </div>
          ) : null}
        </Tarjeta>
      ) : productoSeleccionado ? (
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
          <div className="@container">
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
        disabled={!listoParaVender || vendiendo}
        onClick={vender}
        className="h-14 w-full text-base"
      >
        {vendiendo ? "Vendiendo…" : "Vender"}
      </Boton>
    </div>
  );
}
