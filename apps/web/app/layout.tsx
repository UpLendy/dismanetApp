import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DISMANET — Sistema de gestión",
  description: "Sistema interno de gestión de ventas",
};

// Antes de la primera pintura: lee la preferencia guardada o usa "light" por
// defecto. La preferencia del sistema operativo no interviene (DISENO.md §7).
const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem("tema");document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: el script de arriba pone data-theme en <html>
    // ANTES de que React hidrate, así que el HTML del servidor (sin el
    // atributo) nunca coincide con el del cliente. React lo reporta como
    // desajuste de hidratación en cada carga y avisa que "no lo va a
    // parchar". Es el patrón estándar de los selectores de tema; sin esta
    // bandera el error sale en consola en todas las páginas.
    <html lang="es" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col bg-plano text-ink">{children}</body>
    </html>
  );
}
