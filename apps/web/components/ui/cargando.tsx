import * as React from "react";
import { cn } from "@/lib/utils";

// Cargando — DISENO.md §4. Esqueletos con la forma del contenido, nunca un
// spinner centrado.
function Esqueleto({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-control bg-ink-muted/15", className)} {...props} />;
}

function CargandoTiles({ cantidad = 4 }: { cantidad?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: cantidad }).map((_, i) => (
        <div key={i} className="rounded-tarjeta border border-borde bg-superficie p-5 shadow-tarjeta">
          <Esqueleto className="h-3 w-20" />
          <Esqueleto className="mt-3 h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

function CargandoTabla({ filas = 5, columnas = 4 }: { filas?: number; columnas?: number }) {
  return (
    <div className="space-y-3">
      <Esqueleto className="h-4 w-full max-w-sm" />
      <div className="space-y-2">
        {Array.from({ length: filas }).map((_, fila) => (
          <div key={fila} className="flex gap-4 border-b border-borde py-3">
            {Array.from({ length: columnas }).map((_, columna) => (
              <Esqueleto key={columna} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CargandoTarjeta({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-tarjeta border border-borde bg-superficie p-5 shadow-tarjeta", className)}>
      <Esqueleto className="h-4 w-1/3" />
      <Esqueleto className="h-10 w-full" />
      <Esqueleto className="h-10 w-full" />
    </div>
  );
}

export { Esqueleto, CargandoTiles, CargandoTabla, CargandoTarjeta };
