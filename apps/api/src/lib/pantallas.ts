import { Prisma } from "../generated/prisma/client.ts";

// Prisma.TransactionClient (no PrismaClient completo): así esta función
// acepta tanto prismaParaEmpresa(empresaId) como prismaParaEmpresa(empresaId,
// tx) dentro de una transacción — el cliente transaccional no tiene
// $connect/$disconnect/$on/$use/$extends, pero sí todos los delegados de
// modelo que esta función necesita.
type ClienteEmpresa = Prisma.TransactionClient;

/** A, B, C... — perfil propuesto para la pantalla número `indice + 1` de una cuenta. */
export function letraPerfil(indice: number): string {
  return String.fromCharCode(65 + indice);
}

/** PIN de 4 dígitos propuesto para una pantalla nueva. */
export function pinAleatorio(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * `cantidad` PINes de 4 dígitos, distintos entre sí y de los de `excluir`
 * (ej. los que el ADMIN ya fijó a mano). Evita que dos pantallas de la
 * misma cuenta, generadas en el mismo lote, terminen con el mismo PIN.
 */
export function pinesDistintos(cantidad: number, excluir: ReadonlySet<string> = new Set()): string[] {
  const usados = new Set(excluir);
  const resultado: string[] = [];
  while (resultado.length < cantidad) {
    const candidato = pinAleatorio();
    if (usados.has(candidato)) continue;
    usados.add(candidato);
    resultado.push(candidato);
  }
  return resultado;
}

export interface EstadoPantalla {
  id: string;
  cuentaId: string;
  numero: number;
  perfil: string | null;
  activa: boolean;
  libre: boolean;
  ocupadaHasta: Date | null;
  ventaId: string | null;
}

/**
 * R5 — una pantalla está ocupada si existe un VentaDetalle con venta no
 * anulada y fechaVencimiento > now(). Esta es la ÚNICA consulta del proyecto
 * que implementa esa regla: todo lo que necesite disponibilidad (conteos
 * para VENDEDOR, paquetesDisponibles, la validación de baja de capacidad en
 * cuentas.ts, el detalle de una cuenta) pasa por aquí o por
 * pantallasDisponibles/pantallasDeCuenta debajo.
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
      ventaDetalles: {
        where: { fechaVencimiento: { gt: ahora }, venta: { anulada: false } },
        select: { fechaVencimiento: true, ventaId: true },
        orderBy: { fechaVencimiento: "desc" },
        take: 1,
      },
    },
    orderBy: { numero: "asc" },
  });

  return pantallas.map((p) => {
    const ocupacion = p.ventaDetalles[0];
    return {
      id: p.id,
      cuentaId: p.cuentaId,
      numero: p.numero,
      perfil: p.perfil,
      activa: p.activa,
      libre: !ocupacion,
      ocupadaHasta: ocupacion?.fechaVencimiento ?? null,
      ventaId: ocupacion?.ventaId ?? null,
    };
  });
}

/**
 * Pantallas activas, de cuentas activas, de una plataforma — con su estado
 * de ocupación (R5). Úsala para cualquier cálculo de disponibilidad: el
 * conteo que ve VENDEDOR, paquetesDisponibles, etc.
 */
export async function pantallasDisponibles(cliente: ClienteEmpresa, plataformaId: string): Promise<EstadoPantalla[]> {
  return estadoDePantallas(cliente, { activa: true, cuenta: { activa: true, plataformaId } });
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

  const conDisponibilidad = await Promise.all(
    plataformas
      .filter((plataforma) => plataformasConPrecio.has(plataforma.id))
      .map(async (plataforma) => {
        const estados = await pantallasDisponibles(cliente, plataforma.id);
        return { ...plataforma, pantallasLibres: estados.filter((e) => e.libre).length };
      }),
  );

  return conDisponibilidad.filter((plataforma) => plataforma.pantallasLibres > 0);
}
