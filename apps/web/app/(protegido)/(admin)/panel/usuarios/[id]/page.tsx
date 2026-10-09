"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Wallet, PlusCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Pastilla, PastillaEstado } from "@/components/ui/pastilla";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Dialogo } from "@/components/ui/dialogo";
import { TileDato } from "@/components/ui/tile-dato";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { CargandoTarjeta, CargandoTabla } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

type TipoMovimiento = "CARGA" | "CONSUMO" | "DEVOLUCION" | "AJUSTE";

interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: "SUPER_ADMIN" | "ADMIN" | "EMPLEADO" | "VENDEDOR";
  activo: boolean;
  usaSaldo: boolean;
  saldo: string;
}

interface Movimiento {
  id: string;
  tipo: TipoMovimiento;
  monto: string;
  saldoResultante: string;
  ventaId: string | null;
  nota: string | null;
  creadoPorId: string;
  createdAt: string;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

// Solo manipulación de texto, nunca aritmética con number (CLAUDE.md).
function formatearPesos(valor: string): string {
  const signo = valor.startsWith("-") ? "-" : "";
  const sinSigno = signo ? valor.slice(1) : valor;
  const [entero, decimal] = sinSigno.split(".");
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal ? `${signo}$${conPuntos},${decimal}` : `${signo}$${conPuntos}`;
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const ETIQUETA_TIPO: Record<TipoMovimiento, string> = {
  CARGA: "Carga",
  CONSUMO: "Consumo",
  DEVOLUCION: "Devolución",
  AJUSTE: "Ajuste",
};

const TONO_TIPO: Record<TipoMovimiento, "bien" | "secundario" | "neutral"> = {
  CARGA: "bien",
  CONSUMO: "neutral",
  DEVOLUCION: "secundario",
  AJUSTE: "secundario",
};

export default function PaginaDetalleUsuario() {
  const { id } = useParams<{ id: string }>();

  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [nombresUsuarios, setNombresUsuarios] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    setError(null);
    const [respuesta, listado] = await Promise.all([api.usuarios({ id }).saldo.movimientos.get(), api.usuarios.get()]);
    setCargando(false);

    if (respuesta.error || !respuesta.data) {
      setError(mensajeDeError(respuesta.error));
      return;
    }
    setUsuario(respuesta.data.usuario);
    setMovimientos(respuesta.data.movimientos);
    if (listado.data) {
      setNombresUsuarios(Object.fromEntries(listado.data.usuarios.map((u) => [u.id, u.nombre])));
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Cargar saldo — mismo flujo de dos pasos que la lista: el panel recoge
  // monto + nota, el Dialogo nombra el monto exacto antes de ejecutar.
  const [panelCargaAbierto, setPanelCargaAbierto] = useState(false);
  const [montoCarga, setMontoCarga] = useState("");
  const [notaCarga, setNotaCarga] = useState("");
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [confirmandoCarga, setConfirmandoCarga] = useState<{ monto: string; nota: string } | null>(null);
  const [procesandoCarga, setProcesandoCarga] = useState(false);

  function abrirCarga() {
    setMontoCarga("");
    setNotaCarga("");
    setErrorCarga(null);
    setPanelCargaAbierto(true);
  }

  function pedirConfirmacionCarga(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setConfirmandoCarga({ monto: montoCarga, nota: notaCarga });
  }

  async function confirmarCarga() {
    if (!confirmandoCarga) return;
    setProcesandoCarga(true);
    const { error: errorRespuesta } = await api
      .usuarios({ id })
      .saldo.cargar.post({ monto: confirmandoCarga.monto, nota: confirmandoCarga.nota || undefined });
    setProcesandoCarga(false);

    if (errorRespuesta) {
      setConfirmandoCarga(null);
      setErrorCarga(mensajeDeError(errorRespuesta));
      return;
    }

    setConfirmandoCarga(null);
    setPanelCargaAbierto(false);
    cargar();
  }

  // Ajuste — corrección manual con nota obligatoria (R3: los movimientos no
  // se editan ni se borran, un error se corrige con un movimiento nuevo).
  const [panelAjusteAbierto, setPanelAjusteAbierto] = useState(false);
  const [montoAjuste, setMontoAjuste] = useState("");
  const [notaAjuste, setNotaAjuste] = useState("");
  const [errorAjuste, setErrorAjuste] = useState<string | null>(null);
  const [registrandoAjuste, setRegistrandoAjuste] = useState(false);

  function abrirAjuste() {
    setMontoAjuste("");
    setNotaAjuste("");
    setErrorAjuste(null);
    setPanelAjusteAbierto(true);
  }

  async function registrarAjuste(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setRegistrandoAjuste(true);
    setErrorAjuste(null);
    const { error: errorRespuesta } = await api
      .usuarios({ id })
      .saldo.ajuste.post({ monto: montoAjuste, nota: notaAjuste });
    setRegistrandoAjuste(false);

    if (errorRespuesta) {
      setErrorAjuste(mensajeDeError(errorRespuesta));
      return;
    }

    setPanelAjusteAbierto(false);
    cargar();
  }

  if (cargando) {
    return (
      <div className="space-y-6">
        <CargandoTarjeta />
        <CargandoTabla filas={6} columnas={5} />
      </div>
    );
  }

  if (error || !usuario) {
    return (
      <div className="space-y-4">
        <Aviso variante="critico">{error ?? "No se pudo cargar el usuario."}</Aviso>
        <Link href="/panel/usuarios" className="font-medium text-secundario hover:underline">
          Volver a usuarios
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/panel/usuarios"
          className="inline-flex items-center gap-1 font-medium text-secundario hover:underline"
        >
          <ArrowLeft className="size-4" />
          Usuarios
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="titulo-pagina text-ink">{usuario.nombre}</h1>
          <PastillaEstado estado={usuario.activo ? "activo" : "inactivo"} />
          <Pastilla tono="secundario">{usuario.rol}</Pastilla>
        </div>
        <p className="cuerpo text-ink-muted">{usuario.email}</p>
      </div>

      {!usuario.usaSaldo ? (
        <Aviso variante="info">
          Este usuario no vende contra saldo: el saldo es exclusivo del rol VENDEDOR. Si necesita vender contra
          saldo propio, cambia su rol a VENDEDOR desde la lista de usuarios.
        </Aviso>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <TileDato etiqueta="Saldo actual" valor={formatearPesos(usuario.saldo)} icono={Wallet} />
            <div className="flex gap-2">
              <Boton variante="contorno" onClick={abrirCarga}>
                <Wallet />
                Cargar saldo
              </Boton>
              <Boton variante="contorno" onClick={abrirAjuste}>
                <PlusCircle />
                Registrar ajuste
              </Boton>
            </div>
          </div>

          {movimientos.length === 0 ? (
            <EstadoVacio
              icono={Wallet}
              titulo="Todavía no hay movimientos"
              descripcion="Las cargas, ventas y ajustes de este usuario aparecerán aquí."
            />
          ) : (
            <Tabla>
              <TablaCabecera>
                <tr>
                  <TablaCeldaCabecera>Fecha</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Tipo</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Monto</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Saldo resultante</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Registrado por</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Nota</TablaCeldaCabecera>
                </tr>
              </TablaCabecera>
              <TablaCuerpo>
                {movimientos.map((movimiento) => (
                  <TablaFila key={movimiento.id}>
                    <TablaCelda className="text-ink-muted">{formatearFecha(movimiento.createdAt)}</TablaCelda>
                    <TablaCelda>
                      <Pastilla tono={TONO_TIPO[movimiento.tipo]}>{ETIQUETA_TIPO[movimiento.tipo]}</Pastilla>
                    </TablaCelda>
                    <TablaCelda
                      className={`text-right tabular-nums ${movimiento.monto.startsWith("-") ? "text-critico" : "text-bien"}`}
                    >
                      {formatearPesos(movimiento.monto)}
                    </TablaCelda>
                    <TablaCelda className="text-right tabular-nums">{formatearPesos(movimiento.saldoResultante)}</TablaCelda>
                    <TablaCelda>{nombresUsuarios[movimiento.creadoPorId] ?? "—"}</TablaCelda>
                    <TablaCelda className="text-ink-muted">{movimiento.nota ?? "—"}</TablaCelda>
                  </TablaFila>
                ))}
              </TablaCuerpo>
            </Tabla>
          )}
        </>
      )}

      <PanelLateral
        abierto={panelCargaAbierto}
        onCambiarAbierto={setPanelCargaAbierto}
        titulo="Cargar saldo"
        descripcion={`Saldo actual: ${formatearPesos(usuario.saldo)}`}
      >
        <form onSubmit={pedirConfirmacionCarga} className="space-y-4">
          {errorCarga ? <Aviso variante="critico">{errorCarga}</Aviso> : null}

          <Campo etiqueta="Monto a cargar" required ayuda="Se suma al saldo actual.">
            {(props) => (
              <EntradaCampo
                {...props}
                required
                inputMode="decimal"
                placeholder="50000"
                value={montoCarga}
                onChange={(e) => setMontoCarga(e.target.value)}
              />
            )}
          </Campo>

          <Campo etiqueta="Nota" ayuda="Opcional: de dónde viene este dinero.">
            {(props) => <EntradaCampo {...props} value={notaCarga} onChange={(e) => setNotaCarga(e.target.value)} />}
          </Campo>

          <div className="flex gap-2 pt-2">
            <Boton type="submit" variante="principal" className="flex-1">
              Continuar
            </Boton>
          </div>
        </form>
      </PanelLateral>

      <Dialogo
        abierto={!!confirmandoCarga}
        onCambiarAbierto={(abierto) => !abierto && setConfirmandoCarga(null)}
        titulo={confirmandoCarga ? `Cargar ${formatearPesos(confirmandoCarga.monto)} al saldo de ${usuario.nombre}` : ""}
        descripcion={
          confirmandoCarga
            ? `Saldo actual: ${formatearPesos(usuario.saldo)}.${confirmandoCarga.nota ? ` Nota: ${confirmandoCarga.nota}.` : ""} Esta operación queda registrada y no se puede deshacer.`
            : undefined
        }
        textoConfirmar="Cargar saldo"
        varianteConfirmar="principal"
        confirmando={procesandoCarga}
        onConfirmar={confirmarCarga}
      />

      <PanelLateral
        abierto={panelAjusteAbierto}
        onCambiarAbierto={setPanelAjusteAbierto}
        titulo="Registrar ajuste"
        descripcion={`Saldo actual: ${formatearPesos(usuario.saldo)}. Usa un monto negativo para restar.`}
      >
        <form onSubmit={registrarAjuste} className="space-y-4">
          {errorAjuste ? <Aviso variante="critico">{errorAjuste}</Aviso> : null}

          <Campo etiqueta="Monto del ajuste" required ayuda="Con signo: positivo suma, negativo resta.">
            {(props) => (
              <EntradaCampo
                {...props}
                required
                inputMode="decimal"
                placeholder="-5000"
                value={montoAjuste}
                onChange={(e) => setMontoAjuste(e.target.value)}
              />
            )}
          </Campo>

          <Campo etiqueta="Nota" required ayuda="Por qué se hace este ajuste — queda en el historial para siempre.">
            {(props) => <EntradaCampo {...props} required value={notaAjuste} onChange={(e) => setNotaAjuste(e.target.value)} />}
          </Campo>

          <div className="flex gap-2 pt-2">
            <Boton type="submit" variante="principal" disabled={registrandoAjuste} className="flex-1">
              {registrandoAjuste ? "Registrando…" : "Registrar ajuste"}
            </Boton>
          </div>
        </form>
      </PanelLateral>
    </div>
  );
}
