"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Plus, Ban, CheckCircle2, ChevronRight, MonitorPlay } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { satisfaceRol, type Rol } from "@/lib/rol";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo, AreaCampo, SelectCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { PastillaEstado } from "@/components/ui/pastilla";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Dialogo } from "@/components/ui/dialogo";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { CargandoTabla } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

interface Cuenta {
  id: string;
  plataformaId: string;
  nombrePlataforma: string;
  correo: string;
  capacidadPantallas: number;
  notas: string | null;
  activa: boolean;
  pantallasLibres: number;
  pantallasTotales: number;
}

interface Plataforma {
  id: string;
  nombre: string;
  usaPerfilPin: boolean;
  capacidadPantallas: number;
  activa: boolean;
}

type FiltroEstado = "todas" | "activa" | "inactiva";

function mensajeDeError(errorRespuesta: unknown): string {
  const valor = (errorRespuesta as { value?: { error?: { mensaje?: string } } } | undefined)?.value;
  return valor?.error?.mensaje ?? "No se pudo completar la operación.";
}

const FILTROS_ESTADO: { valor: FiltroEstado; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas" },
  { valor: "activa", etiqueta: "Activas" },
  { valor: "inactiva", etiqueta: "Inactivas" },
];

export default function CuentasCliente({ rol }: { rol: Rol }) {
  // EMPLEADO solo crea cuentas (Parte 7): ver el inventario completo,
  // editar, activar/desactivar sigue siendo exclusivo de ADMIN, igual que
  // en el API. Un botón que devuelve 403 al apretarlo es peor que no
  // tenerlo, así que esta pantalla le oculta todo lo demás.
  const puedeAdministrar = satisfaceRol(rol, "ADMIN");

  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [plataformas, setPlataformas] = useState<Plataforma[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [filtroPlataforma, setFiltroPlataforma] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todas");

  const [panelAbierto, setPanelAbierto] = useState(false);
  const [plataformaId, setPlataformaId] = useState("");
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [notas, setNotas] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorFila, setErrorFila] = useState<string | null>(null);

  const [confirmando, setConfirmando] = useState<Cuenta | null>(null);
  const [desactivando, setDesactivando] = useState(false);

  const plataformaSeleccionada = plataformas.find((p) => p.id === plataformaId) ?? null;

  async function cargarCuentas() {
    setCargandoLista(true);
    setErrorLista(null);
    const { data, error: errorRespuesta } = await api.cuentas.get({
      query: {
        ...(filtroPlataforma ? { plataformaId: filtroPlataforma } : {}),
        ...(filtroEstado !== "todas" ? { estado: filtroEstado } : {}),
      },
    });
    setCargandoLista(false);
    if (errorRespuesta || !data) {
      setErrorLista(mensajeDeError(errorRespuesta));
      return;
    }
    setCuentas(data.cuentas);
  }

  async function cargarPlataformas() {
    // /disponibilidad está abierto desde VENDEDOR hacia arriba (incluye
    // EMPLEADO), a diferencia de GET /plataformas que es exclusivo de
    // ADMIN. Usarlo aquí para ambos roles evita duplicar la carga según
    // quién mira la pantalla.
    const { data } = await api.disponibilidad.get();
    if (data) {
      setPlataformas(
        data.disponibilidad.map((d) => ({
          id: d.plataformaId,
          nombre: d.nombre,
          usaPerfilPin: d.usaPerfilPin,
          capacidadPantallas: d.capacidadPantallas,
          activa: true,
        })),
      );
    }
  }

  useEffect(() => {
    cargarPlataformas();
  }, []);

  useEffect(() => {
    if (!puedeAdministrar) return;
    cargarCuentas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroPlataforma, filtroEstado, puedeAdministrar]);

  function abrirCrear() {
    setPlataformaId("");
    setCorreo("");
    setPassword("");
    setNotas("");
    setError(null);
    setPanelAbierto(true);
  }

  async function crear(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);

    const { error: errorRespuesta } = await api.cuentas.post({
      plataformaId,
      correo,
      password,
      ...(notas ? { notas } : {}),
    });

    setGuardando(false);

    if (errorRespuesta) {
      setError(mensajeDeError(errorRespuesta));
      return;
    }

    setPanelAbierto(false);
    if (puedeAdministrar) cargarCuentas();
  }

  async function activar(id: string) {
    setErrorFila(null);
    const { error: errorRespuesta } = await api.cuentas({ id }).activar.patch();
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      return;
    }
    cargarCuentas();
  }

  async function confirmarDesactivar() {
    if (!confirmando) return;
    setDesactivando(true);
    const { error: errorRespuesta } = await api.cuentas({ id: confirmando.id }).desactivar.patch();
    setDesactivando(false);
    if (errorRespuesta) {
      setErrorFila(mensajeDeError(errorRespuesta));
      setConfirmando(null);
      return;
    }
    setConfirmando(null);
    cargarCuentas();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Cuentas</h1>
          <p className="cuerpo text-ink-muted">
            {puedeAdministrar
              ? "Cuentas de streaming de tu empresa y sus pantallas. Al crear una cuenta se generan automáticamente sus pantallas, perfiles y pines según la plantilla de la plataforma. Nada se borra: una cuenta o pantalla que sobra se desactiva."
              : "Crea cuentas de streaming para tu empresa. Al crear una cuenta se generan automáticamente sus pantallas según la plantilla de la plataforma. Ver, editar y desactivar el inventario completo lo hace tu administrador."}
          </p>
        </div>
        <Boton variante="principal" onClick={abrirCrear}>
          <Plus />
          Nueva cuenta
        </Boton>
      </div>

      {puedeAdministrar ? (
        <>
          <div className="flex flex-wrap gap-3">
            <SelectCampo
              value={filtroPlataforma}
              onChange={(e) => setFiltroPlataforma(e.target.value)}
              className="h-9 w-auto"
            >
              <option value="">Todas las plataformas</option>
              {plataformas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </SelectCampo>
            <div className="flex gap-1.5">
              {FILTROS_ESTADO.map((opcion) => (
                <button
                  key={opcion.valor}
                  type="button"
                  onClick={() => setFiltroEstado(opcion.valor)}
                  className={cn(
                    "rounded-control border px-3 py-1.5 text-xs font-medium transition-colors",
                    filtroEstado === opcion.valor
                      ? "border-primario-suave bg-primario-suave text-primario-texto"
                      : "border-borde text-ink-2 hover:bg-black/4 dark:hover:bg-white/5",
                  )}
                >
                  {opcion.etiqueta}
                </button>
              ))}
            </div>
          </div>

          {errorFila ? <Aviso variante="critico">{errorFila}</Aviso> : null}

          {errorLista ? (
            <Aviso
              variante="critico"
              titulo="No se pudo cargar las cuentas"
              accion={
                <Boton variante="contorno" onClick={cargarCuentas}>
                  Reintentar
                </Boton>
              }
            >
              {errorLista}
            </Aviso>
          ) : cargandoLista ? (
            <CargandoTabla filas={5} columnas={5} />
          ) : cuentas.length === 0 ? (
            <EstadoVacio
              icono={MonitorPlay}
              titulo="No hay cuentas"
              descripcion="Crea la primera cuenta de tu inventario."
              accion={
                <Boton variante="principal" onClick={abrirCrear}>
                  <Plus />
                  Nueva cuenta
                </Boton>
              }
            />
          ) : (
            <Tabla>
              <TablaCabecera>
                <tr>
                  <TablaCeldaCabecera>Plataforma</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Correo</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Pantallas</TablaCeldaCabecera>
                  <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
                  <TablaCeldaCabecera></TablaCeldaCabecera>
                </tr>
              </TablaCabecera>
              <TablaCuerpo>
                {cuentas.map((cuenta) => (
                  <TablaFila key={cuenta.id}>
                    <TablaCelda className="font-medium text-ink">{cuenta.nombrePlataforma}</TablaCelda>
                    <TablaCelda>{cuenta.correo}</TablaCelda>
                    <TablaCelda className="tabular-nums">
                      {cuenta.pantallasLibres} libres / {cuenta.pantallasTotales} total
                    </TablaCelda>
                    <TablaCelda>
                      <PastillaEstado estado={cuenta.activa ? "activo" : "inactivo"} />
                    </TablaCelda>
                    <TablaCelda>
                      <div className="flex justify-end gap-2">
                        <Boton variante="contorno" tamano="sm" asChild>
                          <Link href={`/panel/cuentas/${cuenta.id}`}>
                            Detalle
                            <ChevronRight />
                          </Link>
                        </Boton>
                        {cuenta.activa ? (
                          <Boton variante="destructivo" tamano="sm" onClick={() => setConfirmando(cuenta)}>
                            <Ban />
                            Desactivar
                          </Boton>
                        ) : (
                          <Boton variante="contorno" tamano="sm" onClick={() => activar(cuenta.id)}>
                            <CheckCircle2 />
                            Activar
                          </Boton>
                        )}
                      </div>
                    </TablaCelda>
                  </TablaFila>
                ))}
              </TablaCuerpo>
            </Tabla>
          )}
        </>
      ) : null}

      <PanelLateral abierto={panelAbierto} onCambiarAbierto={setPanelAbierto} titulo="Nueva cuenta">
        <form onSubmit={crear} className="space-y-4">
          {error ? <Aviso variante="critico">{error}</Aviso> : null}

          <Campo etiqueta="Plataforma" required>
            {(props) => (
              <SelectCampo {...props} required value={plataformaId} onChange={(e) => setPlataformaId(e.target.value)}>
                <option value="">Selecciona…</option>
                {plataformas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </SelectCampo>
            )}
          </Campo>

          {plataformaSeleccionada ? (
            plataformaSeleccionada.capacidadPantallas > 0 ? (
              <p className="text-xs text-ink-muted">
                Esta cuenta va a generar {plataformaSeleccionada.capacidadPantallas} pantalla
                {plataformaSeleccionada.capacidadPantallas === 1 ? "" : "s"}
                {plataformaSeleccionada.usaPerfilPin ? ", con sus perfiles y pines" : ""}, según la plantilla de{" "}
                {plataformaSeleccionada.nombre}.
              </p>
            ) : (
              <Aviso variante="aviso">
                {plataformaSeleccionada.nombre} no tiene plantilla de pantallas configurada. Pide a tu administrador
                que la configure antes de crear una cuenta de esta plataforma.
              </Aviso>
            )
          ) : null}

          <Campo etiqueta="Correo" required>
            {(props) => (
              <EntradaCampo {...props} required type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
            )}
          </Campo>

          <Campo etiqueta="Contraseña" required>
            {(props) => (
              <EntradaCampo {...props} required type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Campo>

          <Campo etiqueta="Notas" ayuda="Opcional.">
            {(props) => <AreaCampo {...props} rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />}
          </Campo>

          <div className="flex gap-2 pt-2">
            <Boton type="submit" variante="principal" disabled={guardando} className="flex-1">
              {guardando ? "Creando…" : "Crear cuenta"}
            </Boton>
          </div>
        </form>
      </PanelLateral>

      {puedeAdministrar ? (
        <Dialogo
          abierto={confirmando !== null}
          onCambiarAbierto={(abierto) => !abierto && setConfirmando(null)}
          titulo={`Desactivar la cuenta "${confirmando?.correo}"`}
          descripcion="Sus pantallas quedan desactivadas también."
          textoConfirmar="Desactivar"
          confirmando={desactivando}
          onConfirmar={confirmarDesactivar}
        />
      ) : null}
    </div>
  );
}
