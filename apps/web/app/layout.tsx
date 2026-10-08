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
    <html lang="es" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col bg-plano text-ink">{children}</body>
    </html>
  );
}
