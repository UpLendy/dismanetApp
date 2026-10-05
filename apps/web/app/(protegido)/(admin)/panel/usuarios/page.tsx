"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Plus, Ban, RotateCcw, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { PastillaEstado, Pastilla } from "@/components/ui/pastilla";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Dialogo } from "@/components/ui/dialogo";
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
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

export default function PaginaUsuarios() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [panelAbierto, setPanelAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<Rol>("VENDEDOR");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorFila, setErrorFila] = useState<string | null>(null);

  const [confirmandoDesactivar, setConfirmandoDesactivar] = useState<Usuario | null>(null);
  const [desactivando, setDesactivando] = useState(false);

  async function cargarUsuarios() {
    setCargandoLista(true);
    const { data, error: errorRespuesta } = await api.usuarios.get();
    setCargandoLista(false);
    if (errorRespuesta || !data) {
      setErrorLista(mensajeDeError(errorRespuesta));
      return;
    }
    setErrorLista(null);
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
    setError(null);
    setGuardando(true);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Usuarios</h1>
          <p className="cuerpo text-ink-muted">
            Gestión de los usuarios de tu empresa. Un ADMIN no puede desactivarse ni cambiar su propio rol, ni dejar
            la empresa sin ningún ADMIN activo.
          </p>
        </div>
        <Boton variante="principal" onClick={abrirCrear}>
          <Plus />
          Nuevo usuario
        </Boton>
      </div>

      {errorFila ? <Aviso variante="critico">{errorFila}</Aviso> : null}

      {errorLista ? (
        <Aviso variante="critico" titulo="No se pudo cargar los usuarios" accion={<Boton variante="contorno" onClick={cargarUsuarios}>Reintentar</Boton>}>
          {errorLista}
        </Aviso>
      ) : cargandoLista ? (
        <CargandoTabla filas={5} columnas={5} />
      ) : usuarios.length === 0 ? (
        <EstadoVacio
          icono={UserRound}
          titulo="No hay usuarios"
          descripcion="Crea el primer usuario de tu empresa."
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
              <TablaCeldaCabecera>Nombre</TablaCeldaCabecera>
              <TablaCeldaCabecera>Correo</TablaCeldaCabecera>
              <TablaCeldaCabecera>Rol</TablaCeldaCabecera>
              <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
              <TablaCeldaCabecera></TablaCeldaCabecera>
            </tr>
          </TablaCabecera>
          <TablaCuerpo>
            {usuarios.map((usuario) => (
              <TablaFila key={usuario.id}>
                <TablaCelda className="font-medium text-ink">{usuario.nombre}</TablaCelda>
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
                  <div className="flex justify-end gap-2">
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

      <Dialogo
        abierto={confirmandoDesactivar !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmandoDesactivar(null)}
        titulo={`Desactivar a "${confirmandoDesactivar?.nombre}"`}
        descripcion="Pierde acceso a la plataforma hasta que se reactive."
        textoConfirmar="Desactivar"
        confirmando={desactivando}
        onConfirmar={confirmarDesactivar}
      />
    </div>
  );
}
