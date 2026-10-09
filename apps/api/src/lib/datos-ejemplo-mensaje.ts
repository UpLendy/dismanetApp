import type { EntradaMensajeVenta } from "./mensaje-venta.ts";

// Datos de ejemplo para la vista previa del editor de plantillas (PRD §5.9).
// Son los del ejemplo renderizado del anexo B.3, con fecha FIJA: así la vista
// previa es determinista y no cambia cada día.
const FECHA_VENTA_EJEMPLO = new Date("2026-09-27T15:00:00.000Z");
const FECHA_VENCIMIENTO_EJEMPLO = new Date("2026-10-27T15:00:00.000Z");

export const DATOS_EJEMPLO: Record<"UNIDAD" | "PAQUETE", EntradaMensajeVenta> = {
  UNIDAD: {
    tipo: "UNIDAD",
    datos: {
      codigoCompra: "DIS995865",
      fechaVenta: FECHA_VENTA_EJEMPLO,
      nombreTipoCliente: "Cliente normal",
      nombreDuracion: "30 días",
      fechaVencimientoMax: FECHA_VENCIMIENTO_EJEMPLO,
      precioVenta: "11400",
      celularCliente: "3001234567",
      nombrePlataformaMensaje: "N.E.T.F.L.I.X",
      usaPerfilPin: true,
      perfil: "E",
      pin: "5010",
      correo: "geradooopaltaa32@hotmail.com",
      clave: "Net8123@",
    },
  },
  PAQUETE: {
    tipo: "PAQUETE",
    datos: {
      codigoCompra: "DIS995866",
      fechaVenta: FECHA_VENTA_EJEMPLO,
      nombreTipoCliente: "Cliente normal",
      nombreDuracion: "30 días",
      fechaVencimientoMax: FECHA_VENCIMIENTO_EJEMPLO,
      precioVenta: "19900",
      celularCliente: "3001234567",
      nombrePaquete: "Básico 1",
      componentes: [
        {
          nombrePlataforma: "N.E.T.F.L.I.X",
          usaPerfilPin: true,
          nombreDuracionReal: "28 días",
          perfil: "E",
          pin: "5010",
          correo: "geradooopaltaa32@hotmail.com",
          clave: "Net8123@",
        },
        {
          nombrePlataforma: "D.I.S.N.E.Y+",
          usaPerfilPin: true,
          nombreDuracionReal: "30 días",
          perfil: "B",
          pin: "2468",
          correo: "disneyejemplo@hotmail.com",
          clave: "Dis7421#",
        },
      ],
    },
  },
};
