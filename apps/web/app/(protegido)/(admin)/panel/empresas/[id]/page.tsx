"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle, LogIn } from "lucide-react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { Aviso } from "@/components/ui/aviso";
import { PastillaEstado } from "@/components/ui/pastilla";
import { Tarjeta, TarjetaCabecera } from "@/components/ui/tarjeta";
import { CargandoTarjeta } from "@/components/ui/cargando";

interface Empresa {
  id: string;
  nombre: string;
  nit: string | null;
  prefijoCodigo: string;
  activa: boolean;
  usuariosActivos: number;
}

interface Diagnostico {
  plantillas: { existeUnidad: boolean; existePaquete: boolean };
  tiposClienteActivos: number;
  duracionesActivas: number;
  plataformasActivas: number;
  paquetesActivos: number;
  preciosActivos: number;
  preciosConCostoCero: number;
  cuentasActivas: number;
  pantallasActivas: number;
  pantallasLibres: number;
  puedeVender: boolean;
}

interface ItemEstado {
  etiqueta: string;
  ok: boolean;
  detalle: string;
  ruta: string;
}

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

function itemsDeEstado(diagnostico: Diagnostico): ItemEstado[] {
  return [
    {
      etiqueta: "Plantilla de mensaje — Unidad",
      ok: diagnostico.plantillas.existeUnidad,
      detalle: diagnostico.plantillas.existeUnidad ? "Configurada" : "Falta configurarla",
      ruta: "/panel/mensajes",
    },
    {
      etiqueta: "Plantilla de mensaje — Paquete",
      ok: diagnostico.plantillas.existePaquete,
      detalle: diagnostico.plantillas.existePaquete ? "Configurada" : "Falta configurarla",
      ruta: "/panel/mensajes",
    },
    {
      etiqueta: "Tipos de cliente",
      ok: diagnostico.tiposClienteActivos > 0,
      detalle: `${diagnostico.tiposClienteActivos} activos`,
      ruta: "/catalogo/tipos-cliente",
    },
    {
      etiqueta: "Duraciones",
      ok: diagnostico.duracionesActivas > 0,
      detalle: `${diagnostico.duracionesActivas} activas`,
      ruta: "/catalogo/duraciones",
    },
    {
      etiqueta: "Plataformas",
      ok: diagnostico.plataformasActivas > 0,
      detalle: `${diagnostico.plataformasActivas} activas`,
      ruta: "/catalogo/plataformas",
    },
    {
      etiqueta: "Precios",
      ok: diagnostico.preciosActivos > 0,
      detalle:
        diagnostico.preciosConCostoCero > 0
          ? `${diagnostico.preciosActivos} activos (${diagnostico.preciosConCostoCero} con costo en cero)`
          : `${diagnostico.preciosActivos} activos`,
      ruta: "/panel/precios",
    },
    {
      etiqueta: "Cuentas y pantallas",
      ok: diagnostico.cuentasActivas > 0 && diagnostico.pantallasLibres > 0,
      detalle: `${diagnostico.cuentasActivas} cuentas activas · ${diagnostico.pantallasLibres} de ${diagnostico.pantallasActivas} pantallas libres`,
      ruta: "/panel/cuentas",
    },
  ];
}

export default function PaginaDetalleEmpresa() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function cargar() {
    setCargando(true);
    setError(null);

    const [listado, diagnosticoRespuesta] = await Promise.all([api.empresas.get(), api.empresas({ id }).diagnostico.get()]);
    setCargando(false);

    if (diagnosticoRespuesta.error || !diagnosticoRespuesta.data) {
      setError(mensajeDeError(diagnosticoRespuesta.error));
      return;
    }
    setDiagnostico(diagnosticoRespuesta.data.diagnostico);
    setEmpresa(listado.data?.empresas.find((fila) => fila.id === id) ?? null);
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Las pantallas de catálogo/precios/mensajes son de la empresa activa (vía
  // cookie), no reciben el id por parámetro: para "Configurar" primero hay
  // que entrar a esta empresa, igual que el botón "Entrar" del listado.
  async function irAConfigurar(ruta: string) {
    setEntrando(true);
    await api.empresas({ id }).entrar.post();
    setEntrando(false);
    router.push(ruta);
    router.refresh();
  }

  if (cargando) {
    return (
      <div className="space-y-6">
        <CargandoTarjeta />
        <CargandoTarjeta />
      </div>
    );
  }

  if (error || !diagnostico) {
    return (
      <div className="space-y-4">
        <Aviso variante="critico">{error ?? "No se pudo cargar el diagnóstico."}</Aviso>
        <Link href="/panel/empresas" className="cuerpo font-medium text-secundario hover:underline">
          ← Volver a empresas
        </Link>
      </div>
    );
  }

  const items = itemsDeEstado(diagnostico);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/panel/empresas"
          className="inline-flex items-center gap-1 cuerpo font-medium text-secundario hover:underline"
        >
          <ArrowLeft className="size-4" />
          Empresas
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="titulo-pagina text-ink">{empresa?.nombre ?? "Empresa"}</h1>
          {empresa ? <PastillaEstado estado={empresa.activa ? "activo" : "inactivo"} /> : null}
        </div>
        {empresa ? (
          <p className="cuerpo text-ink-muted">
            {empresa.prefijoCodigo} · {empresa.usuariosActivos} usuarios activos
          </p>
        ) : null}
      </div>

      <Aviso variante={diagnostico.puedeVender ? "info" : "serio"}>
        {diagnostico.puedeVender
          ? "Esta empresa puede vender: hay al menos una combinación con precio activo e inventario disponible."
          : "Esta empresa todavía no puede vender: falta completar al menos uno de los puntos de abajo."}
      </Aviso>

      <Tarjeta>
        <TarjetaCabecera titulo="Estado" />
        <ul className="divide-y divide-borde">
          {items.map((item) => (
            <li key={item.etiqueta} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3">
                {item.ok ? (
                  <CheckCircle2 className="size-5 shrink-0 text-bien" />
                ) : (
                  <XCircle className="size-5 shrink-0 text-critico" />
                )}
                <div>
                  <p className="cuerpo font-medium text-ink">{item.etiqueta}</p>
                  <p className="cuerpo text-ink-muted">{item.detalle}</p>
                </div>
              </div>
              {!item.ok ? (
                <Boton variante="contorno" tamano="sm" disabled={entrando} onClick={() => irAConfigurar(item.ruta)}>
                  <LogIn />
                  Configurar
                </Boton>
              ) : null}
            </li>
          ))}
        </ul>
      </Tarjeta>
    </div>
  );
}
