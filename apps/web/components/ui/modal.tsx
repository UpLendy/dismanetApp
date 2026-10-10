"use client";

import * as React from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Modal — DISENO.md §6, paso 2 de /vender. Grilla de selección (plataformas
// o paquetes) con logos y disponibilidad. Pantalla completa en ancho de
// teléfono, centrado en escritorio. Se cierra sin elegir nada con la X o
// tocando fuera — eso nunca pierde el estado del paso 1.
function Modal({
  abierto,
  onCambiarAbierto,
  titulo,
  buscador,
  children,
}: {
  abierto: boolean;
  onCambiarAbierto: (abierto: boolean) => void;
  titulo: string;
  /** Campo de búsqueda, mostrado solo por quien llama cuando hay más de 12 ítems. */
  buscador?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={abierto} onOpenChange={onCambiarAbierto}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            "fixed inset-0 z-50 flex flex-col bg-superficie shadow-tarjeta",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85vh] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-tarjeta sm:border sm:border-borde",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-borde p-5">
            <Dialog.Title className="titulo-seccion text-ink">{titulo}</Dialog.Title>
            <Dialog.Close className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-secundario dark:hover:bg-white/5">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {buscador ? <div className="border-b border-borde p-3">{buscador}</div> : null}
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { Modal };
