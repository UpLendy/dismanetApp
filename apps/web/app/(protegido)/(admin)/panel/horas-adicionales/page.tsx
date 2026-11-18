import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/sesion";
import { HorasAdicionalesContenido } from "./horas-adicionales-contenido";

/**
 * El contenido se bifurca por rol, igual que calendario/page.tsx: un
 * EMPLEADO ve y registra solo las suyas; ADMIN+ ve las de todo el equipo,
 * aprueba/rechaza y consulta el resumen por persona. Vive bajo (admin)/panel
 * para que el layout bloquee a VENDEDOR en el servidor (F6.3: un VENDEDOR es
 * un revendedor externo con saldo prepago, no tiene turno laboral).
 */
export default async function PaginaHorasAdicionales() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  return <HorasAdicionalesContenido rol={sesion.usuario.rol} usuarioPropio={sesion.usuario} />;
}
