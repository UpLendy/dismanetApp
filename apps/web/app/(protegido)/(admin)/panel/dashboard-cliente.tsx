"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { es } from "date-fns/locale";
import { format, isSameDay, startOfDay, subDays } from "date-fns";
import { Receipt, Wallet, TrendingUp, MonitorPlay, ShoppingCart, CircleDollarSign, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { AVISO_COSTO_CERO_TITULO, avisoCostoCeroTexto, contarPreciosConCostoCero } from "@/lib/costo-cero";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { TileDato } from "@/components/ui/tile-dato";
import { TarjetaAcceso } from "@/components/ui/tarjeta-acceso";
import { Aviso } from "@/components/ui/aviso";
import { PastillaEstado } from "@/components/ui/pastilla";
import { Boton } from "@/components/ui/boton";
import { GraficoBarras, type PuntoGrafico } from "@/components/ui/grafico-barras";
import { CargandoTiles, CargandoTarjeta, CargandoTabla } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

interface VentaAdmin {
  id: string;
  codigoCompra: string;
  nombreItem: string;
  nombreTipoCliente: string;
  precioVenta: string;
  fechaVenta: string;
  anulada: boolean;
  vendedor: { id: string; nombre: string };
}

function formatearPesos(valor: string): string {
  const [entero, decimal] = valor.split(".");
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal ? `$${conPuntos},${decimal}` : `$${conPuntos}`;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo cargar el panel.";
}

export default function DashboardClientePanel() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [totalesHoy, setTotalesHoy] = useState<{ numeroVentas: number; ingresos: string; utilidad: string } | null>(
    null,
  );
  const [pantallasLibres, setPantallasLibres] = useState(0);
  const [costoCeroCantidad, setCostoCeroCantidad] = useState(0);
  const [ventas7Dias, setVentas7Dias] = useState<VentaAdmin[]>([]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);

    const desde = startOfDay(subDays(new Date(), 6)).toISOString();

    const [resTotales, resDisponibilidad, resListado, totalCeros] = await Promise.all([
      api.ventas.totales.get(),
      api.disponibilidad.get(),
      api.ventas.listado.get({ query: { desde } }),
      contarPreciosConCostoCero(),
    ]);

    if (resTotales.error || !resTotales.data) {
      setCargando(false);
      setError(mensajeDeError(resTotales.error));
      return;
    }
    if (resDisponibilidad.error || !resDisponibilidad.data) {
      setCargando(false);
      setError(mensajeDeError(resDisponibilidad.error));
      return;
    }
    if (resListado.error || !resListado.data) {
      setCargando(false);
      setError(mensajeDeError(resListado.error));
      return;
    }

    setTotalesHoy(resTotales.data.hoy);
    setPantallasLibres(resDisponibilidad.data.disponibilidad.reduce((acc, p) => acc + p.libres, 0));
    setVentas7Dias(resListado.data.ventas);
    setCostoCeroCantidad(totalCeros);

    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const datosGrafico: PuntoGrafico[] = Array.from({ length: 7 }, (_, i) => {
    const dia = subDays(new Date(), 6 - i);
    const ventasDelDia = ventas7Dias.filter((v) => !v.anulada && isSameDay(new Date(v.fechaVenta), dia));
    return {
      etiqueta: format(dia, "EEE d", { locale: es }),
      monto: ventasDelDia.reduce((acc, v) => acc + Number(v.precioVenta), 0),
      numeroVentas: ventasDelDia.length,
    };
  });

  const ultimasVentas = ventas7Dias.slice(0, 10);

  if (error) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-8">
        <Aviso variante="critico" titulo="No se pudo cargar el panel">
          {error}
        </Aviso>
        <Boton variante="contorno" onClick={cargar}>
          <RefreshCw />
          Reintentar
        </Boton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="titulo-pagina text-ink">Panel</h1>

      {cargando ? (
        <CargandoTiles cantidad={4} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <TileDato etiqueta="Ventas de hoy" valor={totalesHoy?.numeroVentas ?? 0} icono={Receipt} />
          <TileDato etiqueta="Ingresos de hoy" valor={formatearPesos(totalesHoy?.ingresos ?? "0")} icono={Wallet} />
          <TileDato etiqueta="Utilidad de hoy" valor={formatearPesos(totalesHoy?.utilidad ?? "0")} icono={TrendingUp} />
          <TileDato etiqueta="Pantallas disponibles" valor={pantallasLibres} icono={MonitorPlay} />
        </div>
      )}

      {!cargando && costoCeroCantidad > 0 ? (
        <Aviso variante="aviso" titulo={AVISO_COSTO_CERO_TITULO}>
          {avisoCostoCeroTexto(costoCeroCantidad)}
        </Aviso>
      ) : null}

      {cargando ? (
        <CargandoTarjeta />
      ) : (
        <Tarjeta>
          <GraficoBarras titulo="Ingresos de los últimos 7 días" datos={datosGrafico} />
        </Tarjeta>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <TarjetaAcceso href="/vender" icono={ShoppingCart} titulo="Vender" descripcion="Registrar una venta" tono="primario" />
        <TarjetaAcceso href="/panel/cuentas" icono={MonitorPlay} titulo="Cuentas" descripcion="Gestionar cuentas e inventario" />
        <TarjetaAcceso href="/panel/precios" icono={CircleDollarSign} titulo="Precios" descripcion="Editar la matriz de precios" />
      </div>

      <Tarjeta>
        <TarjetaCabecera
          titulo="Últimas ventas"
          accion={
            <Link href="/ventas" className="cuerpo font-medium text-secundario hover:underline">
              Ver todas
            </Link>
          }
        />
        {cargando ? (
          <CargandoTabla filas={5} columnas={5} />
        ) : ultimasVentas.length === 0 ? (
          <p className="cuerpo py-6 text-center text-ink-muted">Aún no hay ventas registradas.</p>
        ) : (
          <Tabla>
            <TablaCabecera>
              <tr>
                <TablaCeldaCabecera>Código</TablaCeldaCabecera>
                <TablaCeldaCabecera>Producto</TablaCeldaCabecera>
                <TablaCeldaCabecera>Vendedor</TablaCeldaCabecera>
                <TablaCeldaCabecera className="text-right">Precio</TablaCeldaCabecera>
                <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
              </tr>
            </TablaCabecera>
            <TablaCuerpo>
              {ultimasVentas.map((venta) => (
                <TablaFila key={venta.id}>
                  <TablaCelda className="font-medium text-ink">{venta.codigoCompra}</TablaCelda>
                  <TablaCelda>
                    {venta.nombreItem} · {venta.nombreTipoCliente}
                  </TablaCelda>
                  <TablaCelda>{venta.vendedor.nombre}</TablaCelda>
                  <TablaCelda className="text-right tabular-nums">{formatearPesos(venta.precioVenta)}</TablaCelda>
                  <TablaCelda>
                    <PastillaEstado estado={venta.anulada ? "anulada" : "activo"} />
                  </TablaCelda>
                </TablaFila>
              ))}
            </TablaCuerpo>
          </Tabla>
        )}
      </Tarjeta>
    </div>
  );
}
