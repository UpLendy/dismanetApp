import { redirect } from "next/navigation";
import { obtenerSesion, satisfaceRol } from "@/lib/sesion";
import ComisionesCliente from "./comisiones-cliente";
import { MisComisionesCliente } from "./mis-comisiones-cliente";

/**
 * El contenido se bifurca por rol (F6.6): un EMPLEADO ve su propia tajada
 * calculada (sin pozo total ni precio de venta, R4); ADMIN+ ve la política,
 * el simulador y el resumen por persona. El layout de (admin) ya bloquea a
 * VENDEDOR en el servidor.
 */
export default async function PaginaComisiones() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  if (!satisfaceRol(sesion.usuario.rol, "ADMIN")) {
    return <MisComisionesCliente />;
  }

  return <ComisionesCliente />;
}
