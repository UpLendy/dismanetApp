import type { prismaRaw } from "./prisma.ts";

type ClienteEmpresa = typeof prismaRaw;

export interface ImpactoDesactivacion {
  preciosActivos: number;
  paquetesAfectados: Array<{ id: string; nombre: string }>;
}

function fusionarPaquetes(
  ...grupos: Array<Array<{ id: string; nombre: string }>>
): Array<{ id: string; nombre: string }> {
  const mapa = new Map<string, { id: string; nombre: string }>();
  for (const grupo of grupos) for (const paquete of grupo) mapa.set(paquete.id, paquete);
  return [...mapa.values()];
}

// Cuántos Precio activos quedarían sin poder venderse, y qué Paquetes
// pierden esa plataforma como componente. Es solo informativo (Parte 6): no
// bloquea la desactivación.
export async function impactoDesactivarPlataforma(
  cliente: ClienteEmpresa,
  plataformaId: string,
): Promise<ImpactoDesactivacion> {
  const [preciosActivos, paquetesAfectados] = await Promise.all([
    cliente.precio.count({ where: { plataformaId, activo: true } }),
    cliente.paquete.findMany({
      where: { paquetePlataformas: { some: { plataformaId } } },
      select: { id: true, nombre: true },
    }),
  ]);
  return { preciosActivos, paquetesAfectados };
}

export async function impactoDesactivarDuracion(
  cliente: ClienteEmpresa,
  duracionId: string,
): Promise<ImpactoDesactivacion> {
  const [preciosActivos, paquetesPorPrecio, paquetesPorExcepcion] = await Promise.all([
    cliente.precio.count({ where: { duracionId, activo: true } }),
    cliente.paquete.findMany({
      where: { precios: { some: { duracionId, activo: true } } },
      select: { id: true, nombre: true },
    }),
    cliente.paquete.findMany({
      where: {
        paqueteDuracionPlataformas: {
          some: { OR: [{ duracionVendidaId: duracionId }, { duracionRealId: duracionId }] },
        },
      },
      select: { id: true, nombre: true },
    }),
  ]);
  return { preciosActivos, paquetesAfectados: fusionarPaquetes(paquetesPorPrecio, paquetesPorExcepcion) };
}

// Deactivar un Paquete deja inservibles sus Precio (Precio.paqueteId). No
// hay "paquetesAfectados" porque un paquete no compone a otro paquete; se
// mantiene la misma forma de respuesta para que el frontend reutilice el
// mismo helper de confirmación que plataformas/duraciones/tipos-cliente.
export async function impactoDesactivarPaquete(
  cliente: ClienteEmpresa,
  paqueteId: string,
): Promise<ImpactoDesactivacion> {
  const preciosActivos = await cliente.precio.count({ where: { paqueteId, activo: true } });
  return { preciosActivos, paquetesAfectados: [] };
}

export async function impactoDesactivarTipoCliente(
  cliente: ClienteEmpresa,
  tipoClienteId: string,
): Promise<ImpactoDesactivacion> {
  const [preciosActivos, paquetesAfectados] = await Promise.all([
    cliente.precio.count({ where: { tipoClienteId, activo: true } }),
    cliente.paquete.findMany({
      where: { precios: { some: { tipoClienteId, activo: true } } },
      select: { id: true, nombre: true },
    }),
  ]);
  return { preciosActivos, paquetesAfectados };
}
