import * as React from "react";
import { Circle, CheckCircle2, XCircle, Ban, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const tonos = {
  bien: "bg-bien/10 text-bien",
  aviso: "bg-aviso/15 text-aviso",
  serio: "bg-serio/15 text-serio",
  critico: "bg-critico/10 text-critico",
  secundario: "bg-secundario-suave text-secundario",
  neutral: "bg-ink-muted/10 text-ink-2",
} as const;

type Tono = keyof typeof tonos;

// Pastilla — DISENO.md §4. Para estados (Activo, Inactivo, Libre, Ocupada,
// Anulada). Siempre icono + texto, nunca solo color (DISENO.md §7).
function Pastilla({
  tono,
  icono: Icono,
  children,
  className,
}: {
  tono: Tono;
  icono?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pastilla px-2.5 py-1 text-xs font-medium",
        tonos[tono],
        className,
      )}
    >
      {Icono ? <Icono className="size-3.5" /> : null}
      {children}
    </span>
  );
}

// Mapeo de los 5 estados nombrados en DISENO.md §4 a tono + icono, para no
// repetir esa decisión en cada pantalla.
const ESTADOS_PASTILLA = {
  activo: { tono: "bien" as Tono, icono: CheckCircle2, texto: "Activo" },
  inactivo: { tono: "neutral" as Tono, icono: XCircle, texto: "Inactivo" },
  libre: { tono: "bien" as Tono, icono: CheckCircle2, texto: "Libre" },
  ocupada: { tono: "secundario" as Tono, icono: Clock, texto: "Ocupada" },
  anulada: { tono: "critico" as Tono, icono: Ban, texto: "Anulada" },
  desactivada: { tono: "neutral" as Tono, icono: Circle, texto: "Desactivada" },
} as const;

function PastillaEstado({ estado, className }: { estado: keyof typeof ESTADOS_PASTILLA; className?: string }) {
  const { tono, icono, texto } = ESTADOS_PASTILLA[estado];
  return (
    <Pastilla tono={tono} icono={icono} className={className}>
      {texto}
    </Pastilla>
  );
}

export { Pastilla, PastillaEstado };
