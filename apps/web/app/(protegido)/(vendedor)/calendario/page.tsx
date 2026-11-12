import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/sesion";
import { CalendarioContenido } from "./calendario-contenido";

/**
 * El contenido se bifurca por rol (VENDEDOR/EMPLEADO ven solo su propia
 * fila sin controles de edición, ADMIN+ ve la cuadrícula completa y puede
 * crear/editar/borrar) — mismo patrón que (vendedor)/ventas/page.tsx.
 */
export default async function PaginaCalendario() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  return <CalendarioContenido rol={sesion.usuario.rol} usuarioPropio={sesion.usuario} />;
}
