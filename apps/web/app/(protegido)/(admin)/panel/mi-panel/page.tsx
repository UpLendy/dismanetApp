import { redirect } from "next/navigation";
import { obtenerSesion, satisfaceRol } from "@/lib/sesion";
import { PanelEmpleadoCliente } from "./panel-empleado-cliente";

/**
 * F6.9: el layout de (admin) ya exige EMPLEADO en adelante. Aquí solo se
 * decide si se muestra el selector de empleado (ADMIN+) o directamente el
 * propio panel (EMPLEADO) — la guarda real vive en el servidor
 * (routes/panel-empleado.ts).
 */
export default async function PaginaMiPanel() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  return <PanelEmpleadoCliente esAdmin={satisfaceRol(sesion.usuario.rol, "ADMIN")} />;
}
