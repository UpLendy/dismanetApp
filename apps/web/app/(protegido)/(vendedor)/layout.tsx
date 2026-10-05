import { redirect } from "next/navigation";
import { inicioParaRol, obtenerSesion, satisfaceRol } from "@/lib/sesion";

/**
 * VENDEDOR, ADMIN o SUPER_ADMIN pueden vender (jerarquía) — ver el
 * comentario en (admin)/layout.tsx sobre por qué existe esta separación y
 * por qué no es control de acceso real.
 */
export default async function LayoutVendedor({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  if (!satisfaceRol(sesion.usuario.rol, "VENDEDOR")) {
    redirect(inicioParaRol(sesion.usuario.rol));
  }

  return <>{children}</>;
}
