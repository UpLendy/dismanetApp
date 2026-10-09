import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/sesion";
import { PantallasVendidasContenido } from "./pantallas-vendidas-contenido";

export default async function PaginaPantallasVendidas() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  return <PantallasVendidasContenido />;
}
