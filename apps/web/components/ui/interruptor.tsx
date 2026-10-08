"use client";

import * as React from "react";
import { Switch } from "radix-ui";
import { cn } from "@/lib/utils";

// Interruptor — DISENO.md §4. Activa o desactiva un estado binario de
// inmediato (p. ej. "Vende contra saldo"), sin formulario ni botón de
// guardar aparte.
function Interruptor({ className, ...props }: React.ComponentProps<typeof Switch.Root>) {
  return (
    <Switch.Root
      className={cn(
        "relative h-6 w-10 shrink-0 cursor-pointer rounded-full border border-borde bg-ink-muted/25 outline-none transition-colors",
        "data-[state=checked]:border-primario data-[state=checked]:bg-primario",
        "focus-visible:ring-2 focus-visible:ring-secundario focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <Switch.Thumb className="block size-4 translate-x-1 rounded-full bg-white shadow-tarjeta transition-transform data-[state=checked]:translate-x-5" />
    </Switch.Root>
  );
}

export { Interruptor };
