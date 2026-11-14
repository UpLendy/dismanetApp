import { redirect } from "next/navigation";
import { obtenerSesion } from "@/lib/sesion";
import { InstruccionesContenido } from "./instrucciones-contenido";

/**
 * El contenido se bifurca por rol (F6.7): un EMPLEADO ve las instrucciones
 * publicadas de la semana que le aplican por cargo y marca cumplida cada
 * una; ADMIN+ las crea, sube imágenes/video (directo a S3, nunca por el
 * API) y publica. Vive bajo (admin)/panel para que el layout bloquee a
 * VENDEDOR en el servidor — un VENDEDOR es un revendedor externo y no
 * recibe instrucciones de operación, mismo criterio que F6.3/F6.4.
 */
export default async function PaginaInstrucciones() {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/login");

  return <InstruccionesContenido rol={sesion.usuario.rol} />;
}
