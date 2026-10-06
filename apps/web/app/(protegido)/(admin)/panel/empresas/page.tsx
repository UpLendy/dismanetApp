"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Ban, CheckCircle2, LogIn, Building2 } from "lucide-react";
import { api } from "@/lib/api";
import { Boton } from "@/components/ui/boton";
import { Campo, EntradaCampo } from "@/components/ui/campo";
import { Aviso } from "@/components/ui/aviso";
import { PastillaEstado } from "@/components/ui/pastilla";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Dialogo } from "@/components/ui/dialogo";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { CargandoTabla } from "@/components/ui/cargando";
import { Tabla, TablaCabecera, TablaCuerpo, TablaFila, TablaCeldaCabecera, TablaCelda } from "@/components/ui/tabla";

interface Empresa {
  id: string;
  nombre: string;
  nit: string | null;
  prefijoCodigo: string;
  activa: boolean;
  usuariosActivos: number;
}

export default function PaginaEmpresas() {
  const router = useRouter();

  // null = no autorizado a listar (ADMIN, no SUPER_ADMIN) — no es un error,
  // GET /empresas es SUPER_ADMIN-only.
  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [cargandoLista, setCargandoLista] = useState(true);

  const [panelAbierto, setPanelAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [nit, setNit] = useState("");
  const [prefijoCodigo, setPrefijoCodigo] = useState("");
  const [adminNombre, setAdminNombre] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [confirmando, setConfirmando] = useState<Empresa | null>(null);
  const [desactivando, setDesactivando] = useState(false);

  async function cargarEmpresas() {
    setCargandoLista(true);
    const { data, error: errorRespuesta } = await api.empresas.get();
    setCargandoLista(false);
    setEmpresas(errorRespuesta || !data ? null : data.empresas);
  }

  useEffect(() => {
    cargarEmpresas();
  }, []);

  function abrirCrear() {
    setNombre("");
    setNit("");
    setPrefijoCodigo("");
    setAdminNombre("");
    setAdminEmail("");
    setAdminPassword("");
    setError(null);
    setPanelAbierto(true);
  }

  async function crearEmpresa(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);

    const { data, error: errorRespuesta } = await api.empresas.post({
      nombre,
      ...(nit ? { nit } : {}),
      prefijoCodigo,
      adminNombre,
      adminEmail,
      adminPassword,
    });

    setGuardando(false);

    if (errorRespuesta || !data || !("empresa" in data) || !data.empresa) {
      const valor = errorRespuesta?.value as { error?: { mensaje?: string } } | undefined;
      setError(valor?.error?.mensaje ?? "No se pudo crear la empresa.");
      return;
    }

    setPanelAbierto(false);
    cargarEmpresas();
  }

  async function activar(id: string) {
    await api.empresas({ id }).activar.patch();
    cargarEmpresas();
  }

  async function confirmarDesactivar() {
    if (!confirmando) return;
    setDesactivando(true);
    await api.empresas({ id: confirmando.id }).desactivar.patch();
    setDesactivando(false);
    setConfirmando(null);
    cargarEmpresas();
  }

  async function entrar(id: string) {
    await api.empresas({ id }).entrar.post();
    router.push("/panel");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina text-ink">Empresas</h1>
          <p className="cuerpo text-ink-muted">
            Crear una empresa nueva no te da acceso a ella — solo queda registrado quién la creó.
          </p>
        </div>
        <Boton variante="principal" onClick={abrirCrear}>
          <Plus />
          Nueva empresa
        </Boton>
      </div>

      {cargandoLista ? (
        <CargandoTabla filas={5} columnas={5} />
      ) : empresas ? (
        empresas.length === 0 ? (
          <EstadoVacio
            icono={Building2}
            titulo="No hay empresas"
            descripcion="Crea la primera empresa de la plataforma."
            accion={
              <Boton variante="principal" onClick={abrirCrear}>
                <Plus />
                Nueva empresa
              </Boton>
            }
          />
        ) : (
          <Tabla>
            <TablaCabecera>
              <tr>
                <TablaCeldaCabecera>Nombre</TablaCeldaCabecera>
                <TablaCeldaCabecera>Prefijo</TablaCeldaCabecera>
                <TablaCeldaCabecera className="text-right">Usuarios activos</TablaCeldaCabecera>
                <TablaCeldaCabecera>Estado</TablaCeldaCabecera>
                <TablaCeldaCabecera></TablaCeldaCabecera>
              </tr>
            </TablaCabecera>
            <TablaCuerpo>
              {empresas.map((empresa) => (
                <TablaFila key={empresa.id}>
                  <TablaCelda className="font-medium text-ink">
                    <Link href={`/panel/empresas/${empresa.id}`} className="hover:underline">
                      {empresa.nombre}
                    </Link>
                  </TablaCelda>
                  <TablaCelda className="tabular-nums">{empresa.prefijoCodigo}</TablaCelda>
                  <TablaCelda className="text-right tabular-nums">{empresa.usuariosActivos}</TablaCelda>
                  <TablaCelda>
                    <PastillaEstado estado={empresa.activa ? "activo" : "inactivo"} />
                  </TablaCelda>
                  <TablaCelda>
                    <div className="flex justify-end gap-2">
                      <Boton variante="contorno" tamano="sm" onClick={() => entrar(empresa.id)}>
                        <LogIn />
                        Entrar
                      </Boton>
                      {empresa.activa ? (
                        <Boton variante="destructivo" tamano="sm" onClick={() => setConfirmando(empresa)}>
                          <Ban />
                          Desactivar
                        </Boton>
                      ) : (
                        <Boton variante="contorno" tamano="sm" onClick={() => activar(empresa.id)}>
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
        )
      ) : (
        <p className="cuerpo text-ink-muted">Solo SUPER_ADMIN puede ver el listado de todas las empresas.</p>
      )}

      <PanelLateral abierto={panelAbierto} onCambiarAbierto={setPanelAbierto} titulo="Nueva empresa">
        <form onSubmit={crearEmpresa} className="space-y-4">
          {error ? <Aviso variante="critico">{error}</Aviso> : null}

          <Campo etiqueta="Nombre de la empresa" required>
            {(props) => <EntradaCampo {...props} required value={nombre} onChange={(e) => setNombre(e.target.value)} />}
          </Campo>

          <Campo etiqueta="NIT" ayuda="Opcional.">
            {(props) => <EntradaCampo {...props} value={nit} onChange={(e) => setNit(e.target.value)} />}
          </Campo>

          <Campo etiqueta="Prefijo" required ayuda="3 letras mayúsculas, ej. DIS.">
            {(props) => (
              <EntradaCampo
                {...props}
                required
                maxLength={3}
                value={prefijoCodigo}
                onChange={(e) => setPrefijoCodigo(e.target.value.toUpperCase())}
              />
            )}
          </Campo>

          <div className="border-t border-borde pt-4">
            <p className="cuerpo mb-3 font-medium text-ink">Primer ADMIN de la empresa</p>
            <div className="space-y-4">
              <Campo etiqueta="Nombre" required>
                {(props) => (
                  <EntradaCampo {...props} required value={adminNombre} onChange={(e) => setAdminNombre(e.target.value)} />
                )}
              </Campo>
              <Campo etiqueta="Correo" required>
                {(props) => (
                  <EntradaCampo
                    {...props}
                    required
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                  />
                )}
              </Campo>
              <Campo etiqueta="Contraseña inicial" required>
                {(props) => (
                  <EntradaCampo
                    {...props}
                    required
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                  />
                )}
              </Campo>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Boton type="submit" variante="principal" disabled={guardando} className="flex-1">
              {guardando ? "Creando…" : "Crear empresa"}
            </Boton>
          </div>
        </form>
      </PanelLateral>

      <Dialogo
        abierto={confirmando !== null}
        onCambiarAbierto={(abierto) => !abierto && setConfirmando(null)}
        titulo={`Desactivar "${confirmando?.nombre}"`}
        descripcion="Sus usuarios pierden acceso a la plataforma."
        textoConfirmar="Desactivar"
        confirmando={desactivando}
        onConfirmar={confirmarDesactivar}
      />
    </div>
  );
}
