"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Campo, EntradaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Dialogo } from "@/components/ui/dialogo";

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

// F4.11, Parte 4.3 — el ADMIN ya cambió la contraseña en el proveedor;
// este diálogo solo registra ese cambio en DISMANET y libera las pantallas
// POR_REINICIAR de la cuenta. Dos pasos posibles:
// 1) contraseña nueva → si hay pantallas con venta vigente, el API responde
//    409 CUENTA_CON_VENTAS_VIGENTES con los códigos de compra afectados.
// 2) confirmación explícita de ese 409 (nunca una casilla premarcada).
export function DialogoReiniciarCuenta({
  cuenta,
  abierto,
  onCambiarAbierto,
  onExito,
}: {
  cuenta: { id: string; identificador: string } | null;
  abierto: boolean;
  onCambiarAbierto: (abierto: boolean) => void;
  onExito: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [confirmandoVentasVigentes, setConfirmandoVentasVigentes] = useState<string[] | null>(null);

  function reiniciarEstado() {
    setPassword("");
    setError(null);
    setEnviando(false);
    setConfirmandoVentasVigentes(null);
  }

  function cerrar(valor: boolean) {
    if (!valor) reiniciarEstado();
    onCambiarAbierto(valor);
  }

  async function enviar(confirmarVentasVigentes = false) {
    if (!cuenta) return;
    setError(null);
    setEnviando(true);
    const { error: errorRespuesta } = await api.cuentas({ id: cuenta.id }).reiniciar.post({
      password,
      ...(confirmarVentasVigentes ? { confirmarVentasVigentes: true } : {}),
    });
    setEnviando(false);

    if (errorRespuesta) {
      const valor = errorRespuesta.value as
        | { error?: { codigo?: string; mensaje?: string }; codigosCompraAfectados?: string[] }
        | undefined;
      if (valor?.error?.codigo === "CUENTA_CON_VENTAS_VIGENTES" && !confirmarVentasVigentes) {
        setConfirmandoVentasVigentes(valor.codigosCompraAfectados ?? []);
        return;
      }
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    reiniciarEstado();
    onCambiarAbierto(false);
    onExito();
  }

  if (!cuenta) return null;

  if (confirmandoVentasVigentes !== null) {
    return (
      <Dialogo
        abierto={abierto}
        onCambiarAbierto={cerrar}
        titulo={`Reiniciar "${cuenta.identificador}" con ventas vigentes`}
        descripcion={
          confirmandoVentasVigentes.length > 0
            ? `Esta cuenta tiene pantallas con venta vigente (código${confirmandoVentasVigentes.length > 1 ? "s" : ""} de compra ${confirmandoVentasVigentes.join(", ")}). Esos clientes perderán acceso al reiniciar.`
            : "Esta cuenta tiene pantallas con venta vigente. Esos clientes perderán acceso al reiniciar."
        }
        textoConfirmar="Reiniciar de todos modos"
        varianteConfirmar="destructivo"
        confirmando={enviando}
        onConfirmar={() => enviar(true)}
      >
        {error ? <Aviso variante="critico">{error}</Aviso> : null}
      </Dialogo>
    );
  }

  return (
    <Dialogo
      abierto={abierto}
      onCambiarAbierto={cerrar}
      titulo={`Reiniciar cuenta "${cuenta.identificador}"`}
      descripcion="Escribe la nueva contraseña, la misma que ya cambiaste en el proveedor. Esto libera sus pantallas por reiniciar."
      textoConfirmar="Reiniciar"
      varianteConfirmar="principal"
      confirmando={enviando}
      onConfirmar={() => enviar(false)}
    >
      {error ? <Aviso variante="critico">{error}</Aviso> : null}
      <Campo etiqueta="Nueva contraseña" required>
        {(props) => (
          <EntradaCampo {...props} required type="text" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </Campo>
    </Dialogo>
  );
}
