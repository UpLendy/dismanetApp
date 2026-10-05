"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface PuntoGrafico {
  etiqueta: string;
  monto: number;
  numeroVentas: number;
}

function formatearMonto(monto: number): string {
  return `$${Math.round(monto).toLocaleString("es-CO")}`;
}

// GraficoBarras — DISENO.md §5. Barras verticales, serie única, color
// --secundario, nunca el rojo de marca. Dibujado a mano con SVG en línea:
// siete barras no justifican una librería. Nunca una segunda escala
// vertical en este componente.
function GraficoBarras({ datos, titulo }: { datos: PuntoGrafico[]; titulo: string }) {
  const [activo, setActivo] = React.useState<number | null>(null);

  const sinDatos = datos.length === 0 || datos.every((d) => d.monto === 0 && d.numeroVentas === 0);

  return (
    <div className="space-y-3">
      <p className="titulo-tarjeta text-ink">{titulo}</p>
      {sinDatos ? (
        <div className="flex h-48 items-center justify-center rounded-control border border-dashed border-borde">
          <p className="cuerpo text-ink-muted">Aún no hay ventas en este periodo.</p>
        </div>
      ) : (
        <>
          <div className="relative h-48">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
              {[25, 50, 75].map((y) => (
                <line key={y} x1={0} x2={100} y1={y} y2={y} stroke="var(--borde)" strokeWidth={0.5} />
              ))}
              <line x1={0} x2={100} y1={92} y2={92} stroke="var(--ink-muted)" strokeOpacity={0.4} strokeWidth={0.6} />
              {datos.map((d, i) => {
                const max = Math.max(...datos.map((p) => p.monto), 1);
                const anchoBarra = 100 / datos.length;
                const relleno = anchoBarra * 0.3;
                const alturaPct = (d.monto / max) * 85;
                const x = i * anchoBarra + relleno / 2;
                const ancho = anchoBarra - relleno;
                const y = 92 - alturaPct;
                return (
                  <rect
                    key={i}
                    x={x}
                    y={y}
                    width={ancho}
                    height={Math.max(alturaPct, 0.6)}
                    rx={1.2}
                    className={cn("fill-secundario transition-opacity", activo !== null && activo !== i && "opacity-40")}
                  />
                );
              })}
            </svg>
            <div className="absolute inset-0 flex">
              {datos.map((d, i) => {
                const max = Math.max(...datos.map((p) => p.monto), 1);
                const alturaPct = (d.monto / max) * 85;
                return (
                  <button
                    key={i}
                    type="button"
                    className="relative flex-1 cursor-default"
                    onMouseEnter={() => setActivo(i)}
                    onMouseLeave={() => setActivo(null)}
                    onFocus={() => setActivo(i)}
                    onBlur={() => setActivo(null)}
                    aria-label={`${d.etiqueta}: ${d.numeroVentas} venta(s), ${formatearMonto(d.monto)}`}
                  >
                    {activo === i ? (
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-control border border-borde bg-superficie px-2.5 py-1.5 text-xs shadow-tarjeta"
                        style={{ bottom: `calc(${Math.max(alturaPct, 0.6)}% + 8px)` }}
                      >
                        <span className="block font-semibold text-ink">{d.etiqueta}</span>
                        <span className="block text-ink-2 tabular-nums">
                          {d.numeroVentas} venta(s) · {formatearMonto(d.monto)}
                        </span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex text-xs text-ink-muted tabular-nums">
            {datos.map((d, i) => (
              <span key={i} className="flex-1 text-center">
                {d.etiqueta}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export { GraficoBarras };
