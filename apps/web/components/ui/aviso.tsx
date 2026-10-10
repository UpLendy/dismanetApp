import * as React from "react";
import { Info, AlertTriangle, AlertOctagon, XOctagon } from "lucide-react";
import { cn } from "@/lib/utils";

const variantes = {
  info: { clase: "bg-secundario-suave text-secundario-texto border-secundario/20", icono: Info },
  aviso: { clase: "bg-aviso/10 text-ink border-aviso/30", icono: AlertTriangle },
  serio: { clase: "bg-serio/10 text-ink border-serio/30", icono: AlertOctagon },
  critico: { clase: "bg-critico/10 text-critico border-critico/20", icono: XOctagon },
} as const;

// Aviso — DISENO.md §4. Alerta en línea con icono para advertencias del
// sistema (costos en cero, costo que no coincide, precios inservibles).
// --aviso y --serio bajan de 3:1 de contraste en claro: el icono y el texto
// son la mitigación obligatoria (DISENO.md §2, §7).
function Aviso({
  variante = "info",
  titulo,
  children,
  accion,
  className,
}: {
  variante?: keyof typeof variantes;
  titulo?: string;
  children?: React.ReactNode;
  accion?: React.ReactNode;
  className?: string;
}) {
  const { clase, icono: Icono } = variantes[variante];
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-control border p-3", clase, className)}>
      <Icono className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1 space-y-0.5">
        {titulo ? <p className="text-sm font-semibold text-ink">{titulo}</p> : null}
        {children ? <div className="cuerpo text-ink-2">{children}</div> : null}
      </div>
      {accion ? <div className="shrink-0">{accion}</div> : null}
    </div>
  );
}

export { Aviso };
