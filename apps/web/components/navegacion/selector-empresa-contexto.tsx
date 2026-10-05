"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface SelectorEmpresaContextoValor {
  abierto: boolean;
  abrir: () => void;
  setAbierto: (abierto: boolean) => void;
}

const SelectorEmpresaContexto = createContext<SelectorEmpresaContextoValor | null>(null);

// Permite que un EstadoVacio en cualquier pantalla abra el selector de
// empresa de la barra superior, sin acoplarse al árbol de componentes del
// AppShell — ver DISENO.md "El problema": el botón del EstadoVacio y la
// pastilla de la barra superior son la misma acción.
export function SelectorEmpresaProvider({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <SelectorEmpresaContexto.Provider value={{ abierto, abrir: () => setAbierto(true), setAbierto }}>
      {children}
    </SelectorEmpresaContexto.Provider>
  );
}

export function useSelectorEmpresa() {
  const contexto = useContext(SelectorEmpresaContexto);
  if (!contexto) throw new Error("useSelectorEmpresa debe usarse dentro de SelectorEmpresaProvider");
  return contexto;
}
