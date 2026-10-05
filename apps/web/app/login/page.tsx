"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { inicioParaRol } from "@/lib/rol";

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
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={enviar} className="w-full max-w-sm space-y-4 rounded-lg border p-6">
        <div>
          <h1 className="text-xl font-semibold">Iniciar sesión</h1>
          <p className="text-sm text-muted-foreground">Sistema Interno de Gestión</p>
        </div>

        {error ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            Correo
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(evento) => setEmail(evento.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(evento) => setPassword(evento.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400"
          />
        </div>

        <button
          type="submit"
          disabled={cargando}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {cargando ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </main>
  );
}
