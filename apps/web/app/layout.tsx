import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DISMANET — Sistema de gestión",
  description: "Sistema interno de gestión de ventas",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-plano text-ink">{children}</body>
    </html>
  );
}
