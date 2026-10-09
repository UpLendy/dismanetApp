import { redirect } from "next/navigation";
import { inicioParaRol, obtenerSesion, satisfaceRol } from "@/lib/sesion";

export default async function LayoutCatalogo({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  // El layout de (admin) ahora deja pasar a EMPLEADO (para /panel/cuentas).
  // El catálogo (plataformas, duraciones, tipos de cliente, paquetes) sigue
  // siendo exclusivo de ADMIN.
  if (!satisfaceRol(sesion.usuario.rol, "ADMIN")) {
    redirect(inicioParaRol(sesion.usuario.rol));
  }

  return <>{children}</>;
}
