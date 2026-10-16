import * as React from "react";
import { cn } from "@/lib/utils";

const tonoColor = {
  bien: "text-bien",
  aviso: "text-aviso",
  serio: "text-serio",
  critico: "text-critico",
  secundario: "text-secundario",
} as const;

// TileDato — DISENO.md §4. Etiqueta arriba (estilo etiqueta de dato), valor
// grande debajo. Bloque de los indicadores de /panel.
function TileDato({
  etiqueta,
  valor,
  icono: Icono,
  tono,
  className,
  subInfo,
}: {
  etiqueta: string;
  valor: React.ReactNode;
  icono?: React.ComponentType<{ className?: string }>;
  tono?: keyof typeof tonoColor;
  className?: string;
  subInfo?: React.ReactNode;
}) {
  return (
    // min-w-0 + @container: F4.9 — esta tarjeta es la celda de un grid
    // (dashboard, estadísticas); @container deja que .valor-dato mida el
    // ancho real de ESTA tarjeta, no el de la ventana.
    <div className={cn("@container min-w-0 rounded-tarjeta border border-borde bg-superficie p-5 shadow-tarjeta", className)}>
      <div className="flex items-center gap-2">
        <span className="etiqueta-dato">{etiqueta}</span>
        {Icono ? <Icono className={cn("size-4", tono ? tonoColor[tono] : "text-ink-muted")} /> : null}
      </div>
      <p className={cn("valor-dato mt-1", tono ? tonoColor[tono] : "text-ink")}>{valor}</p>
      {subInfo ? <p className="mt-0.5 text-xs text-critico">{subInfo}</p> : null}
    </div>
  );
}

export { TileDato };
