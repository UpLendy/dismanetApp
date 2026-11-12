import { Prisma } from "../generated/prisma/client.ts";

// Prisma.TransactionClient (no PrismaClient completo): así esta función
// acepta tanto prismaParaEmpresa(empresaId) como prismaParaEmpresa(empresaId,
// tx) dentro de una transacción — el cliente transaccional no tiene
// $connect/$disconnect/$on/$use/$extends, pero sí todos los delegados de
// modelo que esta función necesita.
type ClienteEmpresa = Prisma.TransactionClient;

/** PIN de 4 dígitos propuesto para una pantalla nueva (dentro del rango 4-6 de PIN_PATRON). */
export function pinAleatorio(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Un PIN por perfil DISTINTO en `perfiles`, reutilizado en cada repetición
 * (F4.2, parte 2.2): mismo perfil ⇒ mismo PIN, siempre — dos pantallas con
 * perfil "B" nunca pueden entregar PINes distintos, porque abren la misma
 * puerta. `perfil = null` no cuenta como repetido: cada fila sin perfil
 * recibe su propio PIN independiente. `excluir` son PINes que no se deben
 * reutilizar (ej. los que el ADMIN ya fijó a mano en otras filas).
 */
export function pinesPorPerfil(
  perfiles: readonly (string | null)[],
  excluir: ReadonlySet<string> = new Set(),
): (string | null)[] {
  const usados = new Set(excluir);
  const pinPorPerfil = new Map<string, string>();

  function pinNuevo(): string {
    let candidato: string;
    do {
      candidato = pinAleatorio();
    } while (usados.has(candidato));
    usados.add(candidato);
    return candidato;
  }

  return perfiles.map((perfil) => {
    if (perfil === null) return pinNuevo();
    const existente = pinPorPerfil.get(perfil);
    if (existente) return existente;
    const nuevo = pinNuevo();
    pinPorPerfil.set(perfil, nuevo);
    return nuevo;
  });
}

export interface EstadoPantalla {
  id: string;
  cuentaId: string;
  // F4.12 — necesario para agrupar por plataforma sin repetir la consulta
  // (ver contarPantallasPorPlataforma, que agrupa sobre su propia consulta
  // mínima, y la prueba de concordancia que cruza ambos caminos).
  plataformaId: string;
  numero: number;
  perfil: string | null;
  activa: boolean;
  /**
   * F4.11 — estado derivado, nunca persistido (no es un enum de Postgres):
   * OCUPADA tiene ≥1 VentaDetalle vigente; POR_REINICIAR está retenida pero
   * sin ninguno vigente (venció y nadie cambió la contraseña en el
   * proveedor); LIBRE no está retenida. `libre` abajo sigue existiendo como
   * atajo (`estado === "LIBRE"`) para no reescribir los ~15 sitios que ya
   * filtran por ese booleano.
   */
  estado: "LIBRE" | "OCUPADA" | "POR_REINICIAR";
  libre: boolean;
  liberadaEn: Date | null;
  ocupadaHasta: Date | null;
  // F4.11 — el mayor fechaVencimiento de un VentaDetalle no anulado de esta
  // pantalla, sin importar si ya pasó: es lo que GET /cuentas/por-reiniciar
  // necesita para mostrar "venció el ...", y ocupadaHasta no sirve porque
  // solo mira VentaDetalle vigentes (null en POR_REINICIAR, que es
  // justamente el caso que hay que mostrar).
  ultimoVencimiento: Date | null;
  ventaId: string | null;
  // F4.7, arreglo 6 — el cliente sobrevende a propósito: una pantalla puede
  // tener más de un VentaDetalle vigente a la vez. Antes esta función solo
  // traía el más reciente (`take: 1`), así que el ADMIN confirmaba un 409
  // viendo un único código sin saber que existía un segundo comprador.
  // Todas las ventas vigentes, no solo la última.
  codigosCompraAfectados: string[];
}

/**
 * R5, en una sola expresión sin ramas ocultas — el único hogar de la regla
 * en TypeScript (ver CLAUDE.md R5 para la lista completa de sitios que
 * deben coincidir, incluido el SQL crudo de bloqueo-pantallas.ts, que la
 * reescribe a propósito porque Prisma no expresa FOR UPDATE SKIP LOCKED).
 * Pura y sin base de datos: toda ruta de lectura que necesite el estado de
 * una pantalla llama a esta función en vez de volver a escribir la
 * condición.
 *
 * | ultimoVencimiento | condición                                        | estado        |
 * |---|---|---|
 * | null               | —                                                 | LIBRE         |
 * | > ahora             | —                                                 | OCUPADA       |
 * | <= ahora            | liberadaEn === null o ultimoVencimiento > liberadaEn | POR_REINICIAR |
 * | <= ahora            | resto                                            | LIBRE         |
 */
export function estadoDesde(
  liberadaEn: Date | null,
  ultimoVencimiento: Date | null,
  ahora: Date,
): "LIBRE" | "OCUPADA" | "POR_REINICIAR" {
  if (ultimoVencimiento === null) return "LIBRE";
  if (ultimoVencimiento > ahora) return "OCUPADA";
  if (liberadaEn === null || ultimoVencimiento > liberadaEn) return "POR_REINICIAR";
  return "LIBRE";
}

/**
 * El detalle completo por pantalla (perfil, ocupadaHasta, ventaId,
 * códigos de compra afectados) para el detalle de cuenta y el 409 de
 * pantalla vendida — el único lugar que todavía necesita el `include`
 * anidado de VentaDetalle. Cualquier sitio que solo necesite CONTEOS debe
 * usar contarPantallasPorPlataforma/contarPantallasPorEstado en su lugar
 * (F4.12): con miles de pantallas, el `include` + `groupBy` de aquí carga
 * el inventario completo a memoria, dos veces.
 *
 * El `liberadaEn` de la pantalla no se puede comparar contra el máximo
 * vencimiento de sus VentaDetalle dentro de un solo `include` de Prisma (no
 * hay forma de referenciar un campo del padre en el filtro del hijo), así
 * que se resuelve con un `groupBy` aparte — nunca trayendo todos los
 * VentaDetalle sin filtrar a memoria, que sobre miles de pantallas sería una
 * lectura sin límite.
 *
 * Si la pregunta abierta P1 del PRD se resuelve (las cuentas que compra
 * DISMANET tienen su propio vencimiento), el único cambio que hace falta es
 * agregar esa condición al `where` de abajo.
 */
async function estadoDePantallas(
  cliente: ClienteEmpresa,
  where: Prisma.PantallaWhereInput,
): Promise<EstadoPantalla[]> {
  const ahora = new Date();
  const pantallas = await cliente.pantalla.findMany({
    where,
    select: {
      id: true,
      cuentaId: true,
      numero: true,
      perfil: true,
      activa: true,
      liberadaEn: true,
      cuenta: { select: { plataformaId: true } },
      ventaDetalles: {
        where: { fechaVencimiento: { gt: ahora }, venta: { anulada: false } },
        select: { fechaVencimiento: true, ventaId: true, venta: { select: { codigoCompra: true } } },
        orderBy: { fechaVencimiento: "desc" },
      },
    },
    orderBy: { numero: "asc" },
  });
  if (pantallas.length === 0) return [];

  const maximos = await cliente.ventaDetalle.groupBy({
    by: ["pantallaId"],
    where: { pantallaId: { in: pantallas.map((p) => p.id) }, venta: { anulada: false } },
    _max: { fechaVencimiento: true },
  });
  const maxVencimientoPorPantalla = new Map(maximos.map((m) => [m.pantallaId, m._max.fechaVencimiento]));

  return pantallas.map((p) => {
    const ocupaciones = p.ventaDetalles;
    const masReciente = ocupaciones[0];
    const maxVencimiento = maxVencimientoPorPantalla.get(p.id) ?? null;
    const estado = estadoDesde(p.liberadaEn, maxVencimiento, ahora);
    return {
      id: p.id,
      cuentaId: p.cuentaId,
      plataformaId: p.cuenta.plataformaId,
      numero: p.numero,
      perfil: p.perfil,
      activa: p.activa,
      estado,
      libre: estado === "LIBRE",
      liberadaEn: p.liberadaEn,
      ocupadaHasta: masReciente?.fechaVencimiento ?? null,
      ultimoVencimiento: maxVencimiento,
      ventaId: masReciente?.ventaId ?? null,
      codigosCompraAfectados: ocupaciones.map((o) => o.venta.codigoCompra),
    };
  });
}

export interface ConteoPantallas {
  libres: number;
  porReiniciar: number;
  ocupadas: number;
}

/**
 * Conteo global de pantallas activas, de cuentas activas, por estado (R5) —
 * el total que alimenta el diagnóstico de empresa. Pasa por estadoDePantallas
 * en vez de mantener su propio `count`, para no duplicar la regla (ver el
 * historial de diagnostico-empresa.ts antes de F4.11: tenía un `count` propio
 * que ya se había quedado atrás de la regla nueva).
 */
export async function contarPantallasPorEstado(cliente: ClienteEmpresa): Promise<ConteoPantallas> {
  const estados = await estadoDePantallas(cliente, { activa: true, cuenta: { activa: true } });
  const conteo: ConteoPantallas = { libres: 0, porReiniciar: 0, ocupadas: 0 };
  for (const e of estados) {
    if (e.estado === "LIBRE") conteo.libres++;
    else if (e.estado === "POR_REINICIAR") conteo.porReiniciar++;
    else conteo.ocupadas++;
  }
  return conteo;
}

/**
 * Pantallas activas, de cuentas activas, de una plataforma — con su estado
 * de ocupación (R5). Trae el detalle completo (perfil, ocupadaHasta,
 * códigos de compra): úsala solo donde haga falta ESE detalle (confirmar un
 * 409, el selector de pantalla puntual). Para contar libres/por-reiniciar
 * de una o varias plataformas, usa contarPantallasPorPlataforma — hace dos
 * consultas para todas las plataformas en vez de dos por cada una.
 */
export async function pantallasDisponibles(cliente: ClienteEmpresa, plataformaId: string): Promise<EstadoPantalla[]> {
  return estadoDePantallas(cliente, { activa: true, cuenta: { activa: true, plataformaId } });
}

/**
 * F4.12 — conteo de pantallas por plataforma (R5), sin el `include`
 * anidado de VentaDetalle: dos consultas en total para TODAS las
 * plataformas (o el subconjunto de `plataformaIds`), en vez de 2N
 * recorriendo pantallasDisponibles una plataforma a la vez. Úsala en
 * cualquier sitio que solo necesite CONTEOS — que son casi todos; el
 * detalle completo (ocupadaHasta, códigos de compra) solo hace falta para
 * el 409 de pantalla vendida y el detalle de cuenta, que siguen usando
 * pantallasDisponibles/pantallasDeCuenta.
 */
export async function contarPantallasPorPlataforma(
  cliente: ClienteEmpresa,
  plataformaIds?: string[],
): Promise<Map<string, ConteoPantallas>> {
  const ahora = new Date();
  const pantallas = await cliente.pantalla.findMany({
    where: {
      activa: true,
      cuenta: { activa: true, ...(plataformaIds ? { plataformaId: { in: plataformaIds } } : {}) },
    },
    select: { id: true, liberadaEn: true, cuenta: { select: { plataformaId: true } } },
  });
  if (pantallas.length === 0) return new Map();

  const maximos = await cliente.ventaDetalle.groupBy({
    by: ["pantallaId"],
    where: { pantallaId: { in: pantallas.map((p) => p.id) }, venta: { anulada: false } },
    _max: { fechaVencimiento: true },
  });
  const maxVencimientoPorPantalla = new Map(maximos.map((m) => [m.pantallaId, m._max.fechaVencimiento]));

  const conteos = new Map<string, ConteoPantallas>();
  for (const p of pantallas) {
    const estado = estadoDesde(p.liberadaEn, maxVencimientoPorPantalla.get(p.id) ?? null, ahora);
    const actual = conteos.get(p.cuenta.plataformaId) ?? { libres: 0, porReiniciar: 0, ocupadas: 0 };
    if (estado === "LIBRE") actual.libres++;
    else if (estado === "POR_REINICIAR") actual.porReiniciar++;
    else actual.ocupadas++;
    conteos.set(p.cuenta.plataformaId, actual);
  }
  return conteos;
}

/**
 * Todas las pantallas de una cuenta puntual (activas o no), con su estado
 * de ocupación — para el detalle de la cuenta y para decidir si se puede
 * bajar su capacidad.
 */
export async function pantallasDeCuenta(cliente: ClienteEmpresa, cuentaId: string): Promise<EstadoPantalla[]> {
  return estadoDePantallas(cliente, { cuentaId });
}

/** Igual que pantallasDeCuenta, pero para varias cuentas a la vez (listados). */
export async function pantallasDeCuentas(cliente: ClienteEmpresa, cuentaIds: string[]): Promise<EstadoPantalla[]> {
  if (cuentaIds.length === 0) return [];
  return estadoDePantallas(cliente, { cuentaId: { in: cuentaIds } });
}

export interface PlataformaDisponible {
  id: string;
  nombre: string;
  condiciones: string | null;
  pantallasLibres: number;
  // F4.11 — sin esto, VENDEDOR ve 0 pantallas sin ninguna explicación cuando
  // en realidad hay cuentas vencidas esperando que ADMIN las reinicie.
  pantallasPorReiniciar: number;
}

/**
 * Entrega 8 (venta rápida, modo UNIDAD) — equivalente de paquetesDisponibles
 * para plataformas individuales: activas, con precio activo para la
 * duración y el tipo de cliente dados, y con al menos una pantalla libre
 * (R5). `condiciones` y `pantallasLibres` son justo lo que el vendedor
 * necesita ver antes de confirmar (ej. "1 pantalla. Solo TV" + "quedan 3").
 */
export async function plataformasDisponibles(
  cliente: ClienteEmpresa,
  duracionId: string,
  tipoClienteId: string,
): Promise<PlataformaDisponible[]> {
  const plataformas = await cliente.plataforma.findMany({
    where: { activa: true },
    select: { id: true, nombre: true, condiciones: true },
  });
  if (plataformas.length === 0) return [];

  const preciosActivos = await cliente.precio.findMany({
    where: {
      activo: true,
      duracionId,
      tipoClienteId,
      plataformaId: { in: plataformas.map((p) => p.id) },
    },
    select: { plataformaId: true },
  });
  const plataformasConPrecio = new Set(preciosActivos.map((p) => p.plataformaId));

  const plataformasFiltradas = plataformas.filter((plataforma) => plataformasConPrecio.has(plataforma.id));
  const conteosPorPlataforma = await contarPantallasPorPlataforma(cliente, plataformasFiltradas.map((p) => p.id));
  const conDisponibilidad = plataformasFiltradas.map((plataforma) => {
    const conteo = conteosPorPlataforma.get(plataforma.id) ?? { libres: 0, porReiniciar: 0, ocupadas: 0 };
    return {
      ...plataforma,
      pantallasLibres: conteo.libres,
      pantallasPorReiniciar: conteo.porReiniciar,
    };
  });

  // F4.11 — antes este filtro era `pantallasLibres > 0`: una plataforma con
  // todas sus pantallas POR_REINICIAR (0 libres) desaparecía sin dejar
  // rastro, y el vendedor veía 0 opciones sin ninguna explicación. Ahora se
  // queda en la lista si tiene algo que explicar, aunque no tenga nada que
  // vender hoy; el frontend decide si la deshabilita.
  return conDisponibilidad.filter(
    (plataforma) => plataforma.pantallasLibres > 0 || plataforma.pantallasPorReiniciar > 0,
  );
}

export interface PlataformaConInventario {
  id: string;
  nombre: string;
  condiciones: string | null;
  pantallasLibres: number;
}

/**
 * F4.3 — catálogo para registrar una garantía externa: plataformas activas
 * con al menos una pantalla libre (R5). A diferencia de plataformasDisponibles,
 * no depende de Precio: una garantía externa no fija un precio de venta, no
 * hay tipoCliente ni duración que buscar en la matriz de precios.
 */
export async function plataformasConInventario(cliente: ClienteEmpresa): Promise<PlataformaConInventario[]> {
  const plataformas = await cliente.plataforma.findMany({
    where: { activa: true },
    select: { id: true, nombre: true, condiciones: true },
  });

  const conteosPorPlataforma = await contarPantallasPorPlataforma(cliente, plataformas.map((p) => p.id));
  const conDisponibilidad = plataformas.map((plataforma) => ({
    ...plataforma,
    pantallasLibres: conteosPorPlataforma.get(plataforma.id)?.libres ?? 0,
  }));

  return conDisponibilidad.filter((plataforma) => plataforma.pantallasLibres > 0);
}
