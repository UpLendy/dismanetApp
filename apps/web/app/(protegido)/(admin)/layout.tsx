import { redirect } from "next/navigation";
import { inicioParaRol, obtenerSesion, satisfaceRol } from "@/lib/sesion";

/**
 * Control de rol POR RUTA en el frontend: sin esto, cualquier VENDEDOR
 * autenticado podía cargar /panel (el layout padre solo valida sesión, no
 * rol). Esto NO es control de acceso real — eso vive en el servidor (R4,
 * requiereRol en cada endpoint); esto solo evita que alguien sin el rol
 * que corresponde llegue a ver una pantalla rota.
 *
 * El mínimo aquí es EMPLEADO, no ADMIN: un EMPLEADO sí entra a /panel
 * porque necesita /panel/cuentas (solo el botón de crear, ver
 * cuentas/page.tsx). Cada pantalla de /panel que es exclusiva de ADMIN
 * (empresas, usuarios, precios, catálogo, mensajes, el panel raíz, y
 * cuentas/[id]) tiene su propio guard de ADMIN — no puede depender solo
 * de este layout compartido.
 *
 * Un rol insuficiente no redirige a /login (ya está autenticado) sino a la
 * pantalla que sí le corresponde a su rol. SUPER_ADMIN también pasa este
 * guard (jerarquía, igual que requiereRol en el API).
 */
export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  if (!satisfaceRol(sesion.usuario.rol, "EMPLEADO")) {
    redirect(inicioParaRol(sesion.usuario.rol));
  }

  return <>{children}</>;
}
