"use client";

import { useEffect, useMemo, useState } from "react";
import { PiggyBank, Clock, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { hoyBogotaISO, sumarDiasISO, etiquetaDiaBogota } from "@/lib/bogota";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { Esqueleto } from "@/components/ui/cargando";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { Pastilla } from "@/components/ui/pastilla";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

interface FilaDiaPropia {
  dia: string;
  cerrado: boolean;
  horas: number;
  tajada: string;
}

interface MisComisiones {
  configurada: boolean;
  totalCerrado: string;
  provisional: { dia: string; horas: number; tajada: string } | null;
  porDia: FilaDiaPropia[];
}

// Igual que en comisiones-cliente.tsx (CLAUDE.md: Decimal como string, nunca
// Number para dinero).
function formatearPesos(valor: string): string {
  const negativo = valor.startsWith("-");
  const [entero] = (negativo ? valor.slice(1) : valor).split(".");
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}$${conMiles}`;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

/**
 * Vista de EMPLEADO (PROMPT-F6.6, Parte 7): su propia tajada, nunca el pozo
 * total ni el precio de venta — con modo porcentaje esos dos números
 * permitirían despejar la cifra ajena. La API ya recorta por usuario
 * (routes/comisiones.ts, respuestaMias): esta pantalla solo la muestra.
 */
export function MisComisionesCliente() {
  const hoy = useMemo(() => hoyBogotaISO(), []);
  const [desde, setDesde] = useState(() => sumarDiasISO(hoy, -30));
  const [hasta, setHasta] = useState(hoy);

  const [datos, setDatos] = useState<MisComisiones | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    (async () => {
      setCargando(true);
      setError(null);
      const { data, error: err } = await api.comisiones.mias.get({ query: { desde, hasta } });
      if (!activo) return;
      if (err || !data) {
        setError(mensajeDeError(err));
        setDatos(null);
      } else {
        setDatos(data);
      }
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [desde, hasta]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina text-ink">Mis comisiones</h1>
        <p className="cuerpo text-ink-muted">Lo que te corresponde por tus turnos en el período elegido.</p>
      </div>

      <Tarjeta>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Desde">
            {(p) => <EntradaCampo {...p} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />}
          </Campo>
          <Campo etiqueta="Hasta">
            {(p) => <EntradaCampo {...p} type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />}
          </Campo>
        </div>
      </Tarjeta>

      {error ? <Aviso variante="critico">{error}</Aviso> : null}

      {cargando ? (
        <Esqueleto className="h-24 w-full" />
      ) : !datos?.configurada ? (
        <EstadoVacio icono={PiggyBank} titulo="Todavía no hay una política de comisiones configurada" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Tarjeta>
              <TarjetaCabecera titulo="Total cerrado" />
              <p className="text-3xl font-semibold text-ink">{formatearPesos(datos.totalCerrado)}</p>
              <p className="cuerpo text-ink-muted">Definitivo: no cambia aunque haya ventas nuevas.</p>
            </Tarjeta>

            <Tarjeta>
              <TarjetaCabecera
                titulo="Hoy"
                accion={
                  <Pastilla tono="aviso" icono={Clock}>
                    Provisional
                  </Pastilla>
                }
              />
              {datos.provisional ? (
                <>
                  <p className="text-3xl font-semibold text-ink">{formatearPesos(datos.provisional.tajada)}</p>
                  <p className="cuerpo text-ink-muted">
                    Puede bajar si alguien más entra de turno hoy — se cierra al terminar el día.
                  </p>
                </>
              ) : (
                <p className="cuerpo text-ink-muted">Sin tajada provisional hoy.</p>
              )}
            </Tarjeta>
          </div>

          {datos.porDia.length === 0 ? (
            <EstadoVacio icono={PiggyBank} titulo="Sin turnos con comisión en el rango elegido" />
          ) : (
            <Tabla>
              <TablaCabecera>
                <TablaFila>
                  <TablaCeldaCabecera>Día</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
                  <TablaCeldaCabecera className="text-right">Horas</TablaCeldaCabecera>
                  <TablaCeldaCabecera className="text-right">Tajada</TablaCeldaCabecera>
                </TablaFila>
              </TablaCabecera>
              <TablaCuerpo>
                {datos.porDia.map((fila) => (
                  <TablaFila key={fila.dia}>
                    <TablaCelda>{etiquetaDiaBogota(fila.dia)}</TablaCelda>
                    <TablaCelda>
                      {fila.cerrado ? (
                        <Pastilla tono="secundario" icono={CheckCircle2}>
                          Cerrado
                        </Pastilla>
                      ) : (
                        <Pastilla tono="aviso" icono={Clock}>
                          Provisional
                        </Pastilla>
                      )}
                    </TablaCelda>
                    <TablaCelda className="text-right tabular-nums">{fila.horas.toFixed(1)}</TablaCelda>
                    <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.tajada)}</TablaCelda>
                  </TablaFila>
                ))}
              </TablaCuerpo>
            </Tabla>
          )}
        </>
      )}
    </div>
  );
}
