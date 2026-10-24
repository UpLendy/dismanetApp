import type { Metadata } from "next";
import { Alexandria, Nunito_Sans } from "next/font/google";
import "./globals.css";

// F5.1 — Alexandria (titulares) y Nunito Sans (cuerpo, equivalente libre de
// Museo Sans, ver DISENO.md §2). Variables fuente: variables CSS en vez de
// clases, para que --font-sans / --font-heading (globals.css) puedan
// remapearse el día que el cliente compre Museo Sans.
const alexandria = Alexandria({
  subsets: ["latin"],
  variable: "--font-alexandria",
});

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito-sans",
});

export const metadata: Metadata = {
  title: "DISMANET — Sistema de gestión",
  description: "Sistema interno de gestión de ventas",
  icons: {
    icon: "/favicon-32.png",
    apple: "/apple-touch-icon.png",
  },
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
    <html
      lang="es"
      className={`h-full antialiased ${alexandria.variable} ${nunitoSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col bg-plano text-ink">{children}</body>
    </html>
  );
}
