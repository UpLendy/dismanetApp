import { redirect } from "next/navigation";
import { inicioParaRol, obtenerSesion, satisfaceRol } from "@/lib/sesion";
import MensajesCliente from "./mensajes-cliente";

export default async function PaginaMensajes() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  // El layout de (admin) ahora deja pasar a EMPLEADO (para /panel/cuentas).
  // Las plantillas de mensajes siguen siendo exclusivas de ADMIN.
  if (!satisfaceRol(sesion.usuario.rol, "ADMIN")) {
    redirect(inicioParaRol(sesion.usuario.rol));
  }

  return <MensajesCliente />;
}
