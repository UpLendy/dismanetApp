"use client";

import { useEffect, useState } from "react";
import { Popover } from "radix-ui";
import { Building2, ChevronDown, Check, LogOut, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useSelectorEmpresa } from "./selector-empresa-contexto";

interface EmpresaOpcion {
  id: string;
  nombre: string;
}

// SelectorEmpresa — único para SUPER_ADMIN (AppShell decide la visibilidad).
// Dos estados: botón de advertencia sin empresa activa, pastilla con
// nombre+chevron con empresa activa. Es la acción que desbloquea el resto
// de la aplicación, no un adorno — ver DISENO.md "El problema".
export function SelectorEmpresa({ empresaActiva }: { empresaActiva: { id: string; nombre: string } | null }) {
  const { abierto, setAbierto } = useSelectorEmpresa();
  const [empresas, setEmpresas] = useState<EmpresaOpcion[]>([]);
  const [cargando, setCargando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [entrandoId, setEntrandoId] = useState<string | null>(null);
  const [saliendo, setSaliendo] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setCargando(true);
    api.empresas.get().then(({ data }) => {
      setCargando(false);
      if (data) {
        setEmpresas(data.empresas.filter((empresa) => empresa.activa).map((empresa) => ({ id: empresa.id, nombre: empresa.nombre })));
      }
    });
  }, [abierto]);

  async function entrar(id: string) {
    setEntrandoId(id);
    await api.empresas({ id }).entrar.post();
    // Recarga completa, no router.refresh(): la vista actual obtiene sus
    // datos con fetch de cliente (useEffect), no como Server Component, así
    // que un refresh de Next no los vuelve a pedir. "Refresca los datos de
    // la vista actual" exige que de verdad se repita el fetch.
    window.location.reload();
  }

  async function salir() {
    setSaliendo(true);
    await api.empresas.salir.post();
    window.location.reload();
  }

  const filtradas = busqueda.trim()
    ? empresas.filter((empresa) => empresa.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()))
    : empresas;

  return (
    <Popover.Root
      open={abierto}
      onOpenChange={(valor) => {
        setAbierto(valor);
        if (!valor) setBusqueda("");
      }}
    >
      <Popover.Trigger asChild>
        {empresaActiva ? (
          <button
            type="button"
            className="flex items-center gap-2 rounded-pastilla bg-secundario-suave py-1.5 pl-3 pr-2 text-sm text-secundario-texto transition-colors hover:bg-secundario-suave/70"
          >
            <Building2 className="size-4" />
            <span className="font-bold">{empresaActiva.nombre}</span>
            <ChevronDown className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            className="flex items-center gap-2 rounded-pastilla bg-aviso/15 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-aviso/25"
          >
            <Building2 className="size-4 text-aviso" />
            Selecciona una empresa
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-tarjeta border border-borde bg-superficie p-2 shadow-tarjeta"
        >
          {empresas.length > 10 ? (
            <div className="relative mb-2">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-muted" />
              <input
                autoFocus
                value={busqueda}
                onChange={(evento) => setBusqueda(evento.target.value)}
                placeholder="Buscar empresa…"
                className="h-9 w-full rounded-control border border-borde bg-plano pl-8 pr-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-secundario"
              />
            </div>
          ) : null}

          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {cargando ? (
              <p className="px-2 py-3 text-sm text-ink-muted">Cargando…</p>
            ) : filtradas.length === 0 ? (
              <p className="px-2 py-3 text-sm text-ink-muted">Ninguna empresa coincide.</p>
            ) : (
              filtradas.map((empresa) => (
                <button
                  key={empresa.id}
                  type="button"
                  disabled={entrandoId !== null}
                  onClick={() => entrar(empresa.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-control px-2 py-2 text-left text-sm text-ink hover:bg-black/4 disabled:opacity-50 dark:hover:bg-white/5"
                >
                  <span className="truncate">{empresa.nombre}</span>
                  {empresaActiva?.id === empresa.id ? (
                    <Check className="size-4 shrink-0 text-secundario" />
                  ) : entrandoId === empresa.id ? (
                    <span className="text-xs text-ink-muted">Entrando…</span>
                  ) : null}
                </button>
              ))
            )}
          </div>

          {empresaActiva ? (
            <>
              <div className="my-2 border-t border-borde" />
              <button
                type="button"
                disabled={saliendo}
                onClick={salir}
                className="flex w-full items-center gap-2 rounded-control px-2 py-2 text-left text-sm text-secundario hover:bg-secundario/10 disabled:opacity-50"
              >
                <LogOut className="size-4" />
                {saliendo ? "Saliendo…" : "Salir de la empresa"}
              </button>
            </>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
