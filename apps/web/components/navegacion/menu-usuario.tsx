"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { ChevronDown, LogOut, User } from "lucide-react";
import { api } from "@/lib/api";
import type { Rol } from "@/lib/rol";

// MenuUsuario — punto de entrada único a /perfil y a cerrar sesión, agrupados
// bajo la identidad del usuario en la barra superior (mismo patrón Popover
// que SelectorEmpresa).
export function MenuUsuario({ usuario }: { usuario: { nombre: string; email: string; rol: Rol } }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);

  async function cerrarSesion() {
    setCerrandoSesion(true);
    await api.auth.logout.post();
    router.push("/login");
    router.refresh();
  }

  return (
    <Popover.Root open={abierto} onOpenChange={setAbierto}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-pastilla py-1.5 pl-2 pr-2.5 text-sm text-ink transition-colors hover:bg-black/4 dark:hover:bg-white/5"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-primario-suave text-primario-texto">
            <User className="size-4" />
          </span>
          <span className="hidden text-right text-xs text-ink-muted sm:block">
            <span className="block text-ink">{usuario.email}</span>
            <span className="block">{usuario.rol}</span>
          </span>
          <ChevronDown className="size-4 text-ink-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-56 rounded-tarjeta border border-borde bg-superficie p-2 shadow-tarjeta"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium text-ink">{usuario.nombre}</p>
            <p className="truncate text-xs text-ink-muted">{usuario.email}</p>
          </div>
          <div className="my-1 border-t border-borde" />
          <Link
            href="/perfil"
            onClick={() => setAbierto(false)}
            className="flex w-full items-center gap-2 rounded-control px-2 py-2 text-left text-sm text-ink hover:bg-black/4 dark:hover:bg-white/5"
          >
            <User className="size-4" />
            Mi perfil
          </Link>
          <button
            type="button"
            disabled={cerrandoSesion}
            onClick={cerrarSesion}
            className="flex w-full items-center gap-2 rounded-control px-2 py-2 text-left text-sm text-secundario hover:bg-secundario/10 disabled:opacity-50"
          >
            <LogOut className="size-4" />
            {cerrandoSesion ? "Saliendo…" : "Cerrar sesión"}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
