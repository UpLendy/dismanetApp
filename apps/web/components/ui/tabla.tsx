import * as React from "react";
import { cn } from "@/lib/utils";

// Tabla — DISENO.md §4. Cabecera --ink-muted en 12px mayúsculas, filas con
// separador hairline, sin cebra, hover de fila sutil. Números tabular-nums
// alineados a la derecha (pasar className="text-right tabular-nums" en la
// celda numérica).
//
// Responsive (§7): por debajo de `sm` cada fila se vuelve una tarjeta
// apilada en vez de una fila de tabla con scroll horizontal — la cabecera
// se oculta y cada celda pasa a ser su propia línea dentro de la tarjeta.
// Son los mismos elementos <table>/<tr>/<td>, solo con su `display`
// reescrito por Tailwind; ningún call-site necesita cambiar.
function Tabla({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("block w-full cuerpo text-ink sm:table", className)} {...props} />
    </div>
  );
}

function TablaCabecera({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("hidden border-b border-borde sm:table-header-group", className)} {...props} />;
}

function TablaCuerpo({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("block space-y-3 sm:table-row-group sm:space-y-0", className)} {...props} />;
}

function TablaFila({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "block rounded-tarjeta border border-borde p-3",
        "sm:table-row sm:rounded-none sm:border-0 sm:border-b sm:border-borde sm:p-0 sm:last:border-b-0",
        "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]",
        className,
      )}
      {...props}
    />
  );
}

function TablaCeldaCabecera({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "etiqueta-dato px-3 py-2 text-left first:pl-0 last:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TablaCelda({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "block py-1 align-middle",
        "sm:table-cell sm:px-3 sm:py-3 sm:first:pl-0 sm:last:pr-0",
        className,
      )}
      {...props}
    />
  );
}

export { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda };
