"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

let contador = 0;
function idUnico(prefijo: string): string {
  contador += 1;
  return `${prefijo}-${contador}`;
}

// Campo — DISENO.md §4. Etiqueta, control, texto de ayuda y mensaje de
// error. El texto de ayuda siempre visible, nunca en tooltip. El error se
// asocia al control con aria-describedby (DISENO.md §7).
function Campo({
  etiqueta,
  ayuda,
  error,
  required,
  className,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const idControl = React.useId();
  const idAyuda = ayuda ? `${idControl}-ayuda` : undefined;
  const idError = error ? `${idControl}-error` : undefined;
  const describedBy = [idAyuda, idError].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={idControl} className="cuerpo block font-medium text-ink">
        {etiqueta}
        {required ? <span className="text-primario-texto"> *</span> : null}
      </label>
      {children({ id: idControl, "aria-describedby": describedBy, "aria-invalid": !!error })}
      {ayuda ? (
        <p id={idAyuda} className="text-xs text-ink-muted">
          {ayuda}
        </p>
      ) : null}
      {error ? (
        <p id={idError} role="alert" className="text-xs font-medium text-critico">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const claseControl =
  "flex h-10 w-full rounded-control border border-borde bg-superficie px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-secundario aria-[invalid=true]:border-critico disabled:cursor-not-allowed disabled:opacity-50";

const EntradaCampo = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(function EntradaCampo(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(claseControl, className)} {...props} />;
});

const AreaCampo = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(function AreaCampo(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(claseControl, "h-auto min-h-20 py-2", className)} {...props} />;
});

const SelectCampo = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(function SelectCampo(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cn(claseControl, className)} {...props} />;
});

export { Campo, EntradaCampo, AreaCampo, SelectCampo, idUnico };
