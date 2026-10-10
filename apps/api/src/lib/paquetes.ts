import { Prisma, type UnidadDuracion } from "../generated/prisma/client.ts";
import { pantallasDisponibles } from "./pantallas.ts";

// Prisma.TransactionClient (no PrismaClient completo): la venta rápida
// (entrega 8) llama estas funciones DESDE DENTRO de su propia transacción —
// ver el comentario equivalente en pantallas.ts.
type ClienteEmpresa = Prisma.TransactionClient;

export interface ComponentePaquete {
  plataformaId: string;
  nombrePlataforma: string;
  cantidadPantallas: number;
  duracionId: string;
  cantidadDuracion: number;
  unidadDuracion: UnidadDuracion;
}

/**
 * Parte 5 — la función que la venta rápida (entrega 8) usa para saber
 * cuántas pantallas tomar de cada plataforma del paquete y con qué
 * vigencia entregarlas.
 *
 * Por defecto cada plataforma usa la duración con la que se vendió el
 * paquete. `PaqueteDuracionPlataforma` guarda solo las excepciones (Parte
 * 4): si existe una fila para (paqueteId, duracionVendidaId, plataformaId),
 * esa plataforma usa duracionReal en su lugar.
 */
export async function resolverComposicionDePaquete(
  cliente: ClienteEmpresa,
  paqueteId: string,
  duracionVendidaId: string,
): Promise<ComponentePaquete[]> {
  const [composicion, excepciones] = await Promise.all([
    cliente.paquetePlataforma.findMany({
      where: { paqueteId },
      orderBy: { plataformaId: "asc" },
      select: { plataformaId: true, cantidadPantallas: true, plataforma: { select: { nombre: true } } },
    }),
    cliente.paqueteDuracionPlataforma.findMany({
      where: { paqueteId, duracionVendidaId },
      select: { plataformaId: true, duracionRealId: true },
    }),
  ]);

  const duracionRealPorPlataforma = new Map(excepciones.map((e) => [e.plataformaId, e.duracionRealId]));

  const idsDuracion = new Set<string>([duracionVendidaId, ...excepciones.map((e) => e.duracionRealId)]);
  const duraciones = await cliente.duracion.findMany({
    where: { id: { in: [...idsDuracion] } },
    select: { id: true, cantidad: true, unidad: true },
  });
  const duracionPorId = new Map(duraciones.map((d) => [d.id, d]));

  return composicion.map((fila) => {
    const duracionId = duracionRealPorPlataforma.get(fila.plataformaId) ?? duracionVendidaId;
    const duracion = duracionPorId.get(duracionId);
    if (!duracion) {
      // Sin ids: indica una inconsistencia de catálogo (una excepción de
      // duración apunta a una Duracion ya borrada/de otra empresa), no un
      // error del usuario — pero el mensaje igual puede llegar sin más
      // tratamiento hasta la respuesta HTTP.
      throw new Error("No se pudo resolver la duración de un componente de este paquete. Revisa su configuración.");
    }
    return {
      plataformaId: fila.plataformaId,
      nombrePlataforma: fila.plataforma.nombre,
      cantidadPantallas: fila.cantidadPantallas,
      duracionId,
      cantidadDuracion: duracion.cantidad,
      unidadDuracion: duracion.unidad,
    };
  });
}

export interface PaqueteDisponible {
  id: string;
  nombre: string;
  esPromocion: boolean;
}

/**
 * Parte 6 (entrega 8) — paquetes activos que:
 * 1. tienen un precio activo para la duración vendida y el tipo de cliente
 *    dados (Precio.paqueteId = paquete, sin precio no se puede vender), y
 * 2. tienen suficientes pantallas libres en TODAS sus plataformas
 *    componentes, contra el inventario existente (R5: una pantalla está
 *    ocupada si tiene un VentaDetalle con venta no anulada y
 *    fechaVencimiento > now()).
 */
export async function paquetesDisponibles(
  cliente: ClienteEmpresa,
  duracionVendidaId: string,
  tipoClienteId: string,
): Promise<PaqueteDisponible[]> {
  const paquetes = await cliente.paquete.findMany({
    where: { activo: true },
    select: {
      id: true,
      nombre: true,
      esPromocion: true,
      paquetePlataformas: { select: { plataformaId: true, cantidadPantallas: true } },
    },
  });

  if (paquetes.length === 0) return [];

  const preciosActivos = await cliente.precio.findMany({
    where: {
      activo: true,
      duracionId: duracionVendidaId,
      tipoClienteId,
      paqueteId: { in: paquetes.map((p) => p.id) },
    },
    select: { paqueteId: true },
  });
  const paquetesConPrecio = new Set(preciosActivos.map((p) => p.paqueteId));

  const plataformaIds = [...new Set(paquetes.flatMap((p) => p.paquetePlataformas.map((c) => c.plataformaId)))];

  const conteos = await Promise.all(
    plataformaIds.map(async (plataformaId) => {
      const estados = await pantallasDisponibles(cliente, plataformaId);
      return [plataformaId, estados.filter((p) => p.libre).length] as const;
    }),
  );
  const libresPorPlataforma = new Map(conteos);

  return paquetes
    .filter((paquete) => paquetesConPrecio.has(paquete.id))
    .filter((paquete) =>
      paquete.paquetePlataformas.every(
        (componente) => (libresPorPlataforma.get(componente.plataformaId) ?? 0) >= componente.cantidadPantallas,
      ),
    )
    .map((paquete) => ({ id: paquete.id, nombre: paquete.nombre, esPromocion: paquete.esPromocion }));
}

export interface CostoComponentes {
  // null cuando falta el precio de al menos un componente: no se puede
  // calcular la suma, no que la suma sea cero.
  suma: Prisma.Decimal | null;
  faltantes: string[];
}

/**
 * Salvaguarda de costo para la matriz de precios de paquetes (mitiga D12
 * del PRD): cuánto deberían sumar los costos de las plataformas
 * componentes para una duración vendida y un tipo de cliente dados, cada
 * una a SU duración real (ver resolverComposicionDePaquete) — "Básico 1"
 * vendido a 30 días suma el costo de Netflix a 28 días, no a 30.
 *
 * Si falta el precio activo de algún componente para su duración real y
 * el tipo de cliente dado, la suma no es calculable (`suma: null`) y
 * `faltantes` nombra qué plataforma falta.
 */
export async function costoComponentesPaquete(
  cliente: ClienteEmpresa,
  paqueteId: string,
  duracionVendidaId: string,
  tipoClienteId: string,
): Promise<CostoComponentes> {
  const composicion = await resolverComposicionDePaquete(cliente, paqueteId, duracionVendidaId);
  if (composicion.length === 0) return { suma: new Prisma.Decimal(0), faltantes: [] };

  const precios = await cliente.precio.findMany({
    where: {
      activo: true,
      tipoClienteId,
      plataformaId: { in: composicion.map((c) => c.plataformaId) },
    },
    select: { plataformaId: true, duracionId: true, costo: true },
  });
  const costoPorClave = new Map(precios.map((p) => [`${p.plataformaId}|${p.duracionId}`, p.costo]));

  let suma = new Prisma.Decimal(0);
  const faltantes: string[] = [];
  for (const componente of composicion) {
    const costo = costoPorClave.get(`${componente.plataformaId}|${componente.duracionId}`);
    if (costo === undefined) {
      faltantes.push(componente.nombrePlataforma);
    } else {
      suma = suma.plus(costo);
    }
  }

  return { suma: faltantes.length > 0 ? null : suma, faltantes };
}
