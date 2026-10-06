"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { gruposParaRol, type GrupoNav } from "@/lib/nav";
import { inicioParaRol, type Rol } from "@/lib/rol";
import { CerrarSesionBoton } from "@/components/cerrar-sesion-boton";
import { SelectorEmpresaProvider } from "@/components/navegacion/selector-empresa-contexto";
import { SelectorEmpresa } from "@/components/navegacion/selector-empresa";
import { MenuUsuario } from "@/components/navegacion/menu-usuario";
import { cn } from "@/lib/utils";

function itemActivo(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavGrupo({ grupo, pathname, onNavegar }: { grupo: GrupoNav; pathname: string; onNavegar: () => void }) {
  return (
    <div className="space-y-1">
      {grupo.titulo ? (
        <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">{grupo.titulo}</p>
      ) : null}
      {grupo.items.map((item) => {
        const activo = itemActivo(pathname, item.href);
        const Icono = item.icono;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavegar}
            aria-current={activo ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-3 rounded-control px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secundario",
              activo
                ? "bg-primario-suave font-semibold text-primario-texto"
                : cn("text-ink hover:bg-black/4 dark:hover:bg-white/5", item.destacado && "font-semibold"),
            )}
          >
            <Icono className="size-5 shrink-0" />
            {item.etiqueta}
          </Link>
        );
      })}
    </div>
  );
}

export function AppShell({
  usuario,
  empresaActiva,
  children,
}: {
  usuario: { nombre: string; email: string; rol: Rol };
  empresaActiva: { id: string; nombre: string } | null;
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const pathname = usePathname();
  const grupos = gruposParaRol(usuario.rol);
  const cerrarDrawer = () => setAbierto(false);

  return (
    <SelectorEmpresaProvider>
    <div className="min-h-screen bg-plano">
      {abierto ? (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={cerrarDrawer}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-borde bg-superficie transition-transform duration-200 lg:translate-x-0",
          abierto ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-borde px-5">
          <Link href={inicioParaRol(usuario.rol)} className="titulo-tarjeta text-ink" onClick={cerrarDrawer}>
            DISMANET
          </Link>
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={cerrarDrawer}
            className="flex size-8 items-center justify-center rounded-control text-ink-muted hover:bg-black/5 lg:hidden"
          >
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto p-3">
          {grupos.map((grupo, i) => (
            <NavGrupo key={grupo.titulo ?? `grupo-${i}`} grupo={grupo} pathname={pathname} onNavegar={cerrarDrawer} />
          ))}
        </nav>
        <div className="border-t border-borde p-3">
          <CerrarSesionBoton />
          <p className="mt-2 px-1 text-xs text-ink-muted">v1.0</p>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-60">
        <header className="flex h-auto min-h-16 flex-wrap items-center justify-between gap-2 border-b border-borde bg-superficie px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Abrir menú"
              onClick={() => setAbierto(true)}
              className="flex size-9 items-center justify-center rounded-control text-ink hover:bg-black/5 lg:hidden"
            >
              <Menu className="size-5" />
            </button>
            <div>
              <p className="text-sm font-medium text-ink">Hola, {usuario.nombre}</p>
              {empresaActiva ? <p className="text-xs text-ink-muted">{empresaActiva.nombre}</p> : null}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {usuario.rol === "SUPER_ADMIN" ? <SelectorEmpresa empresaActiva={empresaActiva} /> : null}
            <MenuUsuario usuario={usuario} />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
    </SelectorEmpresaProvider>
  );
}
