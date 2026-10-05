import * as React from "react";
import { cn } from "@/lib/utils";

// Tarjeta — DISENO.md §4. Fondo --superficie, radio 12, borde hairline,
// padding 20. Cabecera opcional con título y una acción a la derecha.
function Tarjeta({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-tarjeta border border-borde bg-superficie p-5 shadow-tarjeta",
        className,
      )}
      {...props}
    />
  );
}

function TarjetaCabecera({
  titulo,
  accion,
  className,
  ...props
}: React.ComponentProps<"div"> & { titulo?: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <div className={cn("mb-4 flex items-center justify-between gap-3", className)} {...props}>
      {titulo ? <h3 className="titulo-tarjeta text-ink">{titulo}</h3> : null}
      {accion ? <div>{accion}</div> : null}
    </div>
  );
}

export { Tarjeta, TarjetaCabecera };
