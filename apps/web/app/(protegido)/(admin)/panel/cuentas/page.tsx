import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/sesion";
import CuentasCliente from "./cuentas-cliente";

// Única pantalla de /panel que EMPLEADO alcanza (Parte 7): el (admin)
// layout ya deja pasar a EMPLEADO, así que aquí no hay guardia de rango
// mínimo — CuentasCliente decide qué mostrar según el rol.
export default async function PaginaCuentas() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  return <CuentasCliente rol={sesion.usuario.rol} />;
}
