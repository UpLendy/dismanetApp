import type { ComponentType } from "react";
import { ShoppingCart, Receipt, MonitorCheck, MonitorPlay, Tv, CalendarClock, CalendarDays, Clock3, Users2, Package, CircleDollarSign, UserCog, Building2, MessageSquareText, BarChart3, RotateCcw, Briefcase } from "lucide-react";
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

const RANGO: Record<Rol, number> = { VENDEDOR: 0, EMPLEADO: 1, ADMIN: 2, SUPER_ADMIN: 3 };

// Agrupación exacta de DISENO.md §3. El primer grupo no tiene encabezado;
// los demás grupos se filtran por completo, nunca se muestran deshabilitados.
// Un EMPLEADO ve además "Cuentas" (solo el botón de crear dentro de esa
// pantalla, ver cuentas/page.tsx), porque crear cuentas es parte de su
// trabajo diario.
// F6.3: "Calendario" tenía rolMinimo VENDEDOR desde F6.2 — error del
// documento original. Un VENDEDOR es un revendedor externo con saldo
// prepago, no tiene turno laboral; corregido a EMPLEADO junto con la guarda
// del backend (routes/turnos.ts) y movido a /panel/calendario para que el
// layout de (admin) bloquee a VENDEDOR en el servidor, no solo en el menú.
// "Horas adicionales" nace ya en EMPLEADO (F6.3): mismo motivo.
const GRUPOS: GrupoNav[] = [
  {
    titulo: null,
    items: [
      { etiqueta: "Vender", href: "/vender", icono: ShoppingCart, rolMinimo: "VENDEDOR", destacado: true },
      { etiqueta: "Pantallas vendidas", href: "/pantallas-vendidas", icono: MonitorCheck, rolMinimo: "EMPLEADO" },
      { etiqueta: "Ventas", href: "/ventas", icono: Receipt, rolMinimo: "VENDEDOR" },
    ],
  },
  {
    titulo: "OPERACIÓN",
    items: [
      { etiqueta: "Calendario", href: "/panel/calendario", icono: CalendarDays, rolMinimo: "EMPLEADO" },
      { etiqueta: "Horas adicionales", href: "/panel/horas-adicionales", icono: Clock3, rolMinimo: "EMPLEADO" },
      { etiqueta: "Cuentas", href: "/panel/cuentas", icono: MonitorPlay, rolMinimo: "EMPLEADO" },
      // rolMinimo en ADMIN a propósito: GET /cuentas/por-reiniciar exige
      // ADMIN (routes/cuentas.ts:342). Si ese endpoint se abre a EMPLEADO,
      // este valor cambia en la misma entrega, no antes.
      { etiqueta: "Cuentas por reiniciar", href: "/panel/cuentas/por-reiniciar", icono: RotateCcw, rolMinimo: "ADMIN" },
    ],
  },
  {
    titulo: "CONFIGURACIÓN",
    items: [
      { etiqueta: "Plataformas", href: "/panel/catalogo/plataformas", icono: Tv, rolMinimo: "ADMIN" },
      { etiqueta: "Duraciones", href: "/panel/catalogo/duraciones", icono: CalendarClock, rolMinimo: "ADMIN" },
      { etiqueta: "Tipos de cliente", href: "/panel/catalogo/tipos-cliente", icono: Users2, rolMinimo: "ADMIN" },
      { etiqueta: "Cargos", href: "/panel/catalogo/cargos", icono: Briefcase, rolMinimo: "ADMIN" },
      { etiqueta: "Paquetes", href: "/panel/catalogo/paquetes", icono: Package, rolMinimo: "ADMIN" },
      { etiqueta: "Precios", href: "/panel/precios", icono: CircleDollarSign, rolMinimo: "ADMIN" },
      { etiqueta: "Plantillas", href: "/panel/mensajes", icono: MessageSquareText, rolMinimo: "ADMIN" },
    ],
  },
  {
    titulo: "ADMINISTRACIÓN",
    items: [
      // F4.5: no está en DISENO.md §3 (anterior a esta entrega) — se agrupa
      // aquí porque el alcance es "solo ADMIN y SUPER_ADMIN", igual que
      // Usuarios, y porque la cifra financiera que muestra exige ese mismo
      // nivel de acceso.
      { etiqueta: "Estadísticas", href: "/panel/estadisticas", icono: BarChart3, rolMinimo: "ADMIN" },
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
