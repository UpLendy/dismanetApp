"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Ban, CheckCircle2, Eye, Pencil } from "lucide-react";
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
  correo: string;
  capacidadPantallas: number;
  notas: string | null;
  activa: boolean;
  pantallasLibres: number;
  pantallasTotales: number;
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
  pantallas: { id: string; numero: number; pin: string | null }[];
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
  const [pantallas, setPantallas] = useState<Pantalla[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [notas, setNotas] = useState("");
  const [capacidadPantallas, setCapacidadPantallas] = useState("1");
  const [guardando, setGuardando] = useState(false);

  const [credenciales, setCredenciales] = useState<Credenciales | null>(null);
  const [cargandoCredenciales, setCargandoCredenciales] = useState(false);

  const [editandoPantallaId, setEditandoPantallaId] = useState<string | null>(null);
  const [perfilEdicion, setPerfilEdicion] = useState("");
  const [pinEdicion, setPinEdicion] = useState("");

  const [confirmandoEstado, setConfirmandoEstado] = useState<"activar" | "desactivar" | null>(null);
  const [procesandoEstado, setProcesandoEstado] = useState(false);

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
    setCorreo(data.cuenta.correo);
    setPassword("");
    setNotas(data.cuenta.notas ?? "");
    setCapacidadPantallas(String(data.cuenta.capacidadPantallas));
  }

  useEffect(() => {
    cargarDetalle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);

    const cuerpo = {
      correo,
      notas,
      capacidadPantallas: Number(capacidadPantallas),
      ...(password ? { password } : {}),
    };

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
  }

  function cancelarEdicionPantalla() {
    setEditandoPantallaId(null);
    setPerfilEdicion("");
    setPinEdicion("");
  }

  async function guardarPantalla(pantallaId: string) {
    setError(null);

    const cuerpo: { perfil: string | null; pin?: string | null } = {
      perfil: perfilEdicion || null,
    };

    if (pinEdicion !== "") {
      cuerpo.pin = pinEdicion;
    } else if (credenciales) {
      // Solo borramos el PIN si el admin está viendo las credenciales y dejó el campo vacío
      cuerpo.pin = null;
    }

    const { error: errorRespuesta } = await api.cuentas({ id }).pantallas({ pantallaId }).patch(cuerpo);
    if (errorRespuesta) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    cancelarEdicionPantalla();
    if (credenciales) await verCredenciales();
    cargarDetalle();
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
            <h1 className="titulo-pagina text-ink">{cuenta.correo}</h1>
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
            <Campo etiqueta="Correo" required>
              {(props) => (
                <EntradaCampo {...props} required type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
              )}
            </Campo>
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
              <span className="cuerpo text-ink-muted">Contraseña: {credenciales.password}</span>
            ) : (
              <Boton variante="contorno" tamano="sm" onClick={verCredenciales} disabled={cargandoCredenciales}>
                <Eye />
                {cargandoCredenciales ? "Cargando…" : "Ver credenciales"}
              </Boton>
            )
          }
        />

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
                        pattern="[0-9]{4}"
                        maxLength={4}
                        onChange={(e) => setPinEdicion(e.target.value)}
                        className="h-8 w-16"
                        placeholder={credenciales ? "" : "••••"}
                        title={credenciales ? "" : "Déjalo vacío para mantener el actual"}
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
          confirmandoEstado === "activar" ? `Activar la cuenta "${cuenta.correo}"` : `Desactivar la cuenta "${cuenta.correo}"`
        }
        descripcion={confirmandoEstado === "desactivar" ? "Sus pantallas quedan desactivadas también." : undefined}
        textoConfirmar={confirmandoEstado === "activar" ? "Activar" : "Desactivar"}
        confirmando={procesandoEstado}
        onConfirmar={confirmarCambioEstado}
      />
    </div>
  );
}
