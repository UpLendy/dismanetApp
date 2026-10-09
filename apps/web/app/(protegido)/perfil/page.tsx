"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { CargandoTabla } from "@/components/ui/cargando";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { Pastilla } from "@/components/ui/pastilla";
import { TileDato } from "@/components/ui/tile-dato";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

interface UsuarioPerfil {
  id: string;
  nombre: string;
  email: string;
  rol: "VENDEDOR" | "EMPLEADO" | "ADMIN" | "SUPER_ADMIN";
}

type TipoMovimiento = "CARGA" | "CONSUMO" | "DEVOLUCION" | "AJUSTE";

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

export default function PaginaPerfil() {
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [usuario, setUsuario] = useState<UsuarioPerfil | null>(null);

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [guardandoDatos, setGuardandoDatos] = useState(false);
  const [errorDatos, setErrorDatos] = useState<string | null>(null);
  const [exitoDatos, setExitoDatos] = useState<string | null>(null);

  const [passwordActual, setPasswordActual] = useState("");
  const [passwordNueva, setPasswordNueva] = useState("");
  const [guardandoPassword, setGuardandoPassword] = useState(false);
  const [errorPassword, setErrorPassword] = useState<string | null>(null);
  const [exitoPassword, setExitoPassword] = useState<string | null>(null);

  const [saldo, setSaldo] = useState<{ usaSaldo: boolean; saldo: string | null } | null>(null);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);

  useEffect(() => {
    (async () => {
      setCargando(true);
      setErrorCarga(null);
      const [perfilResp, saldoResp, movimientosResp] = await Promise.all([
        api.perfil.get(),
        api.perfil.saldo.get(),
        api.perfil.saldo.movimientos.get(),
      ]);
      setCargando(false);

      if (perfilResp.error || !perfilResp.data) {
        setErrorCarga(mensajeDeError(perfilResp.error));
        return;
      }

      setUsuario(perfilResp.data.usuario);
      setNombre(perfilResp.data.usuario.nombre);
      setEmail(perfilResp.data.usuario.email);
      if (saldoResp.data) setSaldo(saldoResp.data);
      if (movimientosResp.data) setMovimientos(movimientosResp.data.movimientos);
    })();
  }, []);

  async function guardarDatos(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setGuardandoDatos(true);
    setErrorDatos(null);
    setExitoDatos(null);

    const { data, error: errorRespuesta } = await api.perfil.put({ nombre, email });
    setGuardandoDatos(false);

    if (errorRespuesta || !data) {
      setErrorDatos(mensajeDeError(errorRespuesta));
      return;
    }

    setUsuario(data.usuario);
    setExitoDatos("Tus datos se actualizaron correctamente.");
  }

  async function cambiarContrasena(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setGuardandoPassword(true);
    setErrorPassword(null);
    setExitoPassword(null);

    const { error: errorRespuesta } = await api.perfil.contrasena.put({ passwordActual, passwordNueva });
    setGuardandoPassword(false);

    if (errorRespuesta) {
      setErrorPassword(mensajeDeError(errorRespuesta));
      return;
    }

    setPasswordActual("");
    setPasswordNueva("");
    setExitoPassword("Tu contraseña se actualizó. Cerramos tus demás sesiones activas.");
  }

  if (cargando) {
    return <CargandoTabla filas={2} columnas={1} />;
  }

  if (errorCarga || !usuario) {
    return <Aviso variante="critico">{errorCarga ?? "No se pudo cargar tu perfil."}</Aviso>;
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="titulo-pagina text-ink">Mi perfil</h1>
        <p className="cuerpo text-ink-muted">{usuario.rol}</p>
      </div>

      {saldo?.usaSaldo ? (
        <Tarjeta className="space-y-4">
          <TarjetaCabecera titulo="Mi saldo" />
          <TileDato etiqueta="Saldo actual" valor={formatearPesos(saldo.saldo ?? "0")} icono={Wallet} />

          {movimientos.length === 0 ? (
            <EstadoVacio
              icono={Wallet}
              titulo="Todavía no hay movimientos"
              descripcion="Tus cargas, ventas y ajustes aparecerán aquí."
            />
          ) : (
            <Tabla>
              <TablaCabecera>
                <tr>
                  <TablaCeldaCabecera>Fecha</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Tipo</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Monto</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Saldo resultante</TablaCeldaCabecera>
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
                    <TablaCelda className="text-ink-muted">{movimiento.nota ?? "—"}</TablaCelda>
                  </TablaFila>
                ))}
              </TablaCuerpo>
            </Tabla>
          )}
        </Tarjeta>
      ) : null}

      <Tarjeta>
        <TarjetaCabecera titulo="Datos personales" />
        <form onSubmit={guardarDatos} className="space-y-4">
          <Campo etiqueta="Nombre" required>
            {(props) => (
              <EntradaCampo {...props} required value={nombre} onChange={(evento) => setNombre(evento.target.value)} />
            )}
          </Campo>
          <Campo etiqueta="Correo" required>
            {(props) => (
              <EntradaCampo
                {...props}
                type="email"
                required
                value={email}
                onChange={(evento) => setEmail(evento.target.value)}
              />
            )}
          </Campo>

          {errorDatos ? <Aviso variante="critico">{errorDatos}</Aviso> : null}
          {exitoDatos ? <Aviso variante="info">{exitoDatos}</Aviso> : null}

          <Boton type="submit" variante="principal" disabled={guardandoDatos}>
            {guardandoDatos ? "Guardando…" : "Guardar"}
          </Boton>
        </form>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Cambiar contraseña" />
        <form onSubmit={cambiarContrasena} className="space-y-4">
          <Campo etiqueta="Contraseña actual" required>
            {(props) => (
              <EntradaCampo
                {...props}
                type="password"
                required
                value={passwordActual}
                onChange={(evento) => setPasswordActual(evento.target.value)}
              />
            )}
          </Campo>
          <Campo etiqueta="Contraseña nueva" ayuda="Mínimo 8 caracteres." required>
            {(props) => (
              <EntradaCampo
                {...props}
                type="password"
                required
                minLength={8}
                value={passwordNueva}
                onChange={(evento) => setPasswordNueva(evento.target.value)}
              />
            )}
          </Campo>

          {errorPassword ? <Aviso variante="critico">{errorPassword}</Aviso> : null}
          {exitoPassword ? <Aviso variante="info">{exitoPassword}</Aviso> : null}

          <Boton type="submit" variante="principal" disabled={guardandoPassword}>
            {guardandoPassword ? "Cambiando…" : "Cambiar contraseña"}
          </Boton>
        </form>
      </Tarjeta>
    </div>
  );
}
