"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { EVENTO_SALDO_ACTUALIZADO } from "@/lib/eventos";

// Solo manipulación de texto, nunca aritmética con number (CLAUDE.md).
function formatearPesos(valor: string): string {
  const [entero, decimal] = valor.split(".");
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal ? `$${conPuntos},${decimal}` : `$${conPuntos}`;
}

// SaldoBarraSuperior — el saldo propio del revendedor, visible siempre en la
// barra superior (DISENO.md). Un empleado (usaSaldo=false) no ve nada: ni un
// saldo en cero, ni un indicador deshabilitado — el componente no renderiza.
// Escucha EVENTO_SALDO_ACTUALIZADO para refrescarse tras una venta contra
// saldo en /vender, sin necesidad de recargar la página.
export function SaldoBarraSuperior() {
  const [saldo, setSaldo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await api.perfil.saldo.get();
    setSaldo(data?.usaSaldo && data.saldo !== null ? data.saldo : null);
  }, []);

  useEffect(() => {
    cargar();
    window.addEventListener(EVENTO_SALDO_ACTUALIZADO, cargar);
    return () => window.removeEventListener(EVENTO_SALDO_ACTUALIZADO, cargar);
  }, [cargar]);

  if (saldo === null) return null;

  return (
    <Link
      href="/perfil"
      className="flex items-center gap-1.5 rounded-pastilla border border-borde bg-primario-suave px-3 py-1.5 text-sm font-medium text-primario-texto transition-colors hover:brightness-95"
    >
      <Wallet className="size-4" />
      <span className="tabular-nums">{formatearPesos(saldo)}</span>
    </Link>
  );
}
