import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/sesion";
import { VentasContenido } from "./ventas-contenido";

/**
 * El contenido se bifurca por rol (VENDEDOR ve solo lo suyo sin cifras,
 * ADMIN+ ve el listado completo con filtros) — por eso el rol se resuelve
 * aquí, en el servidor, igual que en los layouts (admin)/(vendedor).
 */
export default async function PaginaVentas() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  return <VentasContenido rol={sesion.usuario.rol} />;
}
