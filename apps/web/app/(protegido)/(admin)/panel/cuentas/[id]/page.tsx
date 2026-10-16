"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Ban, CheckCircle2, Eye, Pencil } from "lucide-react";
import { PIN_LONGITUD_MAX, PIN_LONGITUD_MIN, PIN_PATRON } from "@dismanet/shared";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo, AreaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { PastillaEstado } from "@/components/ui/pastilla";
import { Dialogo } from "@/components/ui/dialogo";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { CargandoTarjeta } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

interface Cuenta {
  id: string;
  plataformaId: string;
  nombrePlataforma: string;
  correo: string | null;
  usuario: string | null;
  enlace: string | null;
  capacidadPantallas: number;
  notas: string | null;
  activa: boolean;
  pantallasLibres: number;
  pantallasTotales: number;
}

interface Plataforma {
  id: string;
  usaPerfilPin: boolean;
  usaCorreo: boolean;
  usaUsuario: boolean;
  usaCodigo: boolean;
  usaEnlace: boolean;
}

interface Pantalla {
  id: string;
  numero: number;
  perfil: string | null;
  activa: boolean;
  libre: boolean;
  ocupadaHasta: string | null;
  ventaId: string | null;
}

interface Credenciales {
  password: string;
  usuario: string | null;
  codigo: string | null;
  enlace: string | null;
  pantallas: { id: string; numero: number; pin: string | null }[];
}

// F4.2, parte 1.4 — mismo criterio de respaldo que el listado: correo →
// usuario → plataforma+id, nunca una celda vacía.
function identificadorCuenta(cuenta: Cuenta): string {
  return cuenta.correo ?? cuenta.usuario ?? `${cuenta.nombrePlataforma} #${cuenta.id.slice(0, 8)}`;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota" });
}

export default function PaginaDetalleCuenta() {
  const { id } = useParams<{ id: string }>();

  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [plataforma, setPlataforma] = useState<Plataforma | null>(null);
  const [pantallas, setPantallas] = useState<Pantalla[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [correo, setCorreo] = useState("");
  const [usuario, setUsuario] = useState("");
  const [codigo, setCodigo] = useState("");
  const [enlace, setEnlace] = useState("");
  const [password, setPassword] = useState("");
  const [notas, setNotas] = useState("");
  const [capacidadPantallas, setCapacidadPantallas] = useState("1");
  const [guardando, setGuardando] = useState(false);

  const [credenciales, setCredenciales] = useState<Credenciales | null>(null);
  const [cargandoCredenciales, setCargandoCredenciales] = useState(false);

  const [editandoPantallaId, setEditandoPantallaId] = useState<string | null>(null);
  const [perfilEdicion, setPerfilEdicion] = useState("");
  const [pinEdicion, setPinEdicion] = useState("");
  const [avisoHermanas, setAvisoHermanas] = useState<string | null>(null);
  const [confirmandoPantallaVendida, setConfirmandoPantallaVendida] = useState<{
    pantallaId: string;
    mensaje: string;
    codigosCompraAfectados: string[];
  } | null>(null);
  const [confirmandoPantallaVendidaEnvio, setConfirmandoPantallaVendidaEnvio] = useState(false);

  const [confirmandoEstado, setConfirmandoEstado] = useState<"activar" | "desactivar" | null>(null);
  const [procesandoEstado, setProcesandoEstado] = useState(false);

  async function cargarPlataforma(plataformaId: string) {
    const { data } = await api.plataformas.get();
    if (data) {
      const fila = data.plataformas.find((p) => p.id === plataformaId);
      if (fila) {
        setPlataforma({
          id: fila.id,
          usaPerfilPin: fila.usaPerfilPin,
          usaCorreo: fila.usaCorreo,
          usaUsuario: fila.usaUsuario,
          usaCodigo: fila.usaCodigo,
          usaEnlace: fila.usaEnlace,
        });
      }
    }
  }

  async function cargarDetalle() {
    setCargando(true);
    const { data, error: errorRespuesta } = await api.cuentas({ id }).get();
    setCargando(false);
    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    setCuenta(data.cuenta);
    setPantallas(data.pantallas);
    setCorreo(data.cuenta.correo ?? "");
    setUsuario(data.cuenta.usuario ?? "");
    setCodigo("");
    setEnlace(data.cuenta.enlace ?? "");
    setPassword("");
    setNotas(data.cuenta.notas ?? "");
    setCapacidadPantallas(String(data.cuenta.capacidadPantallas));
    cargarPlataforma(data.cuenta.plataformaId);
  }

  useEffect(() => {
    cargarDetalle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);

    const cuerpo: {
      notas: string;
      capacidadPantallas: number;
      correo?: string;
      usuario?: string;
      codigo?: string;
      enlace?: string;
      password?: string;
    } = {
      notas,
      capacidadPantallas: Number(capacidadPantallas),
    };
    if (plataforma?.usaCorreo) cuerpo.correo = correo;
    if (plataforma?.usaUsuario) cuerpo.usuario = usuario;
    if (plataforma?.usaEnlace) cuerpo.enlace = enlace;
    // Código es secreto (cifrado): nunca llega del GET, así que un campo en
    // blanco significa "no lo tocamos", no "bórralo" — al revés que
    // correo/usuario/enlace, que sí llegan en claro y se prellenan.
    if (plataforma?.usaCodigo && codigo) cuerpo.codigo = codigo;
    if (password) cuerpo.password = password;

    const { error: errorRespuesta } = await api.cuentas({ id }).patch(cuerpo);
    setGuardando(false);

    if (errorRespuesta) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    setCredenciales(null);
    cargarDetalle();
  }

  async function confirmarCambioEstado() {
    if (!confirmandoEstado) return;
    setProcesandoEstado(true);
    const { error: errorRespuesta } =
      confirmandoEstado === "activar"
        ? await api.cuentas({ id }).activar.patch()
        : await api.cuentas({ id }).desactivar.patch();
    setProcesandoEstado(false);
    if (errorRespuesta) {
      setError(mensajeDeError(errorRespuesta));
      setConfirmandoEstado(null);
      return;
    }
    setConfirmandoEstado(null);
    cargarDetalle();
  }

  async function verCredenciales() {
    setError(null);
    setCargandoCredenciales(true);
    const { data, error: errorRespuesta } = await api.cuentas({ id }).credenciales.get();
    setCargandoCredenciales(false);
    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    setCredenciales(data);
  }

  function empezarEdicionPantalla(pantalla: Pantalla) {
    setEditandoPantallaId(pantalla.id);
    setPerfilEdicion(pantalla.perfil ?? "");
    setPinEdicion(credenciales?.pantallas.find((p) => p.id === pantalla.id)?.pin ?? "");
    setError(null);
    setAvisoHermanas(null);
  }

  function cancelarEdicionPantalla() {
    setEditandoPantallaId(null);
    setPerfilEdicion("");
    setPinEdicion("");
  }

  // F4.2, parte 2.3: una pantalla vendida nunca cambia de perfil/PIN a
  // ciegas. El primer intento (confirmar=false) puede volver con 409
  // PANTALLA_VENDIDA — ahí se abre el diálogo y solo el segundo intento,
  // disparado por el admin, manda confirmarPantallaVendida: true.
  async function guardarPantalla(pantallaId: string, confirmar = false) {
    setError(null);

    const cuerpo: { perfil: string | null; pin?: string | null; confirmarPantallaVendida?: boolean } = {
      perfil: perfilEdicion || null,
    };

    if (pinEdicion !== "") {
      cuerpo.pin = pinEdicion;
    } else if (credenciales) {
      // Solo borramos el PIN si el admin está viendo las credenciales y dejó el campo vacío
      cuerpo.pin = null;
    }
    if (confirmar) cuerpo.confirmarPantallaVendida = true;

    const { data, error: errorRespuesta } = await api.cuentas({ id }).pantallas({ pantallaId }).patch(cuerpo);
    if (errorRespuesta) {
      const valor = errorRespuesta.value as
        | { error?: { codigo?: string; mensaje?: string }; codigosCompraAfectados?: string[] }
        | undefined;
      if (valor?.error?.codigo === "PANTALLA_VENDIDA" && !confirmar) {
        setConfirmandoPantallaVendida({
          pantallaId,
          mensaje: valor.error.mensaje ?? "Esta pantalla está vendida.",
          codigosCompraAfectados: valor.codigosCompraAfectados ?? [],
        });
        return;
      }
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    setConfirmandoPantallaVendida(null);
    setAvisoHermanas(
      data && data.pantallasHermanasActualizadas.length > 0
        ? `El PIN también se actualizó en la(s) pantalla(s) #${data.pantallasHermanasActualizadas.join(", #")} (mismo perfil).`
        : null,
    );
    cancelarEdicionPantalla();
    if (credenciales) await verCredenciales();
    cargarDetalle();
  }

  async function confirmarCambioPantallaVendida() {
    if (!confirmandoPantallaVendida) return;
    setConfirmandoPantallaVendidaEnvio(true);
    await guardarPantalla(confirmandoPantallaVendida.pantallaId, true);
    setConfirmandoPantallaVendidaEnvio(false);
  }

  if (cargando) {
    return (
      <div className="space-y-6">
        <CargandoTarjeta />
        <CargandoTarjeta />
      </div>
    );
  }

  if (!cuenta) {
    return (
      <div className="space-y-4">
        <Aviso variante="critico">{error ?? "Cuenta no encontrada."}</Aviso>
        <Link href="/panel/cuentas" className="cuerpo font-medium text-secundario hover:underline">
          ← Volver a cuentas
        </Link>
      </div>
    );
  }

  function estadoPantalla(pantalla: Pantalla): "libre" | "ocupada" | "desactivada" {
    if (!pantalla.activa) return "desactivada";
    return pantalla.libre ? "libre" : "ocupada";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/panel/cuentas"
            className="inline-flex items-center gap-1 cuerpo font-medium text-secundario hover:underline"
          >
            <ArrowLeft className="size-4" />
            Cuentas
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="titulo-pagina text-ink">{identificadorCuenta(cuenta)}</h1>
            <PastillaEstado estado={cuenta.activa ? "activo" : "inactivo"} />
          </div>
          <p className="cuerpo text-ink-muted">
            {cuenta.nombrePlataforma} · {cuenta.pantallasLibres} libres / {cuenta.pantallasTotales} total
          </p>
        </div>
        {cuenta.activa ? (
          <Boton variante="destructivo" onClick={() => setConfirmandoEstado("desactivar")}>
            <Ban />
            Desactivar
          </Boton>
        ) : (
          <Boton variante="contorno" onClick={() => setConfirmandoEstado("activar")}>
            <CheckCircle2 />
            Activar
          </Boton>
        )}
      </div>

      {error ? <Aviso variante="critico">{error}</Aviso> : null}

      <Tarjeta className="max-w-xl">
        <TarjetaCabecera titulo="Editar cuenta" />
        <form onSubmit={guardar} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {plataforma?.usaCorreo ? (
              <Campo etiqueta="Correo" required>
                {(props) => (
                  <EntradaCampo {...props} required type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
                )}
              </Campo>
            ) : null}
            {plataforma?.usaUsuario ? (
              <Campo etiqueta="Usuario" required>
                {(props) => (
                  <EntradaCampo {...props} required type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
                )}
              </Campo>
            ) : null}
            {plataforma?.usaCodigo ? (
              <Campo etiqueta="Nuevo código" ayuda="Dejar en blanco para no cambiarlo.">
                {(props) => <EntradaCampo {...props} type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} />}
              </Campo>
            ) : null}
            {plataforma?.usaEnlace ? (
              <Campo etiqueta="Enlace" required>
                {(props) => (
                  <EntradaCampo {...props} required type="text" value={enlace} onChange={(e) => setEnlace(e.target.value)} />
                )}
              </Campo>
            ) : null}
            <Campo etiqueta="Nueva contraseña" ayuda="Dejar en blanco para no cambiarla.">
              {(props) => <EntradaCampo {...props} type="text" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Campo>
            <Campo etiqueta="Cantidad de pantallas" required>
              {(props) => (
                <EntradaCampo
                  {...props}
                  required
                  type="number"
                  min={1}
                  step={1}
                  value={capacidadPantallas}
                  onChange={(e) => setCapacidadPantallas(e.target.value)}
                />
              )}
            </Campo>
          </div>
          <Campo etiqueta="Notas">
            {(props) => <AreaCampo {...props} rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />}
          </Campo>
          <Boton type="submit" variante="principal" disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar cambios"}
          </Boton>
        </form>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera
          titulo="Pantallas"
          accion={
            credenciales ? (
              <div className="flex flex-wrap items-center gap-3 cuerpo text-ink-muted">
                <span>Contraseña: {credenciales.password}</span>
                {plataforma?.usaUsuario ? <span>Usuario: {credenciales.usuario ?? "—"}</span> : null}
                {plataforma?.usaCodigo ? <span>Código: {credenciales.codigo ?? "—"}</span> : null}
                {plataforma?.usaEnlace ? <span>Enlace: {credenciales.enlace ?? "—"}</span> : null}
              </div>
            ) : (
              <Boton variante="contorno" tamano="sm" onClick={verCredenciales} disabled={cargandoCredenciales}>
                <Eye />
                {cargandoCredenciales ? "Cargando…" : "Ver credenciales"}
              </Boton>
            )
          }
        />

        {avisoHermanas ? <Aviso variante="info">{avisoHermanas}</Aviso> : null}

        <Tabla>
          <TablaCabecera>
            <tr>
              <TablaCeldaCabecera>#</TablaCeldaCabecera>
              <TablaCeldaCabecera>Perfil</TablaCeldaCabecera>
              <TablaCeldaCabecera>PIN</TablaCeldaCabecera>
              <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
              <TablaCeldaCabecera>Ocupada hasta</TablaCeldaCabecera>
              <TablaCeldaCabecera></TablaCeldaCabecera>
            </tr>
          </TablaCabecera>
          <TablaCuerpo>
            {pantallas.map((pantalla) => {
              const pin = credenciales?.pantallas.find((p) => p.id === pantalla.id)?.pin ?? null;
              const enEdicion = editandoPantallaId === pantalla.id;
              return (
                <TablaFila key={pantalla.id}>
                  <TablaCelda className="align-top">#{pantalla.numero}</TablaCelda>
                  <TablaCelda className="align-top">
                    {enEdicion ? (
                      <EntradaCampo
                        value={perfilEdicion}
                        onChange={(e) => setPerfilEdicion(e.target.value)}
                        className="h-8 w-16"
                      />
                    ) : (
                      pantalla.perfil ?? "—"
                    )}
                  </TablaCelda>
                  <TablaCelda className="align-top">
                    {enEdicion ? (
                      <EntradaCampo
                        value={pinEdicion}
                        inputMode="numeric"
                        pattern={PIN_PATRON}
                        minLength={PIN_LONGITUD_MIN}
                        maxLength={PIN_LONGITUD_MAX}
                        onChange={(e) => setPinEdicion(e.target.value)}
                        className="h-8 w-20"
                        placeholder={credenciales ? "" : "••••"}
                        title={credenciales ? `${PIN_LONGITUD_MIN} a ${PIN_LONGITUD_MAX} dígitos.` : "Déjalo vacío para mantener el actual"}
                      />
                    ) : credenciales ? (
                      pin ?? "—"
                    ) : (
                      "••••"
                    )}
                  </TablaCelda>
                  <TablaCelda className="align-top">
                    <PastillaEstado estado={estadoPantalla(pantalla)} />
                  </TablaCelda>
                  <TablaCelda className="align-top text-ink-muted">
                    {pantalla.ocupadaHasta ? formatearFecha(pantalla.ocupadaHasta) : "—"}
                  </TablaCelda>
                  <TablaCelda className="align-top">
                    {enEdicion ? (
                      <div className="flex justify-end gap-2">
                        <Boton variante="principal" tamano="sm" onClick={() => guardarPantalla(pantalla.id)}>
                          Guardar
                        </Boton>
                        <Boton variante="contorno" tamano="sm" onClick={cancelarEdicionPantalla}>
                          Cancelar
                        </Boton>
                      </div>
                    ) : (
                      <div className="flex justify-end">
                        <Boton variante="contorno" tamano="sm" onClick={() => empezarEdicionPantalla(pantalla)}>
                          <Pencil />
                          Editar
                        </Boton>
                      </div>
                    )}
                  </TablaCelda>
                </TablaFila>
              );
            })}
          </TablaCuerpo>
        </Tabla>
      </Tarjeta>

      <Dialogo
        abierto={confirmandoEstado !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmandoEstado(null)}
        titulo={
          confirmandoEstado === "activar"
            ? `Activar la cuenta "${identificadorCuenta(cuenta)}"`
            : `Desactivar la cuenta "${identificadorCuenta(cuenta)}"`
        }
        descripcion={confirmandoEstado === "desactivar" ? "Sus pantallas quedan desactivadas también." : undefined}
        textoConfirmar={confirmandoEstado === "activar" ? "Activar" : "Desactivar"}
        confirmando={procesandoEstado}
        onConfirmar={confirmarCambioEstado}
      />

      <Dialogo
        abierto={confirmandoPantallaVendida !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmandoPantallaVendida(null)}
        titulo="Esta pantalla está vendida"
        descripcion={
          confirmandoPantallaVendida
            ? confirmandoPantallaVendida.codigosCompraAfectados.length > 0
              ? `${confirmandoPantallaVendida.mensaje} Código(s) de compra afectados: ${confirmandoPantallaVendida.codigosCompraAfectados.join(", ")}.`
              : confirmandoPantallaVendida.mensaje
            : undefined
        }
        textoConfirmar="Cambiar de todos modos"
        confirmando={confirmandoPantallaVendidaEnvio}
        onConfirmar={confirmarCambioPantallaVendida}
      />
    </div>
  );
}
