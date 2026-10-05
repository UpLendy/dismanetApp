"use client";

import * as React from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// PanelLateral — DISENO.md §6: el alta y la edición de las pantallas de
// lista viven aquí, deslizado desde la derecha, nunca en una página aparte.
function PanelLateral({
  abierto,
  onCambiarAbierto,
  titulo,
  descripcion,
  children,
  className,
}: {
  abierto: boolean;
  onCambiarAbierto: (abierto: boolean) => void;
  titulo: string;
  descripcion?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={abierto} onOpenChange={onCambiarAbierto}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-borde bg-superficie shadow-tarjeta data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-borde p-5">
            <div>
              <Dialog.Title className="titulo-seccion text-ink">{titulo}</Dialog.Title>
              {descripcion ? <Dialog.Description className="cuerpo mt-1 text-ink-muted">{descripcion}</Dialog.Description> : null}
            </div>
            <Dialog.Close className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-secundario dark:hover:bg-white/5">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { PanelLateral };
