import { redirect } from "next/navigation";
import { inicioParaRol, obtenerSesion, satisfaceRol } from "@/lib/sesion";
import DashboardClientePanel from "./dashboard-cliente";

export default async function PaginaPanel() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  // El layout de (admin) ahora deja pasar a EMPLEADO (para /panel/cuentas).
  // El panel raíz (cifras financieras) sigue siendo exclusivo de ADMIN.
  if (!satisfaceRol(sesion.usuario.rol, "ADMIN")) {
    redirect(inicioParaRol(sesion.usuario.rol));
  }

  return <DashboardClientePanel />;
}
