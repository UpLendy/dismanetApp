"use client";

import * as React from "react";
import { AlertDialog } from "radix-ui";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";

// Dialogo — DISENO.md §4. Confirmación de acciones destructivas. El título
// nombra exactamente lo que se va a hacer (nunca "¿Estás seguro?" suelto).
function Dialogo({
  abierto,
  onCambiarAbierto,
  titulo,
  descripcion,
  textoConfirmar = "Confirmar",
  textoCancelar = "Cancelar",
  confirmando = false,
  onConfirmar,
}: {
  abierto: boolean;
  onCambiarAbierto: (abierto: boolean) => void;
  titulo: string;
  descripcion?: React.ReactNode;
  textoConfirmar?: string;
  textoCancelar?: string;
  confirmando?: boolean;
  onConfirmar: () => void;
}) {
  return (
    <AlertDialog.Root open={abierto} onOpenChange={onCambiarAbierto}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <AlertDialog.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-tarjeta border border-borde bg-superficie p-6 shadow-tarjeta",
          )}
        >
          <AlertDialog.Title className="titulo-seccion text-ink">{titulo}</AlertDialog.Title>
          {descripcion ? (
            <AlertDialog.Description className="cuerpo mt-2 text-ink-2">{descripcion}</AlertDialog.Description>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Boton variante="contorno" type="button">
                {textoCancelar}
              </Boton>
            </AlertDialog.Cancel>
            <Boton variante="destructivo" type="button" disabled={confirmando} onClick={onConfirmar}>
              {confirmando ? "Procesando…" : textoConfirmar}
            </Boton>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export { Dialogo };
