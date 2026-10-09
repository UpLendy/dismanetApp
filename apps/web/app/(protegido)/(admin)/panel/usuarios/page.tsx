"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Plus, Ban, RotateCcw, UserRound, Wallet, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { PastillaEstado, Pastilla } from "@/components/ui/pastilla";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Dialogo } from "@/components/ui/dialogo";
import { Interruptor } from "@/components/ui/interruptor";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { CargandoTabla } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

type Rol = "SUPER_ADMIN" | "ADMIN" | "VENDEDOR";

interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  usaSaldo: boolean;
  saldo: string;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

// Solo manipulación de texto, nunca aritmética con number (CLAUDE.md).
function formatearPesos(valor: string): string {
  const [entero, decimal] = valor.split(".");
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal ? `$${conPuntos},${decimal}` : `$${conPuntos}`;
}

// Solo dígitos: si lo que queda tras quitar el punto y el signo es puro
// cero, el saldo es cero. Evita convertir dinero a number (CLAUDE.md).
function esSaldoCero(saldo: string): boolean {
  return /^0+$/.test(saldo.replace(/[.-]/g, ""));
}

export default function PaginaUsuarios() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [errorFila, setErrorFila] = useState<string | null>(null);

  const [panelAbierto, setPanelAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<Rol>("VENDEDOR");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmandoDesactivar, setConfirmandoDesactivar] = useState<Usuario | null>(null);
  const [desactivando, setDesactivando] = useState(false);

  const [confirmandoActivarSaldo, setConfirmandoActivarSaldo] = useState<Usuario | null>(null);
  const [activandoSaldo, setActivandoSaldo] = useState(false);

  // Cargar saldo: el panel recoge monto + nota, y solo al confirmar en el
  // Dialogo (que nombra exactamente el monto y el destinatario) se llama al
  // API. Dos pasos a propósito — es dinero, no admite deshacer.
  const [cargandoSaldoPara, setCargandoSaldoPara] = useState<Usuario | null>(null);
  const [montoCarga, setMontoCarga] = useState("");
  const [notaCarga, setNotaCarga] = useState("");
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [confirmandoCarga, setConfirmandoCarga] = useState<{ usuario: Usuario; monto: string; nota: string } | null>(
    null,
  );
  const [cargandoCarga, setCargandoCarga] = useState(false);

  async function cargarUsuarios() {
    setCargandoLista(true);
    setErrorLista(null);
    const { data, error: errorRespuesta } = await api.usuarios.get();
    setCargandoLista(false);
    if (errorRespuesta || !data) {
      setErrorLista(mensajeDeError(errorRespuesta));
      return;
    }
    setUsuarios(data.usuarios);
  }

  useEffect(() => {
    cargarUsuarios();
  }, []);

  function abrirCrear() {
    setNombre("");
    setEmail("");
    setPassword("");
    setRol("VENDEDOR");
    setError(null);
    setPanelAbierto(true);
  }

  async function crearUsuario(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    const { data, error: errorRespuesta } = await api.usuarios.post({ nombre, email, password, rol });
    setGuardando(false);

    if (errorRespuesta || !data || !("usuario" in data) || !data.usuario) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    setPanelAbierto(false);
    cargarUsuarios();
  }

  async function confirmarDesactivar() {
    if (!confirmandoDesactivar) return;
    setDesactivando(true);
    const { error: errorRespuesta } = await api.usuarios({ id: confirmandoDesactivar.id }).desactivar.patch();
    setDesactivando(false);
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      setConfirmandoDesactivar(null);
      return;
    }
    setConfirmandoDesactivar(null);
    cargarUsuarios();
  }

  async function reactivar(id: string) {
    setErrorFila(null);
    const { error: errorRespuesta } = await api.usuarios({ id }).reactivar.patch();
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      return;
    }
    cargarUsuarios();
  }

  async function cambiarRol(id: string, nuevoRol: Rol) {
    setErrorFila(null);
    const { error: errorRespuesta } = await api.usuarios({ id }).rol.patch({ rol: nuevoRol });
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
    }
    cargarUsuarios();
  }

  async function cambiarUsaSaldo(usuario: Usuario, usaSaldo: boolean) {
    setErrorFila(null);
    const { error: errorRespuesta } = await api.usuarios({ id: usuario.id })["usar-saldo"].patch({ usaSaldo });
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      return;
    }
    cargarUsuarios();
  }

  // Desactivar devuelve a la persona su capacidad de vender: no necesita
  // aviso. Activar sobre alguien con saldo en cero la deja sin poder vender
  // de inmediato, así que ese caso pide confirmación primero.
  function alCambiarUsaSaldo(usuario: Usuario, usaSaldo: boolean) {
    if (usaSaldo && esSaldoCero(usuario.saldo)) {
      setConfirmandoActivarSaldo(usuario);
      return;
    }
    cambiarUsaSaldo(usuario, usaSaldo);
  }

  async function confirmarActivarSaldo() {
    if (!confirmandoActivarSaldo) return;
    setActivandoSaldo(true);
    await cambiarUsaSaldo(confirmandoActivarSaldo, true);
    setActivandoSaldo(false);
    setConfirmandoActivarSaldo(null);
  }

  function abrirCargarSaldo(usuario: Usuario) {
    setCargandoSaldoPara(usuario);
    setMontoCarga("");
    setNotaCarga("");
    setErrorCarga(null);
  }

  function pedirConfirmacionCarga(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!cargandoSaldoPara) return;
    setConfirmandoCarga({ usuario: cargandoSaldoPara, monto: montoCarga, nota: notaCarga });
  }

  async function confirmarCarga() {
    if (!confirmandoCarga) return;
    setCargandoCarga(true);
    const { error: errorRespuesta } = await api
      .usuarios({ id: confirmandoCarga.usuario.id })
      .saldo.cargar.post({ monto: confirmandoCarga.monto, nota: confirmandoCarga.nota || undefined });
    setCargandoCarga(false);

    if (errorRespuesta) {
      setConfirmandoCarga(null);
      setErrorCarga(mensajeDeError(errorRespuesta));
      return;
    }

    setConfirmandoCarga(null);
    setCargandoSaldoPara(null);
    cargarUsuarios();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Usuarios</h1>
          <p className="cuerpo text-ink-muted">Gestión de los ADMIN y VENDEDOR de la empresa.</p>
        </div>
        <Boton variante="principal" onClick={abrirCrear}>
          <Plus />
          Nuevo usuario
        </Boton>
      </div>

      {errorFila ? <Aviso variante="critico">{errorFila}</Aviso> : null}

      {errorLista ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar los usuarios"
          accion={
            <Boton variante="contorno" onClick={cargarUsuarios}>
              Reintentar
            </Boton>
          }
        >
          {errorLista}
        </Aviso>
      ) : cargandoLista ? (
        <CargandoTabla filas={5} columnas={6} />
      ) : usuarios.length === 0 ? (
        <EstadoVacio
          icono={UserRound}
          titulo="Todavía no hay usuarios"
          descripcion="Crea el primer ADMIN o VENDEDOR de la empresa."
          accion={
            <Boton variante="principal" onClick={abrirCrear}>
              <Plus />
              Nuevo usuario
            </Boton>
          }
        />
      ) : (
        <Tabla>
          <TablaCabecera>
            <tr>
              <TablaCeldaCabecera className="sm:sticky sm:left-0 sm:z-20 sm:bg-superficie">Nombre</TablaCeldaCabecera>
              <TablaCeldaCabecera>Correo</TablaCeldaCabecera>
              <TablaCeldaCabecera>Rol</TablaCeldaCabecera>
              <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
              <TablaCeldaCabecera>Vende contra saldo</TablaCeldaCabecera>
              <TablaCeldaCabecera></TablaCeldaCabecera>
            </tr>
          </TablaCabecera>
          <TablaCuerpo>
            {usuarios.map((usuario) => (
              <TablaFila key={usuario.id}>
                <TablaCelda className="font-medium text-ink sm:sticky sm:left-0 sm:z-10 sm:bg-superficie">
                  {usuario.nombre}
                </TablaCelda>
                <TablaCelda>{usuario.email}</TablaCelda>
                <TablaCelda>
                  {usuario.rol === "SUPER_ADMIN" ? (
                    <Pastilla tono="secundario">SUPER_ADMIN</Pastilla>
                  ) : (
                    <SelectCampo
                      value={usuario.rol}
                      onChange={(e) => cambiarRol(usuario.id, e.target.value as Rol)}
                      className="h-8 w-auto text-xs"
                    >
                      <option value="VENDEDOR">VENDEDOR</option>
                      <option value="ADMIN">ADMIN</option>
                    </SelectCampo>
                  )}
                </TablaCelda>
                <TablaCelda>
                  <PastillaEstado estado={usuario.activo ? "activo" : "inactivo"} />
                </TablaCelda>
                <TablaCelda>
                  <div className="flex items-center gap-3">
                    <Interruptor
                      checked={usuario.usaSaldo}
                      onCheckedChange={(valor) => alCambiarUsaSaldo(usuario, valor)}
                      aria-label={`Vende contra saldo — ${usuario.nombre}`}
                    />
                    {usuario.usaSaldo ? (
                      <span className="tabular-nums text-ink">{formatearPesos(usuario.saldo)}</span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </div>
                </TablaCelda>
                <TablaCelda>
                  <div className="flex justify-end gap-2">
                    {usuario.usaSaldo ? (
                      <>
                        <Boton variante="contorno" tamano="sm" onClick={() => abrirCargarSaldo(usuario)}>
                          <Wallet />
                          Cargar saldo
                        </Boton>
                        <Boton variante="contorno" tamano="sm" asChild>
                          <Link href={`/panel/usuarios/${usuario.id}`}>
                            Historial
                            <ChevronRight />
                          </Link>
                        </Boton>
                      </>
                    ) : null}
                    {usuario.activo ? (
                      <Boton variante="destructivo" tamano="sm" onClick={() => setConfirmandoDesactivar(usuario)}>
                        <Ban />
                        Desactivar
                      </Boton>
                    ) : (
                      <Boton variante="contorno" tamano="sm" onClick={() => reactivar(usuario.id)}>
                        <RotateCcw />
                        Reactivar
                      </Boton>
                    )}
                  </div>
                </TablaCelda>
              </TablaFila>
            ))}
          </TablaCuerpo>
        </Tabla>
      )}

      <PanelLateral abierto={panelAbierto} onCambiarAbierto={setPanelAbierto} titulo="Nuevo usuario">
        <form onSubmit={crearUsuario} className="space-y-4">
          {error ? <Aviso variante="critico">{error}</Aviso> : null}

          <Campo etiqueta="Nombre" required>
            {(props) => <EntradaCampo {...props} required value={nombre} onChange={(e) => setNombre(e.target.value)} />}
          </Campo>

          <Campo etiqueta="Correo" required>
            {(props) => (
              <EntradaCampo {...props} required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </Campo>

          <Campo etiqueta="Contraseña inicial" required>
            {(props) => (
              <EntradaCampo {...props} required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Campo>

          <Campo etiqueta="Rol" required>
            {(props) => (
              <SelectCampo {...props} value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
                <option value="VENDEDOR">VENDEDOR</option>
                <option value="ADMIN">ADMIN</option>
              </SelectCampo>
            )}
          </Campo>

          <div className="flex gap-2 pt-2">
            <Boton type="submit" variante="principal" disabled={guardando} className="flex-1">
              {guardando ? "Creando…" : "Crear usuario"}
            </Boton>
          </div>
        </form>
      </PanelLateral>

      <PanelLateral
        abierto={!!cargandoSaldoPara}
        onCambiarAbierto={(abierto) => !abierto && setCargandoSaldoPara(null)}
        titulo="Cargar saldo"
        descripcion={cargandoSaldoPara ? `Saldo actual de ${cargandoSaldoPara.nombre}: ${formatearPesos(cargandoSaldoPara.saldo)}` : undefined}
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
        titulo={
          confirmandoCarga
            ? `Cargar ${formatearPesos(confirmandoCarga.monto)} al saldo de ${confirmandoCarga.usuario.nombre}`
            : ""
        }
        descripcion={
          confirmandoCarga
            ? `Saldo actual: ${formatearPesos(confirmandoCarga.usuario.saldo)}.${confirmandoCarga.nota ? ` Nota: ${confirmandoCarga.nota}.` : ""} Esta operación queda registrada y no se puede deshacer.`
            : undefined
        }
        textoConfirmar="Cargar saldo"
        varianteConfirmar="principal"
        confirmando={cargandoCarga}
        onConfirmar={confirmarCarga}
      />

      <Dialogo
        abierto={!!confirmandoDesactivar}
        onCambiarAbierto={(abierto) => !abierto && setConfirmandoDesactivar(null)}
        titulo={confirmandoDesactivar ? `Desactivar a ${confirmandoDesactivar.nombre}` : ""}
        descripcion="El usuario no podrá iniciar sesión hasta que lo reactives."
        textoConfirmar="Desactivar"
        confirmando={desactivando}
        onConfirmar={confirmarDesactivar}
      />

      <Dialogo
        abierto={!!confirmandoActivarSaldo}
        onCambiarAbierto={(abierto) => !abierto && setConfirmandoActivarSaldo(null)}
        titulo={confirmandoActivarSaldo ? `Activar venta contra saldo para ${confirmandoActivarSaldo.nombre}` : ""}
        descripcion="Esta persona no va a poder vender hasta que se le cargue saldo."
        textoConfirmar="Activar"
        varianteConfirmar="principal"
        confirmando={activandoSaldo}
        onConfirmar={confirmarActivarSaldo}
      />
    </div>
  );
}
