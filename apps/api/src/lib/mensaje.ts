import type { Prisma } from "../generated/prisma/client.ts";
import { fechaEnLetras } from "./fecha-en-letras.ts";

// ---------------------------------------------------------------------------
// Entrega 8, sección 4 — renderizador del mensaje de WhatsApp (PRD 5.9,
// Anexo B). Interpolación de texto pura: sin acceso a base de datos, sin
// descifrado (los valores de clave/pin llegan ya descifrados desde el
// caller, que es quien tiene el contexto de Cuenta/Pantalla) — por eso es
// seguro llamarlo DESDE DENTRO de la transacción de venta.
//
// Colombia no observa horario de verano (America/Bogota = UTC-5 siempre),
// pero el servidor puede correr en cualquier zona. partesFechaBogota() usa
// Intl con timeZone explícito para extraer los componentes de fecha/hora
// correctos sin depender de en qué zona esté corriendo el proceso.
// ---------------------------------------------------------------------------

interface PartesFecha {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
}

const FORMATO_BOGOTA = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function partesFechaBogota(fecha: Date): PartesFecha {
  const partes = FORMATO_BOGOTA.formatToParts(fecha);
  const obtener = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  // hour12: false representa medianoche como "24": se normaliza a 0.
  const hora = obtener("hour");
  return { anio: obtener("year"), mes: obtener("month"), dia: obtener("day"), hora: hora === 24 ? 0 : hora, minuto: obtener("minute") };
}

/**
 * Un Date cuyos getters LOCALES (getDate/getMonth/...), en la zona horaria
 * que sea que esté corriendo el proceso, devuelven los componentes de hora
 * de Bogotá para `fecha`. `new Date(y, m, d, ...)` siempre construye el
 * instante correspondiente a esos componentes interpretados como hora local
 * del runtime — por eso este truco funciona sin importar la zona del
 * servidor. fechaEnLetras() espera exactamente esto (ver su comentario).
 */
function fechaBogotaParaGettersLocales(fecha: Date): Date {
  const p = partesFechaBogota(fecha);
  return new Date(p.anio, p.mes - 1, p.dia, p.hora, p.minuto);
}

function formatearFechaNumerica(fecha: Date): string {
  const p = partesFechaBogota(fecha);
  return `${String(p.dia).padStart(2, "0")}/${String(p.mes).padStart(2, "0")}/${p.anio}`;
}

const FORMATO_PESOS = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export function formatearPesos(valor: Prisma.Decimal | number | string): string {
  const numero =
    typeof valor === "number"
      ? valor
      : typeof valor === "string"
        ? Number(valor)
        : // Prisma.Decimal (decimal.js): tiene toNumber(), sin importar la clase como valor.
          (valor as unknown as { toNumber(): number }).toNumber();
  return FORMATO_PESOS.format(numero);
}

export interface DatosMensajeComunes {
  codigoCompra: string;
  fechaVenta: Date;
  nombreTipoCliente: string;
  /** Duración VENDIDA (no la real de cada componente). */
  nombreDuracion: string;
  fechaVencimientoMax: Date;
  precioVenta: Prisma.Decimal | number | string;
}

function sustituirMarcadoresComunes(plantilla: string, datos: DatosMensajeComunes): string {
  return plantilla
    .replaceAll("{{codigoCompra}}", datos.codigoCompra)
    .replaceAll("{{fechaEnLetras}}", fechaEnLetras(fechaBogotaParaGettersLocales(datos.fechaVenta)))
    .replaceAll("{{fecha}}", formatearFechaNumerica(datos.fechaVenta))
    .replaceAll("{{tipoCliente}}", datos.nombreTipoCliente)
    .replaceAll("{{duracion}}", datos.nombreDuracion)
    .replaceAll("{{fechaVencimiento}}", formatearFechaNumerica(datos.fechaVencimientoMax))
    .replaceAll("{{precio}}", formatearPesos(datos.precioVenta));
}

export interface DatosMensajeUnidad extends DatosMensajeComunes {
  /** nombreMensaje de la plataforma si existe, si no nombre — ya resuelto por el caller. */
  nombrePlataformaMensaje: string;
  perfil: string | null;
  pin: string | null;
  correo: string;
  /** Ya descifrada. */
  clave: string;
}

export function renderizarMensajeUnidad(plantilla: string, datos: DatosMensajeUnidad): string {
  return sustituirMarcadoresComunes(plantilla, datos)
    .replaceAll("{{plataforma}}", datos.nombrePlataformaMensaje)
    .replaceAll("{{perfil}}", datos.perfil ?? "")
    .replaceAll("{{pin}}", datos.pin ?? "")
    .replaceAll("{{correo}}", datos.correo)
    .replaceAll("{{clave}}", datos.clave);
}

export interface ComponenteMensajePaquete {
  /** nombreMensaje de la plataforma si existe, si no nombre — ya resuelto por el caller. */
  nombrePlataforma: string;
  usaPerfilPin: boolean;
  /** Nombre de la duración REAL de este componente (puede diferir de la vendida). */
  nombreDuracionReal: string;
  perfil: string | null;
  pin: string | null;
  correo: string;
  /** Ya descifrada. */
  clave: string;
}

export interface DatosMensajePaquete extends DatosMensajeComunes {
  nombrePaquete: string;
  componentes: ComponenteMensajePaquete[];
}

function bloqueListaCuentas(componente: ComponenteMensajePaquete): string {
  const lineas = [`*${componente.nombrePlataforma} (${componente.nombreDuracionReal})*`];
  if (componente.usaPerfilPin) {
    lineas.push(`*PERFIL:* ${componente.perfil ?? ""}`);
    lineas.push(`*PIN:* ${componente.pin ?? ""}`);
  }
  lineas.push(`*CORREO:* ${componente.correo}`);
  lineas.push(`*CONTRASEÑA:* ${componente.clave}`);
  return lineas.join("\n");
}

export function renderizarMensajePaquete(plantilla: string, datos: DatosMensajePaquete): string {
  const listaCuentas = datos.componentes.map(bloqueListaCuentas).join("\n\n");
  return sustituirMarcadoresComunes(plantilla, datos)
    .replaceAll("{{paquete}}", datos.nombrePaquete)
    .replaceAll("{{listaCuentas}}", listaCuentas);
}
