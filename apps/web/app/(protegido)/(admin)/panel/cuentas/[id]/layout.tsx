import { redirect } from "next/navigation";
import { inicioParaRol, obtenerSesion, satisfaceRol } from "@/lib/sesion";

export default async function LayoutCuentaDetalle({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  // /panel/cuentas (la lista) deja pasar a EMPLEADO, pero solo para crear
  // cuentas. Ver, editar, activar/desactivar una cuenta existente (esta
  // pantalla) sigue siendo exclusivo de ADMIN — igual que en el API.
  if (!satisfaceRol(sesion.usuario.rol, "ADMIN")) {
    redirect(inicioParaRol(sesion.usuario.rol));
  }

  return <>{children}</>;
}
