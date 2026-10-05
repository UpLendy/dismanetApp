import { redirect } from "next/navigation";
import { inicioParaRol, obtenerSesion, satisfaceRol } from "@/lib/sesion";

/**
 * Control de rol POR RUTA en el frontend: sin esto, cualquier VENDEDOR
 * autenticado podía cargar /panel (el layout padre solo valida sesión, no
 * rol). Esto NO es control de acceso real — eso vive en el servidor (R4,
 * requiereRol en cada endpoint); esto solo evita que un VENDEDOR llegue a
 * ver una pantalla rota que no le corresponde.
 *
 * Un rol insuficiente no redirige a /login (ya está autenticado) sino a la
 * pantalla que sí le corresponde a su rol. SUPER_ADMIN también pasa este
 * guard (jerarquía, igual que requiereRol("ADMIN") en el API).
 */
export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  if (!satisfaceRol(sesion.usuario.rol, "ADMIN")) {
    redirect(inicioParaRol(sesion.usuario.rol));
  }

  return <>{children}</>;
}
