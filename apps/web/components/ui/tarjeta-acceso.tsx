import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// TarjetaAcceso — DISENO.md §4. Icono en cuadrado 48px con fondo de color y
// radio 12, título, descripción, chevron a la derecha. Toda la tarjeta es
// clicable.
function TarjetaAcceso({
  href,
  icono: Icono,
  titulo,
  descripcion,
  tono = "secundario",
  className,
}: {
  href: string;
  icono: React.ComponentType<{ className?: string }>;
  titulo: string;
  descripcion: string;
  tono?: "secundario" | "primario";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-4 rounded-tarjeta border border-borde bg-superficie p-5 shadow-tarjeta transition-colors hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secundario dark:hover:bg-white/[0.03]",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-tarjeta",
          tono === "primario" ? "bg-primario-suave text-primario-texto" : "bg-secundario-suave text-secundario-texto",
        )}
      >
        <Icono className="size-6" />
      </span>
      <span className="flex-1">
        <span className="titulo-tarjeta block text-ink">{titulo}</span>
        <span className="cuerpo block text-ink-muted">{descripcion}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export { TarjetaAcceso };
