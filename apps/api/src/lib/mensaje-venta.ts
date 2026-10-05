import {
  renderizarMensajePaquete,
  renderizarMensajeUnidad,
  type DatosMensajePaquete,
  type DatosMensajeUnidad,
} from "./mensaje.ts";

// Punto ÚNICO por el que pasa el texto de una venta. Lo usan:
//   - realizarVenta() (lib/ventas.ts), con los datos reales de la venta.
//   - la vista previa de la pantalla de plantillas (routes/plantillas.ts),
//     con datos de ejemplo.
// Que ambos caminos compartan esta función (y no dos implementaciones
// parecidas) es lo que garantiza que la vista previa nunca le mienta al
// admin: mismos datos + misma plantilla = mismo texto, siempre.

export type EntradaMensajeVenta =
  | { tipo: "UNIDAD"; datos: DatosMensajeUnidad }
  | { tipo: "PAQUETE"; datos: DatosMensajePaquete };

export function renderizarMensajeDeVenta(contenidoPlantilla: string, entrada: EntradaMensajeVenta): string {
  return entrada.tipo === "UNIDAD"
    ? renderizarMensajeUnidad(contenidoPlantilla, entrada.datos)
    : renderizarMensajePaquete(contenidoPlantilla, entrada.datos);
}
