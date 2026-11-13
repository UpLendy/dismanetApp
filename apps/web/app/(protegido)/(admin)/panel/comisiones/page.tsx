import { redirect } from "next/navigation";
import { inicioParaRol, obtenerSesion, satisfaceRol } from "@/lib/sesion";
import ComisionesCliente from "./comisiones-cliente";

export default async function PaginaComisiones() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  // El layout de (admin) deja pasar a EMPLEADO (para /panel/cuentas). La
  // política de comisiones es información financiera (R4) y es exclusiva de
  // ADMIN.
  if (!satisfaceRol(sesion.usuario.rol, "ADMIN")) {
    redirect(inicioParaRol(sesion.usuario.rol));
  }

  return <ComisionesCliente />;
}
