"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PiggyBank, CheckCircle2, XCircle, Target, ShoppingCart, ArrowRight, Users2 } from "lucide-react";
import { api } from "@/lib/api";
import { etiquetaDiaBogota, hoyBogotaISO } from "@/lib/bogota";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { Campo, EntradaCampo, SelectCampo } from "@/components/ui/campo";
import { Boton } from "@/components/ui/boton";
import { Aviso } from "@/components/ui/aviso";
import { Esqueleto } from "@/components/ui/cargando";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { Pastilla } from "@/components/ui/pastilla";

interface FilaDiaPropia {
  dia: string;
  cerrado: boolean;
  horas: number;
  tajada: string;
}

interface Comision {
  configurada: boolean;
  totalCerrado: string;
  provisional: { dia: string; horas: number; tajada: string } | null;
  porDia: FilaDiaPropia[];
}

interface Ventas {
  numeroVentas: number;
  pantallasVendidas: number;
  totalVendido: string;
}

interface Metas {
  cumplidas: number;
  incumplidas: number;
  dias: { dia: string; cumplida: boolean }[];
}

interface VideoPendiente {
  archivoId: string;
  duracionSegundos: number | null;
  segundosVistos: number;
  cobertura: number;
  completado: boolean;
}

interface InstruccionPendiente {
  id: string;
  titulo: string;
  semanaInicio: string;
  videos: VideoPendiente[];
}

interface Pendientes {
  reporteSemanalPendiente: boolean;
  instrucciones: InstruccionPendiente[];
}

interface PanelEmpleado {
  usuario: { id: string; nombre: string };
  rango: { desde: string; hasta: string };
  ventas: Ventas;
  comision: Comision;
  metas: Metas;
  pendientes: Pendientes;
}

interface EmpleadoSelector {
  id: string;
  nombre: string;
}

// Igual que en mis-comisiones-cliente.tsx (CLAUDE.md: Decimal como string,
// nunca Number para dinero).
function formatearPesos(valor: string): string {
  const negativo = valor.startsWith("-");
  const [entero] = (negativo ? valor.slice(1) : valor).split(".");
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}$${conMiles}`;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo cargar el panel.";
}

function primerDiaMesISO(): string {
  return `${hoyBogotaISO().slice(0, 7)}-01`;
}

function ultimoDiaMesISO(): string {
  const [anio, mes] = hoyBogotaISO().slice(0, 7).split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${hoyBogotaISO().slice(0, 7)}-${String(ultimoDia).padStart(2, "0")}`;
}

/**
 * F6.9: compone cuatro secciones que el API ya junta en una sola respuesta
 * (GET /panel-empleado). Orden de la pantalla por diseño (PROMPT Parte 4):
 * comisión y pendientes primero — es lo que el empleado necesita resolver
 * hoy — ventas y metas quedan como contexto.
 */
export function PanelEmpleadoCliente({ esAdmin }: { esAdmin: boolean }) {
  const [empleados, setEmpleados] = useState<EmpleadoSelector[]>([]);
  const [usuarioId, setUsuarioId] = useState("");
  const [desde, setDesde] = useState(primerDiaMesISO());
  const [hasta, setHasta] = useState(ultimoDiaMesISO());
  const [datos, setDatos] = useState<PanelEmpleado | null>(null);
  const [cargando, setCargando] = useState(!esAdmin);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!esAdmin) return;
    (async () => {
      const { data } = await api.usuarios.get();
      if (data) {
        setEmpleados(
          data.usuarios.filter((u) => u.activo && u.rol === "EMPLEADO").map((u) => ({ id: u.id, nombre: u.nombre })),
        );
      }
    })();
  }, [esAdmin]);

  useEffect(() => {
    if (esAdmin && !usuarioId) {
      setDatos(null);
      return;
    }

    let activo = true;
    (async () => {
      setCargando(true);
      setError(null);
      const { data, error: err } = usuarioId
        ? await api["panel-empleado"]({ usuarioId }).get({ query: { desde, hasta } })
        : await api["panel-empleado"].get({ query: { desde, hasta } });
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
  }, [esAdmin, usuarioId, desde, hasta]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina text-ink">Mi panel</h1>
        <p className="cuerpo text-ink-muted">Tu comisión, tus ventas, tus metas y lo que tienes pendiente.</p>
      </div>

      <Tarjeta>
        <div className="grid gap-4 sm:grid-cols-3">
          {esAdmin ? (
            <Campo etiqueta="Empleado">
              {(p) => (
                <SelectCampo {...p} value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
                  <option value="">Selecciona un empleado</option>
                  {empleados.map((empleado) => (
                    <option key={empleado.id} value={empleado.id}>
                      {empleado.nombre}
                    </option>
                  ))}
                </SelectCampo>
              )}
            </Campo>
          ) : null}
          <Campo etiqueta="Desde">
            {(p) => <EntradaCampo {...p} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />}
          </Campo>
          <Campo etiqueta="Hasta">
            {(p) => <EntradaCampo {...p} type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />}
          </Campo>
        </div>
      </Tarjeta>

      {error ? <Aviso variante="critico">{error}</Aviso> : null}

      {esAdmin && !usuarioId ? (
        <EstadoVacio icono={Users2} titulo="Selecciona un empleado para ver su panel" />
      ) : cargando ? (
        <Esqueleto className="h-64 w-full" />
      ) : !datos ? null : (
        <>
          <Tarjeta>
            <TarjetaCabecera
              titulo="Comisión"
              accion={
                !datos.comision.configurada ? null : (
                  <Pastilla tono="bien" icono={PiggyBank}>
                    {datos.usuario.nombre}
                  </Pastilla>
                )
              }
            />
            {!datos.comision.configurada ? (
              <EstadoVacio icono={PiggyBank} titulo="Todavía no hay una política de comisiones configurada" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="cuerpo text-ink-muted">Total cerrado</p>
                  <p className="text-3xl font-semibold text-ink">{formatearPesos(datos.comision.totalCerrado)}</p>
                  <p className="text-xs text-ink-muted">Definitivo: no cambia aunque haya ventas nuevas.</p>
                </div>
                <div>
                  <p className="cuerpo text-ink-muted">Hoy (provisional)</p>
                  {datos.comision.provisional ? (
                    <>
                      <p className="text-3xl font-semibold text-ink">
                        {formatearPesos(datos.comision.provisional.tajada)}
                      </p>
                      <p className="text-xs text-ink-muted">Puede bajar si alguien más entra de turno hoy.</p>
                    </>
                  ) : (
                    <p className="cuerpo text-ink-muted">Sin tajada provisional hoy.</p>
                  )}
                </div>
              </div>
            )}
          </Tarjeta>

          <Tarjeta>
            <TarjetaCabecera titulo="Pendientes" />
            <div className="space-y-3">
              {!datos.pendientes.reporteSemanalPendiente && datos.pendientes.instrucciones.length === 0 ? (
                <EstadoVacio icono={CheckCircle2} titulo="No tienes nada pendiente esta semana" />
              ) : (
                <>
                  {datos.pendientes.reporteSemanalPendiente ? (
                    <Aviso
                      variante="aviso"
                      titulo="Debes el reporte semanal de esta semana"
                      accion={
                        <Boton asChild variante="contorno" tamano="sm">
                          <Link href="/panel/reportes">
                            Completarlo <ArrowRight className="size-4" />
                          </Link>
                        </Boton>
                      }
                    />
                  ) : null}
                  {datos.pendientes.instrucciones.map((instruccion) => {
                    const totalVideos = instruccion.videos.length;
                    const videosCompletos = instruccion.videos.filter((v) => v.completado).length;
                    return (
                      <Aviso
                        key={instruccion.id}
                        variante="info"
                        titulo={instruccion.titulo}
                        accion={
                          <Boton asChild variante="contorno" tamano="sm">
                            <Link href="/panel/instrucciones">
                              Ir a instrucciones <ArrowRight className="size-4" />
                            </Link>
                          </Boton>
                        }
                      >
                        {totalVideos > 0 ? (
                          <span>
                            Video visto {videosCompletos} de {totalVideos}
                          </span>
                        ) : (
                          <span>Sin marcar como cumplida.</span>
                        )}
                      </Aviso>
                    );
                  })}
                </>
              )}
            </div>
          </Tarjeta>

          <div className="grid gap-6 lg:grid-cols-2">
            <Tarjeta>
              <TarjetaCabecera titulo="Ventas realizadas" accion={<ShoppingCart className="size-4 text-ink-muted" />} />
              {datos.ventas.numeroVentas === 0 ? (
                <EstadoVacio icono={ShoppingCart} titulo="Sin ventas en el rango elegido" />
              ) : (
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-2xl font-semibold text-ink">{datos.ventas.numeroVentas}</p>
                    <p className="text-xs text-ink-muted">Ventas</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-ink">{datos.ventas.pantallasVendidas}</p>
                    <p className="text-xs text-ink-muted">Pantallas</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-ink">{formatearPesos(datos.ventas.totalVendido)}</p>
                    <p className="text-xs text-ink-muted">Vendido</p>
                  </div>
                </div>
              )}
            </Tarjeta>

            <Tarjeta>
              <TarjetaCabecera titulo="Metas por día" accion={<Target className="size-4 text-ink-muted" />} />
              {datos.metas.dias.length === 0 ? (
                <EstadoVacio icono={Target} titulo="Sin días con turno en el rango elegido" />
              ) : (
                <>
                  <div className="mb-3 flex gap-3">
                    <Pastilla tono="bien" icono={CheckCircle2}>
                      {datos.metas.cumplidas} cumplidas
                    </Pastilla>
                    <Pastilla tono="critico" icono={XCircle}>
                      {datos.metas.incumplidas} incumplidas
                    </Pastilla>
                  </div>
                  <ul className="space-y-1.5">
                    {datos.metas.dias.map((dia) => (
                      <li key={dia.dia} className="flex items-center justify-between">
                        <span className="cuerpo text-ink">{etiquetaDiaBogota(dia.dia)}</span>
                        {dia.cumplida ? (
                          <Pastilla tono="bien" icono={CheckCircle2}>
                            Cumplida
                          </Pastilla>
                        ) : (
                          <Pastilla tono="critico" icono={XCircle}>
                            Incumplida
                          </Pastilla>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Tarjeta>
          </div>
        </>
      )}
    </div>
  );
}
