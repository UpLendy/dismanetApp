import { api } from "./api";

export const AVISO_COSTO_CERO_TITULO = "Hay precios con costo en cero";

export function avisoCostoCeroTexto(cantidad: number): string {
  return `${cantidad} celda(s) de precio no tienen costo registrado — la utilidad mostrada en esos casos no es real. Revisa la matriz de precios.`;
}

// Mismo cálculo que usa /panel: suma avisoCostoCero.cantidad de cada
// plataforma y paquete activos. Centralizado aquí para que /panel y /ventas
// muestren siempre la misma redacción con el mismo número.
export async function contarPreciosConCostoCero(): Promise<number> {
  const [resPlataformas, resPaquetes] = await Promise.all([api.plataformas.get(), api.paquetes.get()]);
  const plataformasActivas = resPlataformas.data?.plataformas.filter((p) => p.activa) ?? [];
  const paquetesActivos = resPaquetes.data?.paquetes.filter((p) => p.activo) ?? [];

  const [avisosUnidades, avisosPaquetes] = await Promise.all([
    Promise.all(plataformasActivas.map((p) => api.precios.unidades.get({ query: { plataformaId: p.id } }))),
    Promise.all(paquetesActivos.map((p) => api.precios.paquetes.get({ query: { paqueteId: p.id } }))),
  ]);

  return (
    avisosUnidades.reduce((acc, r) => acc + (r.data?.avisoCostoCero.cantidad ?? 0), 0) +
    avisosPaquetes.reduce((acc, r) => acc + (r.data?.avisoCostoCero.cantidad ?? 0), 0)
  );
}
