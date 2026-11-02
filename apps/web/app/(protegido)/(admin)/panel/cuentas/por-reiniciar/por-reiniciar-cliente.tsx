"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, MonitorPlay } from "lucide-react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { Aviso } from "@/components/ui/aviso";
import { Pastilla } from "@/components/ui/pastilla";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { CargandoTabla } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";
import { DialogoReiniciarCuenta } from "@/components/dialogo-reiniciar-cuenta";

interface CuentaPorReiniciar {
  id: string;
  plataformaId: string;
  plataformaNombre: string;
  identificador: string;
  pantallasPorReiniciar: number;
  pantallasConVentaVigente: number;
  codigosCompraAfectados: string[];
  vencioEl: string;
  esMixta: boolean;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

function formatearFecha(iso: string) {
  return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota" });
}

export default function PorReiniciarCliente() {
  const [cuentas, setCuentas] = useState<CuentaPorReiniciar[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reiniciando, setReiniciando] = useState<CuentaPorReiniciar | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error: errorRespuesta } = await api.cuentas["por-reiniciar"].get();
    setCargando(false);
    if (errorRespuesta || !data) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }
    setError(null);
    setCuentas(data.cuentas);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/panel/cuentas" className="inline-flex items-center gap-1 font-medium text-secundario hover:underline">
          <ArrowLeft className="size-4" />
          Cuentas
        </Link>
        <h1 className="titulo-pagina mt-1 text-ink">Cuentas por reiniciar</h1>
        <p className="cuerpo text-ink-muted">
          Cuentas con pantallas vencidas que no vuelven al inventario hasta que cambies la contraseña en el proveedor y
          la registres aquí.
        </p>
      </div>

      {error ? (
        <Aviso
          variante="critico"
          titulo="No se pudo cargar la lista"
          accion={
            <Boton variante="contorno" onClick={cargar}>
              Reintentar
            </Boton>
          }
        >
          {error}
        </Aviso>
      ) : cargando ? (
        <CargandoTabla filas={5} columnas={4} />
      ) : cuentas.length === 0 ? (
        <EstadoVacio
          icono={MonitorPlay}
          titulo="No hay cuentas por reiniciar"
          descripcion="Todas las pantallas vencidas ya fueron liberadas."
        />
      ) : (
        <Tabla>
          <TablaCabecera>
            <tr>
              <TablaCeldaCabecera>Cuenta</TablaCeldaCabecera>
              <TablaCeldaCabecera>Pantallas</TablaCeldaCabecera>
              <TablaCeldaCabecera>Venció el</TablaCeldaCabecera>
              <TablaCeldaCabecera></TablaCeldaCabecera>
            </tr>
          </TablaCabecera>
          <TablaCuerpo>
            {cuentas.map((cuenta) => (
              <TablaFila key={cuenta.id}>
                <TablaCelda className="font-medium text-ink">
                  {cuenta.plataformaNombre} · {cuenta.identificador}
                </TablaCelda>
                <TablaCelda className="tabular-nums">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pastilla tono="aviso" icono={RotateCcw}>
                      {cuenta.pantallasPorReiniciar} por reiniciar
                    </Pastilla>
                    {cuenta.esMixta ? (
                      <span className="text-xs text-ink-muted">
                        {cuenta.pantallasConVentaVigente} con venta vigente (código
                        {cuenta.codigosCompraAfectados.length > 1 ? "s" : ""}: {cuenta.codigosCompraAfectados.join(", ")})
                      </span>
                    ) : null}
                  </div>
                </TablaCelda>
                <TablaCelda className="text-ink-muted">{formatearFecha(cuenta.vencioEl)}</TablaCelda>
                <TablaCelda>
                  <div className="flex justify-end">
                    <Boton variante="principal" tamano="sm" onClick={() => setReiniciando(cuenta)}>
                      <RotateCcw />
                      Reiniciar
                    </Boton>
                  </div>
                </TablaCelda>
              </TablaFila>
            ))}
          </TablaCuerpo>
        </Tabla>
      )}

      <DialogoReiniciarCuenta
        cuenta={reiniciando ? { id: reiniciando.id, identificador: `${reiniciando.plataformaNombre} · ${reiniciando.identificador}` } : null}
        abierto={reiniciando !== null}
        onCambiarAbierto={(abierto) => !abierto && setReiniciando(null)}
        onExito={cargar}
      />
    </div>
  );
}
