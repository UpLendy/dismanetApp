import { redirect } from "next/navigation";
import { AppShell } from "@/components/navegacion/app-shell";
import { obtenerSesion } from "@/lib/sesion";

/**
 * Verificación autoritativa de sesión: proxy.ts (Edge Runtime) solo revisa
 * que la cookie exista. Aquí se reenvía esa cookie al API vía GET /auth/yo,
 * que valida el JWT, el estado de usuario/empresa y resuelve la empresa
 * activa — la misma fuente de verdad que usa cada endpoint protegido.
 *
 * Este layout SOLO valida que haya sesión. El control de rol por ruta vive
 * en los layouts anidados (admin) y (vendedor) — ver ese comentario para el
 * porqué de la separación.
 */
export default async function LayoutProtegido({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesion();

  if (!sesion) {
    redirect("/login");
  }

  const { usuario, empresaActiva } = sesion;

  return (
    <AppShell usuario={usuario} empresaActiva={empresaActiva}>
      {children}
    </AppShell>
  );
}
