import { redirect } from "next/navigation";
import { inicioParaRol, obtenerSesion, satisfaceRol } from "@/lib/sesion";
import EstadisticasContenido from "./estadisticas-contenido";

export default async function PaginaEstadisticas() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  if (!satisfaceRol(sesion.usuario.rol, "ADMIN")) {
    redirect(inicioParaRol(sesion.usuario.rol));
  }

  return <EstadisticasContenido />;
}
