"use client";

import * as React from "react";
import { AlertDialog } from "radix-ui";
import { cn } from "@/lib/utils";
import { Boton } from "@/components/ui/boton";

// Dialogo — DISENO.md §4. Confirmación de una acción que no admite deshacer.
// El título nombra exactamente lo que se va a hacer (nunca "¿Estás seguro?"
// suelto). `varianteConfirmar` es "destructivo" (contorno + texto primario)
// para desactivar/anular/eliminar, o "principal" (sólido) para una acción
// irreversible que no es destructiva, como cargar saldo.
function Dialogo({
  abierto,
  onCambiarAbierto,
  titulo,
  descripcion,
  textoConfirmar = "Confirmar",
  textoCancelar = "Cancelar",
  varianteConfirmar = "destructivo",
  confirmando = false,
  onConfirmar,
  children,
}: {
  abierto: boolean;
  onCambiarAbierto: (abierto: boolean) => void;
  titulo: string;
  /**
   * La frase que explica la acción. Es lo que un lector de pantalla anuncia
   * como descripción del diálogo, así que va texto, no interfaz: un campo o
   * un aviso van en `children`.
   */
  descripcion?: React.ReactNode;
  /** Contenido debajo de la descripción: campos, avisos. */
  children?: React.ReactNode;
  textoConfirmar?: string;
  textoCancelar?: string;
  varianteConfirmar?: "destructivo" | "principal";
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
          {/* asChild + <div>: por defecto Radix renderiza la descripción como un
              <p>, y entonces cualquier bloque que le pase el llamador —otro
              <p>, un Aviso, un Campo— es HTML inválido y revienta la
              hidratación. Un <div> acepta lo que sea y conserva el
              aria-describedby. */}
          {descripcion ? (
            <AlertDialog.Description asChild>
              <div className="cuerpo mt-2 text-ink-2">{descripcion}</div>
            </AlertDialog.Description>
          ) : null}
          {children ? <div className="mt-4 space-y-3">{children}</div> : null}
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Boton variante="contorno" type="button">
                {textoCancelar}
              </Boton>
            </AlertDialog.Cancel>
            <Boton variante={varianteConfirmar} type="button" disabled={confirmando} onClick={onConfirmar}>
              {confirmando ? "Procesando…" : textoConfirmar}
            </Boton>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export { Dialogo };
