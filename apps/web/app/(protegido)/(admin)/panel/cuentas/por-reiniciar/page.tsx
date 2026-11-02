import { redirect } from "next/navigation";
import { inicioParaRol, obtenerSesion, satisfaceRol } from "@/lib/sesion";
import PorReiniciarCliente from "./por-reiniciar-cliente";

export default async function PaginaCuentasPorReiniciar() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  // El reinicio cambia la contraseña real de la cuenta (F4.11, Parte 3.2):
  // exclusivo de ADMIN, igual que el resto de /panel/cuentas que toca
  // credenciales.
  if (!satisfaceRol(sesion.usuario.rol, "ADMIN")) {
    redirect(inicioParaRol(sesion.usuario.rol));
  }

  return <PorReiniciarCliente />;
}
