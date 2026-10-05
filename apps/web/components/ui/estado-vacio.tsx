import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

// EstadoVacio — DISENO.md §4. Icono, frase de qué falta y botón de la
// acción que lo resuelve. Nunca una tabla vacía sin explicación.
function EstadoVacio({
  icono: Icono = Inbox,
  titulo,
  descripcion,
  accion,
  className,
}: {
  icono?: React.ComponentType<{ className?: string }>;
  titulo: string;
  descripcion?: string;
  accion?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-tarjeta border border-dashed border-borde px-6 py-12 text-center", className)}>
      <span className="flex size-12 items-center justify-center rounded-full bg-plano text-ink-muted">
        <Icono className="size-6" />
      </span>
      <div className="space-y-1">
        <p className="titulo-tarjeta text-ink">{titulo}</p>
        {descripcion ? <p className="cuerpo text-ink-muted">{descripcion}</p> : null}
      </div>
      {accion ? <div className="mt-1">{accion}</div> : null}
    </div>
  );
}

export { EstadoVacio };
