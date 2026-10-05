"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { cn } from "@/lib/utils";

export function CerrarSesionBoton({ className }: { className?: string }) {
  const router = useRouter();

  async function cerrarSesion() {
    await api.auth.logout.post();
    router.push("/login");
    router.refresh();
  }

  return (
    <Boton variante="fantasma" tamano="sm" type="button" onClick={cerrarSesion} className={cn("w-full justify-start", className)}>
      <LogOut />
      Cerrar sesión
    </Boton>
  );
}
