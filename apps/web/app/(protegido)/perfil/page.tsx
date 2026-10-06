"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { CargandoTabla } from "@/components/ui/cargando";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";

interface UsuarioPerfil {
  id: string;
  nombre: string;
  email: string;
  rol: "VENDEDOR" | "ADMIN" | "SUPER_ADMIN";
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

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

  useEffect(() => {
    (async () => {
      setCargando(true);
      setErrorCarga(null);
      const { data, error: errorRespuesta } = await api.perfil.get();
      setCargando(false);

      if (errorRespuesta || !data) {
        setErrorCarga(mensajeDeError(errorRespuesta));
        return;
      }

      setUsuario(data.usuario);
      setNombre(data.usuario.nombre);
      setEmail(data.usuario.email);
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
