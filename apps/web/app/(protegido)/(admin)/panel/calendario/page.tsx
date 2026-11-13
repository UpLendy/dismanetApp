import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/sesion";
import { CalendarioContenido } from "./calendario-contenido";

/**
 * El contenido se bifurca por rol (EMPLEADO ve solo su propia fila sin
 * controles de edición, ADMIN+ ve la cuadrícula completa y puede
 * crear/editar/borrar). Vive bajo (admin)/panel, no bajo (vendedor): un
 * VENDEDOR no tiene turno laboral (F6.3) y el layout de (admin) lo bloquea
 * en el servidor antes de llegar aquí, no solo ocultando el enlace del menú.
 */
export default async function PaginaCalendario() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  return <CalendarioContenido rol={sesion.usuario.rol} usuarioPropio={sesion.usuario} />;
}
