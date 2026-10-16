import { api } from "./api";

export interface CostosFaltantes {
  // Combinaciones plataforma+duración en uso (con precio activo) sin
  // CostoPlataforma registrado.
  combinacionesSinCosto: number;
  // Renglones de duración de un paquete cuyos componentes no tienen costo
  // completo.
  paquetesSinCostoCompleto: number;
}

export const AVISO_COSTO_FALTANTE_TITULO = "Hay costos sin registrar";

// Punto 5, camino del dinero: ya no cuenta "celdas de precio con costo en
// cero" — cuenta combinaciones plataforma+duración sin costo registrado y
// paquetes cuyos componentes no tienen costo completo, por separado.
// Centralizado aquí para que /panel y /ventas muestren siempre la misma
// redacción con los mismos números.
export async function contarCostosFaltantes(): Promise<CostosFaltantes> {
  const [resPlataformas, resPaquetes] = await Promise.all([api.plataformas.get(), api.paquetes.get()]);
  const plataformasActivas = resPlataformas.data?.plataformas.filter((p) => p.activa) ?? [];
  const paquetesActivos = resPaquetes.data?.paquetes.filter((p) => p.activo) ?? [];

  const [avisosUnidades, avisosPaquetes] = await Promise.all([
    Promise.all(plataformasActivas.map((p) => api.precios.unidades.get({ query: { plataformaId: p.id } }))),
    Promise.all(paquetesActivos.map((p) => api.precios.paquetes.get({ query: { paqueteId: p.id } }))),
  ]);

  return {
    combinacionesSinCosto: avisosUnidades.reduce((acc, r) => acc + (r.data?.avisoCostoCero.cantidad ?? 0), 0),
    paquetesSinCostoCompleto: avisosPaquetes.reduce((acc, r) => acc + (r.data?.avisoCostoCero.cantidad ?? 0), 0),
  };
}
