"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// LogoPlataforma — DISENO.md §6, paso 2 de /vender. Sin logoUrl, o si la
// imagen falla al cargar, la reserva es siempre la pastilla-inicial sobre
// --plano — nunca un ícono de imagen rota. onError apaga la <img> y revela
// la reserva ya presente en el DOM, en vez de intentar un segundo origen.
function LogoPlataforma({
  logoUrl,
  nombre,
  className,
}: {
  logoUrl: string | null;
  nombre: string;
  className?: string;
}) {
  const [fallo, setFallo] = React.useState(false);
  const mostrarImagen = logoUrl !== null && logoUrl !== "" && !fallo;
  const inicial = nombre.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-control bg-plano",
        className,
      )}
    >
      {mostrarImagen ? (
        // eslint-disable-next-line @next/next/no-img-element -- origen puede ser externo o de /public, sin dominios conocidos de antemano
        <img
          src={logoUrl}
          alt={nombre}
          className="size-full object-contain"
          onError={() => setFallo(true)}
        />
      ) : (
        <span aria-hidden className="cuerpo font-semibold text-ink-muted">
          {inicial}
        </span>
      )}
    </span>
  );
}

export { LogoPlataforma };
