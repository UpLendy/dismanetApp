"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { inicioParaRol } from "@/lib/rol";
import { Tarjeta } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo } from "@/components/ui/campo";
import { Boton } from "@/components/ui/boton";
import { Aviso } from "@/components/ui/aviso";

export default function PaginaLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);

    const { data, error: errorRespuesta } = await api.auth.login.post({ email, password });

    setCargando(false);

    if (errorRespuesta || !data) {
      const valor = errorRespuesta?.value as { error?: { mensaje?: string } } | undefined;
      setError(valor?.error?.mensaje ?? "No se pudo iniciar sesión.");
      return;
    }

    // Un SUPER_ADMIN puede conservar una empresa_activa de una sesión
    // anterior (logout no limpia esa cookie) — /panel no muestra nada sin
    // empresa, así que la única forma confiable de saber a dónde mandarlo
    // es preguntarle al servidor, no asumir "sin empresa" por defecto.
    if (data.usuario.rol === "SUPER_ADMIN") {
      const { data: yo } = await api.auth.yo.get();
      router.push(yo?.empresaActiva ? "/panel" : "/panel/empresas");
    } else {
      router.push(inicioParaRol(data.usuario.rol));
    }
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-plano p-6">
      <Tarjeta className="w-full max-w-sm">
        <form onSubmit={enviar} className="space-y-4">
          <div>
            <h1 className="titulo-seccion text-ink">Iniciar sesión</h1>
            <p className="cuerpo text-ink-muted">Sistema Interno de Gestión</p>
          </div>

          {error ? <Aviso variante="critico">{error}</Aviso> : null}

          <Campo etiqueta="Correo">
            {(props) => (
              <EntradaCampo
                {...props}
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(evento) => setEmail(evento.target.value)}
              />
            )}
          </Campo>

          <Campo etiqueta="Contraseña">
            {(props) => (
              <EntradaCampo
                {...props}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(evento) => setPassword(evento.target.value)}
              />
            )}
          </Campo>

          <Boton type="submit" variante="principal" disabled={cargando} className="w-full">
            {cargando ? "Ingresando…" : "Ingresar"}
          </Boton>
        </form>
      </Tarjeta>
    </main>
  );
}
