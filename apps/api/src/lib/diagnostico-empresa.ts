import { Prisma } from "../generated/prisma/client.ts";
import { pantallasDisponibles } from "./pantallas.ts";
import { resolverComposicionDePaquete } from "./paquetes.ts";
import { descifrar } from "./cifrado.ts";

// Prisma.TransactionClient (no PrismaClient completo): mismo motivo que
// pantallas.ts/paquetes.ts — esta función solo usa delegados de modelo.
type ClienteEmpresa = Prisma.TransactionClient;

export interface CuentaPinInconsistente {
  cuentaId: string;
  nombrePlataforma: string;
  identificador: string;
  perfil: string;
  numerosPantalla: number[];
}

export interface DiagnosticoEmpresa {
  plantillas: { existeUnidad: boolean; existePaquete: boolean };
  tiposClienteActivos: number;
  duracionesActivas: number;
  plataformasActivas: number;
  paquetesActivos: number;
  preciosActivos: number;
  cuentasActivas: number;
  pantallasActivas: number;
  pantallasLibres: number;
  cuentasConPinInconsistente: CuentaPinInconsistente[];
  puedeVender: boolean;
}

/**
 * F4.2 parte 2.1 — "mismo perfil ⇒ mismo PIN". El PATCH de pantallas ya
 * propaga el PIN a las hermanas del mismo perfil al editar, así que esto
 * solo debería encontrar algo si quedó una inconsistencia de antes de esa
 * regla. Un entrada por (cuenta, perfil): agrupa las pantallas activas con
 * perfil de cada cuenta de plataforma con usaPerfilPin y marca los perfiles
 * donde el PIN descifrado no es el mismo en todas.
 */
export async function buscarCuentasConPinInconsistente(cliente: ClienteEmpresa): Promise<CuentaPinInconsistente[]> {
  const cuentas = await cliente.cuenta.findMany({
    where: { activa: true, plataforma: { usaPerfilPin: true } },
    select: {
      id: true,
      correo: true,
      usuario: true,
      plataforma: { select: { nombre: true } },
      pantallas: {
        where: { activa: true, perfil: { not: null } },
        select: { numero: true, perfil: true, pin: true },
      },
    },
  });

  const resultado: CuentaPinInconsistente[] = [];
  for (const cuenta of cuentas) {
    const porPerfil = new Map<string, { numero: number; pin: string | null }[]>();
    for (const pantalla of cuenta.pantallas) {
      const perfil = pantalla.perfil!;
      const pin = pantalla.pin ? descifrar(pantalla.pin) : null;
      const filas = porPerfil.get(perfil) ?? [];
      filas.push({ numero: pantalla.numero, pin });
      porPerfil.set(perfil, filas);
    }

    for (const [perfil, filas] of porPerfil) {
      if (new Set(filas.map((f) => f.pin)).size > 1) {
        resultado.push({
          cuentaId: cuenta.id,
          nombrePlataforma: cuenta.plataforma.nombre,
          identificador: cuenta.correo ?? cuenta.usuario ?? `${cuenta.plataforma.nombre} #${cuenta.id.slice(0, 8)}`,
          perfil,
          numerosPantalla: filas.map((f) => f.numero),
        });
      }
    }
  }
  return resultado;
}

/**
 * ¿Al menos una PLATAFORMA vendible como unidad tiene precio activo y
 * pantallas libres? No depende de una duración o tipo de cliente puntual
 * (a diferencia de plataformasDisponibles, que sí): este diagnóstico
 * pregunta "¿existe algo vendible?", no "¿qué se puede vender hoy a este
 * cliente?" — por eso recorre directamente los Precio activos con
 * plataformaId, sin fijar duracionId/tipoClienteId.
 */
async function hayUnidadVendible(cliente: ClienteEmpresa): Promise<boolean> {
  const precios = await cliente.precio.findMany({
    where: { activo: true, plataformaId: { not: null }, plataforma: { activa: true } },
    select: { plataformaId: true },
    distinct: ["plataformaId"],
  });

  for (const { plataformaId } of precios) {
    const estados = await pantallasDisponibles(cliente, plataformaId!);
    if (estados.some((p) => p.libre)) return true;
  }
  return false;
}

/**
 * ¿Al menos un PAQUETE tiene precio activo y, para la duración de ese
 * precio, inventario suficiente en TODOS sus componentes a la vez (R2
 * regla 2: todo o nada)? Reusa resolverComposicionDePaquete, el mismo
 * cálculo que usa la venta real.
 */
async function hayPaqueteVendible(cliente: ClienteEmpresa): Promise<boolean> {
  const precios = await cliente.precio.findMany({
    where: { activo: true, paqueteId: { not: null }, paquete: { activo: true } },
    select: { paqueteId: true, duracionId: true },
  });

  for (const { paqueteId, duracionId } of precios) {
    const composicion = await resolverComposicionDePaquete(cliente, paqueteId!, duracionId);
    if (composicion.length === 0) continue;

    let todosAlcanzan = true;
    for (const componente of composicion) {
      const estados = await pantallasDisponibles(cliente, componente.plataformaId);
      const libres = estados.filter((p) => p.libre).length;
      if (libres < componente.cantidadPantallas) {
        todosAlcanzan = false;
        break;
      }
    }
    if (todosAlcanzan) return true;
  }
  return false;
}

export async function diagnosticoDeEmpresa(cliente: ClienteEmpresa): Promise<DiagnosticoEmpresa> {
  const [
    plantillasUnidad,
    plantillasPaquete,
    tiposClienteActivos,
    duracionesActivas,
    plataformasActivas,
    paquetesActivos,
    preciosActivos,
    cuentasActivas,
    pantallasActivas,
    pantallasLibresPorCuenta,
    cuentasConPinInconsistente,
  ] = await Promise.all([
    cliente.plantillaMensaje.findFirst({ where: { tipo: "UNIDAD" }, select: { id: true } }),
    cliente.plantillaMensaje.findFirst({ where: { tipo: "PAQUETE" }, select: { id: true } }),
    cliente.tipoCliente.count({ where: { activo: true } }),
    cliente.duracion.count({ where: { activa: true } }),
    cliente.plataforma.count({ where: { activa: true } }),
    cliente.paquete.count({ where: { activo: true } }),
    cliente.precio.count({ where: { activo: true } }),
    cliente.cuenta.count({ where: { activa: true } }),
    cliente.pantalla.count({ where: { activa: true } }),
    // Libre = sin VentaDetalle vigente (R5) — mismo criterio que
    // estadoDePantallas, pero contado directo en SQL porque aquí solo
    // interesa el total, no el detalle por pantalla.
    cliente.pantalla.count({
      where: {
        activa: true,
        cuenta: { activa: true },
        ventaDetalles: { none: { fechaVencimiento: { gt: new Date() }, venta: { anulada: false } } },
      },
    }),
    buscarCuentasConPinInconsistente(cliente),
  ]);

  const puedeVender = (await hayUnidadVendible(cliente)) || (await hayPaqueteVendible(cliente));

  return {
    plantillas: { existeUnidad: plantillasUnidad !== null, existePaquete: plantillasPaquete !== null },
    tiposClienteActivos,
    duracionesActivas,
    plataformasActivas,
    paquetesActivos,
    preciosActivos,
    cuentasActivas,
    pantallasActivas,
    pantallasLibres: pantallasLibresPorCuenta,
    cuentasConPinInconsistente,
    puedeVender,
  };
}
