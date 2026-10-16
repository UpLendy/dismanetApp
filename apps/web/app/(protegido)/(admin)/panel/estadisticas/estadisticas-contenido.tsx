"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Receipt, MonitorPlay, Wallet, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { contarCostosFaltantes, type CostosFaltantes } from "@/lib/costo-cero";
import { AvisoCostoFaltante } from "@/components/aviso-costo-faltante";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { TileDato } from "@/components/ui/tile-dato";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo } from "@/components/ui/campo";
import { CargandoTiles, CargandoTarjeta } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

type Preset = "hoy" | "semana" | "mes" | "mes_anterior";

const ETIQUETA_PRESET: Record<Preset, string> = {
  hoy: "Hoy",
  semana: "Esta semana",
  mes: "Este mes",
  mes_anterior: "Mes anterior",
};

interface Resumen {
  numeroVentas: number;
  unidadesEntregadas: number;
  ingresos: string;
  costos: string;
  utilidad: string;
  descuentosOtorgados: string;
  recargosAplicados: string;
  perdidaGarantias: string;
  ventasSinCostoRegistrado: number;
}

interface SegmentoTipo {
  clave: string;
  etiqueta: string;
  numeroVentas: number;
  unidades: number;
  ingresos: string;
  costos: string;
  utilidad: string;
}

interface SegmentoPaquete {
  paqueteId: string;
  nombre: string;
  numeroVentas: number;
  unidades: number;
  ingresos: string;
  costos: string;
  utilidad: string;
}

interface SegmentoVendedor {
  vendedorId: string;
  nombre: string;
  numeroVentas: number;
  unidades: number;
  ingresos: string;
  costos: string;
  utilidad: string;
  descuentosOtorgados: string;
}

interface SegmentoPlataforma {
  plataformaId: string;
  nombre: string;
  unidades: number;
  ingresoAtribuible: string;
  costoAtribuible: string;
  renglonesSinIngresoAtribuible: number;
  renglonesSinCostoAtribuible: number;
  perdidaGarantias: string;
}

interface Estadisticas {
  periodo: { desde: string; hasta: string };
  resumen: Resumen;
  porTipo: SegmentoTipo[];
  porPaquete: SegmentoPaquete[];
  porVendedor: SegmentoVendedor[];
  porPlataforma: SegmentoPlataforma[];
}

// Igual que en dashboard-cliente.tsx/ventas-contenido.tsx (CLAUDE.md: Decimal
// como string, nunca Number para dinero).
function formatearPesos(valor: string): string {
  const negativo = valor.startsWith("-");
  const [entero] = (negativo ? valor.slice(1) : valor).split(".");
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}$${conMiles}`;
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium" });
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

export default function EstadisticasContenido() {
  const [preset, setPreset] = useState<Preset>("mes");
  const [rangoLibre, setRangoLibre] = useState({ desde: "", hasta: "" });

  const [datos, setDatos] = useState<Estadisticas | null>(null);
  const [costosFaltantes, setCostosFaltantes] = useState<CostosFaltantes | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);

    const query = rangoLibre.desde && rangoLibre.hasta ? { desde: rangoLibre.desde, hasta: rangoLibre.hasta } : { preset };

    const [respuesta, costosFaltantesCargados] = await Promise.all([
      api.ventas.estadisticas.get({ query }),
      contarCostosFaltantes(),
    ]);

    if (respuesta.error || !respuesta.data) {
      setCargando(false);
      setError(mensajeDeError(respuesta.error));
      return;
    }

    setDatos(respuesta.data as Estadisticas);
    setCostosFaltantes(costosFaltantesCargados);
    setCargando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, rangoLibre.desde, rangoLibre.hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function elegirPreset(nuevoPreset: Preset) {
    setRangoLibre({ desde: "", hasta: "" });
    setPreset(nuevoPreset);
  }

  const resumen = datos?.resumen ?? null;
  const hayCostosSinRegistrar = (resumen?.ventasSinCostoRegistrado ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina text-ink">Estadísticas</h1>
        <p className="cuerpo text-ink-muted">
          Qué se vendió, de qué, quién lo vendió y cuánto se ganó, en el periodo elegido.
        </p>
      </div>

      <Tarjeta>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ETIQUETA_PRESET) as Preset[]).map((clave) => (
              <Boton
                key={clave}
                type="button"
                variante={preset === clave && !rangoLibre.desde ? "secundario" : "contorno"}
                tamano="sm"
                onClick={() => elegirPreset(clave)}
              >
                {ETIQUETA_PRESET[clave]}
              </Boton>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Campo etiqueta="Desde">
              {(p) => (
                <EntradaCampo
                  {...p}
                  type="date"
                  value={rangoLibre.desde}
                  onChange={(e) => setRangoLibre((previo) => ({ ...previo, desde: e.target.value }))}
                />
              )}
            </Campo>
            <Campo etiqueta="Hasta">
              {(p) => (
                <EntradaCampo
                  {...p}
                  type="date"
                  value={rangoLibre.hasta}
                  onChange={(e) => setRangoLibre((previo) => ({ ...previo, hasta: e.target.value }))}
                />
              )}
            </Campo>
          </div>
        </div>
        {datos ? (
          <p className="mt-3 text-xs text-ink-muted">
            Periodo: {formatearFecha(datos.periodo.desde)} – {formatearFecha(datos.periodo.hasta)}
          </p>
        ) : null}
      </Tarjeta>

      {error ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar las estadísticas"
          accion={
            <Boton variante="contorno" onClick={cargar}>
              <RefreshCw />
              Reintentar
            </Boton>
          }
        >
          {error}
        </Aviso>
      ) : (
        <>
          <AvisoCostoFaltante datos={costosFaltantes} />
          {hayCostosSinRegistrar ? (
            <Aviso variante="aviso" titulo="Hay ventas de este periodo sin costo registrado">
              {resumen?.ventasSinCostoRegistrado} venta(s) tienen al menos un renglón sin costo: la utilidad de este
              periodo no suma ese costo, no lo cuenta como cero.
            </Aviso>
          ) : null}

          {cargando ? (
            <CargandoTiles cantidad={4} />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <TileDato etiqueta="Ventas" valor={resumen?.numeroVentas ?? 0} icono={Receipt} />
              <TileDato etiqueta="Unidades entregadas" valor={resumen?.unidadesEntregadas ?? 0} icono={MonitorPlay} />
              <TileDato etiqueta="Ingresos" valor={formatearPesos(resumen?.ingresos ?? "0")} icono={Wallet} />
              <TileDato
                etiqueta="Utilidad"
                valor={formatearPesos(resumen?.utilidad ?? "0")}
                icono={TrendingUp}
                subInfo={
                  resumen && Number(resumen.perdidaGarantias) > 0
                    ? `Incluye pérdida por garantías: ${formatearPesos(resumen.perdidaGarantias)}`
                    : undefined
                }
              />
            </div>
          )}

          {cargando ? (
            <CargandoTiles cantidad={3} />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <TileDato etiqueta="Costos" valor={formatearPesos(resumen?.costos ?? "0")} />
              <TileDato etiqueta="Descuentos otorgados" valor={formatearPesos(resumen?.descuentosOtorgados ?? "0")} />
              <TileDato etiqueta="Recargos aplicados" valor={formatearPesos(resumen?.recargosAplicados ?? "0")} />
            </div>
          )}

          {cargando ? (
            <>
              <CargandoTarjeta />
              <CargandoTarjeta />
              <CargandoTarjeta />
              <CargandoTarjeta />
            </>
          ) : (
            <>
              <Tarjeta>
                <TarjetaCabecera titulo="Por tipo de venta" />
                <p className="mb-3 text-xs text-ink-muted">Unidades, ingreso y costo: completos, sin excepciones.</p>
                <Tabla>
                  <TablaCabecera>
                    <tr>
                      <TablaCeldaCabecera>Tipo</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Ventas</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Unidades</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Ingresos</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Costos</TablaCeldaCabecera>
                      <TablaCeldaCabecera className="text-right">Utilidad</TablaCeldaCabecera>
                    </tr>
                  </TablaCabecera>
                  <TablaCuerpo>
                    {datos!.porTipo.map((fila) => (
                      <TablaFila key={fila.clave}>
                        <TablaCelda className="font-medium text-ink">{fila.etiqueta}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{fila.numeroVentas}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{fila.unidades}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.ingresos)}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums text-ink-muted">{formatearPesos(fila.costos)}</TablaCelda>
                        <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.utilidad)}</TablaCelda>
                      </TablaFila>
                    ))}
                  </TablaCuerpo>
                </Tabla>
              </Tarjeta>

              <Tarjeta>
                <TarjetaCabecera titulo="Por paquete" />
                <p className="mb-3 text-xs text-ink-muted">
                  Unidades, ingreso y costo: completos. Solo paquetes vendidos en el periodo.
                </p>
                {datos!.porPaquete.length === 0 ? (
                  <p className="cuerpo py-4 text-center text-ink-muted">Sin ventas de paquete en este periodo.</p>
                ) : (
                  <Tabla>
                    <TablaCabecera>
                      <tr>
                        <TablaCeldaCabecera>Paquete</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Ventas</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Unidades</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Ingresos</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Costos</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Utilidad</TablaCeldaCabecera>
                      </tr>
                    </TablaCabecera>
                    <TablaCuerpo>
                      {datos!.porPaquete.map((fila) => (
                        <TablaFila key={fila.paqueteId}>
                          <TablaCelda className="font-medium text-ink">{fila.nombre}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums">{fila.numeroVentas}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums">{fila.unidades}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.ingresos)}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums text-ink-muted">{formatearPesos(fila.costos)}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.utilidad)}</TablaCelda>
                        </TablaFila>
                      ))}
                    </TablaCuerpo>
                  </Tabla>
                )}
              </Tarjeta>

              <Tarjeta>
                <TarjetaCabecera titulo="Por vendedor" />
                <p className="mb-3 text-xs text-ink-muted">Unidades, ingreso y costo: completos, sin excepciones.</p>
                {datos!.porVendedor.length === 0 ? (
                  <p className="cuerpo py-4 text-center text-ink-muted">Sin ventas en este periodo.</p>
                ) : (
                  <Tabla>
                    <TablaCabecera>
                      <tr>
                        <TablaCeldaCabecera>Vendedor</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Ventas</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Unidades</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Ingresos</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Costos</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Utilidad</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Descuentos</TablaCeldaCabecera>
                      </tr>
                    </TablaCabecera>
                    <TablaCuerpo>
                      {datos!.porVendedor.map((fila) => (
                        <TablaFila key={fila.vendedorId}>
                          <TablaCelda className="font-medium text-ink">{fila.nombre}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums">{fila.numeroVentas}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums">{fila.unidades}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.ingresos)}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums text-ink-muted">{formatearPesos(fila.costos)}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.utilidad)}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums text-ink-muted">
                            {formatearPesos(fila.descuentosOtorgados)}
                          </TablaCelda>
                        </TablaFila>
                      ))}
                    </TablaCuerpo>
                  </Tabla>
                )}
              </Tarjeta>

              <Tarjeta>
                <TarjetaCabecera titulo="Por plataforma" />
                <p className="mb-3 text-xs text-ink-muted">
                  Unidades: todas las ventas del periodo. Ingreso y costo: parciales — los paquetes no siempre
                  permiten atribuir ingreso por plataforma, y las ventas sin costo registrado no entran en esa suma
                  (se cuentan aparte, no como cero).
                </p>
                {datos!.porPlataforma.length === 0 ? (
                  <p className="cuerpo py-4 text-center text-ink-muted">Sin renglones en este periodo.</p>
                ) : (
                  <Tabla>
                    <TablaCabecera>
                      <tr>
                        <TablaCeldaCabecera>Plataforma</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Unidades</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Ingreso atribuible</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Costo atribuible</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Sin ingreso</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Sin costo</TablaCeldaCabecera>
                        <TablaCeldaCabecera className="text-right">Pérdida garantías</TablaCeldaCabecera>
                      </tr>
                    </TablaCabecera>
                    <TablaCuerpo>
                      {datos!.porPlataforma.map((fila) => (
                        <TablaFila key={fila.plataformaId}>
                          <TablaCelda className="font-medium text-ink">{fila.nombre}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums">{fila.unidades}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums">{formatearPesos(fila.ingresoAtribuible)}</TablaCelda>
                          <TablaCelda className="text-right tabular-nums text-ink-muted">
                            {formatearPesos(fila.costoAtribuible)}
                          </TablaCelda>
                          <TablaCelda className="text-right tabular-nums text-ink-muted">
                            {fila.renglonesSinIngresoAtribuible}
                          </TablaCelda>
                          <TablaCelda className="text-right tabular-nums text-ink-muted">
                            {fila.renglonesSinCostoAtribuible}
                          </TablaCelda>
                          <TablaCelda className="text-right tabular-nums text-critico">
                            {Number(fila.perdidaGarantias) > 0 ? formatearPesos(fila.perdidaGarantias) : "—"}
                          </TablaCelda>
                        </TablaFila>
                      ))}
                    </TablaCuerpo>
                  </Tabla>
                )}
              </Tarjeta>
            </>
          )}
        </>
      )}
    </div>
  );
}
