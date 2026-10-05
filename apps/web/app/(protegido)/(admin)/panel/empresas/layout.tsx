import { redirect } from "next/navigation";
import { inicioParaRol, obtenerSesion, satisfaceRol } from "@/lib/sesion";

export default async function LayoutEmpresas({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  // Las empresas solo pueden ser vistas y gestionadas por un SUPER_ADMIN
  if (sesion.usuario.rol !== "SUPER_ADMIN") {
    redirect(inicioParaRol(sesion.usuario.rol));
  }

  return <>{children}</>;
}
