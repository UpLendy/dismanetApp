import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/sesion";
import { ReportesContenido } from "./reportes-contenido";

/**
 * El contenido se bifurca por rol (F6.4): un EMPLEADO escribe y ve su propio
 * reporte semanal; ADMIN+ ve los reportes de la semana elegida agrupados
 * por cargo y quién falta. Vive bajo (admin)/panel para que el layout
 * bloquee a VENDEDOR en el servidor (un VENDEDOR es un revendedor externo
 * y no reporta, mismo criterio que F6.3).
 */
export default async function PaginaReportes() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  return <ReportesContenido rol={sesion.usuario.rol} />;
}
