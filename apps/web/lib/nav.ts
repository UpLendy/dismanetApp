import type { ComponentType } from "react";
import { ShoppingCart, Receipt, MonitorPlay, Tv, CalendarClock, Users2, Package, CircleDollarSign, UserCog, Building2, MessageSquareText } from "lucide-react";
import type { Rol } from "@/lib/rol";

export interface ItemNav {
  etiqueta: string;
  href: string;
  icono: ComponentType<{ className?: string }>;
  rolMinimo: Rol;
  destacado?: boolean;
}

export interface GrupoNav {
  titulo: string | null;
  items: ItemNav[];
}

const RANGO: Record<Rol, number> = { VENDEDOR: 0, ADMIN: 1, SUPER_ADMIN: 2 };

// Agrupación exacta de DISENO.md §3. El primer grupo no tiene encabezado y
// es lo único que un VENDEDOR ve — los demás grupos se filtran por completo,
// nunca se muestran deshabilitados.
const GRUPOS: GrupoNav[] = [
  {
    titulo: null,
    items: [
      { etiqueta: "Vender", href: "/vender", icono: ShoppingCart, rolMinimo: "VENDEDOR", destacado: true },
      { etiqueta: "Ventas", href: "/ventas", icono: Receipt, rolMinimo: "VENDEDOR" },
    ],
  },
  {
    titulo: "OPERACIÓN",
    items: [{ etiqueta: "Cuentas", href: "/panel/cuentas", icono: MonitorPlay, rolMinimo: "ADMIN" }],
  },
  {
    titulo: "CONFIGURACIÓN",
    items: [
      { etiqueta: "Plataformas", href: "/panel/catalogo/plataformas", icono: Tv, rolMinimo: "ADMIN" },
      { etiqueta: "Duraciones", href: "/panel/catalogo/duraciones", icono: CalendarClock, rolMinimo: "ADMIN" },
      { etiqueta: "Tipos de cliente", href: "/panel/catalogo/tipos-cliente", icono: Users2, rolMinimo: "ADMIN" },
      { etiqueta: "Paquetes", href: "/panel/catalogo/paquetes", icono: Package, rolMinimo: "ADMIN" },
      { etiqueta: "Precios", href: "/panel/precios", icono: CircleDollarSign, rolMinimo: "ADMIN" },
      { etiqueta: "Plantillas", href: "/panel/mensajes", icono: MessageSquareText, rolMinimo: "ADMIN" },
    ],
  },
  {
    titulo: "ADMINISTRACIÓN",
    items: [
      { etiqueta: "Usuarios", href: "/panel/usuarios", icono: UserCog, rolMinimo: "ADMIN" },
      // Empresas: SUPER_ADMIN ve el listado completo y puede crear.
      // Ocultamos la ruta completamente para ADMIN.
      { etiqueta: "Empresas", href: "/panel/empresas", icono: Building2, rolMinimo: "SUPER_ADMIN" },
    ],
  },
];

export function gruposParaRol(rol: Rol): GrupoNav[] {
  return GRUPOS.map((grupo) => ({
    ...grupo,
    items: grupo.items.filter((item) => RANGO[rol] >= RANGO[item.rolMinimo]),
  })).filter((grupo) => grupo.items.length > 0);
}
