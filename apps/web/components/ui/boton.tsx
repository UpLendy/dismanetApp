"use client";

import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Boton — DISENO.md §4. La distinción entre acción principal y destructiva
// se carga en la FORMA (sólido vs. contorno), nunca en el color: nunca un
// botón sólido rojo para destruir. "principal" es la única variante sólida
// con --primario; úsala como máximo una vez por pantalla.
const variantesBoton = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-secundario focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variante: {
        principal: "bg-primario text-white hover:bg-primario-hover",
        secundario: "bg-secundario text-white hover:bg-secundario/90",
        contorno: "border border-borde bg-superficie text-ink hover:bg-black/4 dark:hover:bg-white/5",
        fantasma: "text-ink hover:bg-black/4 dark:hover:bg-white/5",
        destructivo: "border border-borde bg-superficie text-primario-texto hover:bg-primario-suave",
      },
      tamano: {
        sm: "h-8 px-3 text-sm [&_svg]:size-4",
        md: "h-10 px-4 text-sm [&_svg]:size-4",
        lg: "h-12 px-5 text-base [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variante: "contorno",
      tamano: "md",
    },
  },
);

interface BotonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variantesBoton> {
  asChild?: boolean;
}

function Boton({ className, variante, tamano, asChild = false, ...props }: BotonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(variantesBoton({ variante, tamano, className }))} {...props} />;
}

export { Boton, variantesBoton };
