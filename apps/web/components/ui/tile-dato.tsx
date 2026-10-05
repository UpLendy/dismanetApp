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
}: {
  etiqueta: string;
  valor: React.ReactNode;
  icono?: React.ComponentType<{ className?: string }>;
  tono?: keyof typeof tonoColor;
  className?: string;
}) {
  return (
    <div className={cn("rounded-tarjeta border border-borde bg-superficie p-5 shadow-tarjeta", className)}>
      <div className="flex items-center gap-2">
        <span className="etiqueta-dato">{etiqueta}</span>
        {Icono ? <Icono className={cn("size-4", tono ? tonoColor[tono] : "text-ink-muted")} /> : null}
      </div>
      <p className={cn("valor-dato mt-1 tabular-nums", tono ? tonoColor[tono] : "text-ink")}>{valor}</p>
    </div>
  );
}

export { TileDato };
