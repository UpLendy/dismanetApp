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
  /** Celular del comprador final, opcional (R3: copia histórica). */
  celularCliente?: string | null;
  /**
   * F4.3 — venta externa: precioVenta es 0 porque no es un ingreso, no
   * porque el comprador no pagó nada. Mostrar "{{precio}}" como "$ 0" sería
   * falso, así que el bloque entero se quita (mismo mecanismo que
   * quitarBloquesDeCamposNoUsados, nunca una sustitución por cadena vacía).
   */
  ocultarPrecio?: boolean;
}

function sustituirMarcadoresComunes(plantilla: string, datos: DatosMensajeComunes): string {
  return plantilla
    .replaceAll("{{codigoCompra}}", datos.codigoCompra)
    .replaceAll("{{fechaEnLetras}}", fechaEnLetras(fechaBogotaParaGettersLocales(datos.fechaVenta)))
    .replaceAll("{{fecha}}", formatearFechaNumerica(datos.fechaVenta))
    .replaceAll("{{tipoCliente}}", datos.nombreTipoCliente)
    .replaceAll("{{duracion}}", datos.nombreDuracion)
    .replaceAll("{{fechaVencimiento}}", formatearFechaNumerica(datos.fechaVencimientoMax))
    .replaceAll("{{precio}}", formatearPesos(datos.precioVenta))
    .replaceAll("{{celular}}", datos.celularCliente ?? "");
}

/** Qué campos de acceso declara la plataforma — mismas 5 banderas de Plataforma (schema.prisma). */
export interface BanderasCamposAcceso {
  usaPerfilPin: boolean;
  usaCorreo: boolean;
  usaUsuario: boolean;
  usaCodigo: boolean;
  usaEnlace: boolean;
}

export interface DatosMensajeUnidad extends DatosMensajeComunes, BanderasCamposAcceso {
  /** nombreMensaje de la plataforma si existe, si no nombre — ya resuelto por el caller. */
  nombrePlataformaMensaje: string;
  perfil: string | null;
  pin: string | null;
  correo: string | null;
  usuario: string | null;
  codigo: string | null;
  enlace: string | null;
  /** Ya descifrada. */
  clave: string;
}

// F4.2, parte 1 — qué campos usa cada plataforma varía (usaPerfilPin,
// usaCorreo, usaUsuario, usaCodigo, usaEnlace); el mensaje debe adaptarse,
// no mostrar una etiqueta vacía para un campo que esa plataforma no tiene.
//
// La plantilla por defecto (Anexo B) pone la etiqueta y el marcador en líneas
// distintas — "*PERFIL:*\n{{perfil}}" — así que quitar solo la línea del
// marcador deja la etiqueta huérfana y vacía, que es exactamente el bug que
// esto corrige. Se quita el bloque completo (separado por línea en blanco,
// el mismo delimitador que ya usa bloqueListaCuentas entre cuentas) para
// que la etiqueta se vaya con su marcador sin importar en cuántas líneas
// esté escrita.
const MARCADORES_POR_BANDERA: Record<keyof BanderasCamposAcceso, readonly string[]> = {
  usaPerfilPin: ["perfil", "pin"],
  usaCorreo: ["correo"],
  usaUsuario: ["usuario"],
  usaCodigo: ["codigo"],
  usaEnlace: ["enlace"],
};

function quitarBloquesPorMarcadores(plantilla: string, marcadores: ReadonlySet<string>): string {
  if (marcadores.size === 0) return plantilla;
  return plantilla
    .split(/\n{2,}/)
    .filter((bloque) => ![...marcadores].some((marcador) => bloque.includes(`{{${marcador}}}`)))
    .join("\n\n");
}

function extraerMarcadores(texto: string): string[] {
  return [...texto.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? "");
}

function quitarBloquesDeCamposNoUsados(plantilla: string, banderas: BanderasCamposAcceso): string {
  const marcadoresNoUsados = new Set<string>();
  for (const [bandera, marcadores] of Object.entries(MARCADORES_POR_BANDERA) as [
    keyof BanderasCamposAcceso,
    readonly string[],
  ][]) {
    if (!banderas[bandera]) {
      for (const marcador of marcadores) marcadoresNoUsados.add(marcador);
    }
  }

  if (marcadoresNoUsados.size === 0) return plantilla;

  const bloques = plantilla.split(/\n{2,}/);
  const bloquesResultado: string[] = [];

  for (const bloque of bloques) {
    const marcadoresBloque = extraerMarcadores(bloque);

    // Si el bloque no tiene marcadores, se conserva intacto
    if (marcadoresBloque.length === 0) {
      bloquesResultado.push(bloque);
      continue;
    }

    // Regla 1: Un bloque se borra solo si todos sus marcadores son de campos no usados.
    if (marcadoresBloque.every((m) => marcadoresNoUsados.has(m))) {
      continue;
    }

    // Si el bloque no contiene ningún marcador no usado, se conserva intacto
    if (!marcadoresBloque.some((m) => marcadoresNoUsados.has(m))) {
      bloquesResultado.push(bloque);
      continue;
    }

    // Reglas 2 y 3: Si el bloque mezcla usados y no usados, el bloque se conserva
    // y se quitan solo las líneas que contienen únicamente marcadores no usados.
    // Si al quitar esa línea queda arriba una línea de etiqueta sin ningún marcador
    // (el caso `*PERFIL:*\n{{perfil}}`), esa etiqueta se va con ella.
    const lineas = bloque.split(/\r?\n/);
    const lineasAEliminar = new Set<number>();

    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i] ?? "";
      const marcadoresLinea = extraerMarcadores(linea);

      if (marcadoresLinea.length > 0 && marcadoresLinea.every((m) => marcadoresNoUsados.has(m))) {
        lineasAEliminar.add(i);

        const tieneTextoPropio = /\p{L}|\p{N}/u.test(linea.replace(/\{\{\w+\}\}/g, ""));
        if (!tieneTextoPropio) {
          let anterior = i - 1;
          while (anterior >= 0 && lineasAEliminar.has(anterior)) {
            anterior--;
          }
          if (anterior >= 0) {
            const lineaAnterior = lineas[anterior] ?? "";
            if (extraerMarcadores(lineaAnterior).length === 0) {
              lineasAEliminar.add(anterior);
            }
          }
        }
      }
    }

    const lineasFiltradas = lineas.filter((_, idx) => !lineasAEliminar.has(idx));
    if (lineasFiltradas.length > 0) {
      bloquesResultado.push(lineasFiltradas.join("\n"));
    }
  }

  return bloquesResultado.join("\n\n");
}

/**
 * F4.3 — venta externa: ocultarPrecio quita el bloque de {{precio}} con el
 * mismo mecanismo de bloques (ver comentario sobre MARCADORES_POR_BANDERA),
 * nunca por sustitución de cadena vacía (eso deja la etiqueta huérfana).
 */
function quitarBloquePrecioSiAplica(plantilla: string, datos: DatosMensajeComunes): string {
  return datos.ocultarPrecio ? quitarBloquesPorMarcadores(plantilla, new Set(["precio"])) : plantilla;
}

export function renderizarMensajeUnidad(plantilla: string, datos: DatosMensajeUnidad): string {
  const plantillaAjustada = quitarBloquePrecioSiAplica(quitarBloquesDeCamposNoUsados(plantilla, datos), datos);
  return sustituirMarcadoresComunes(plantillaAjustada, datos)
    .replaceAll("{{plataforma}}", datos.nombrePlataformaMensaje)
    .replaceAll("{{perfil}}", datos.perfil ?? "")
    .replaceAll("{{pin}}", datos.pin ?? "")
    .replaceAll("{{correo}}", datos.correo ?? "")
    .replaceAll("{{usuario}}", datos.usuario ?? "")
    .replaceAll("{{codigo}}", datos.codigo ?? "")
    .replaceAll("{{enlace}}", datos.enlace ?? "")
    .replaceAll("{{clave}}", datos.clave);
}

export interface ComponenteMensajePaquete extends BanderasCamposAcceso {
  /** nombreMensaje de la plataforma si existe, si no nombre — ya resuelto por el caller. */
  nombrePlataforma: string;
  /** Nombre de la duración REAL de este componente (puede diferir de la vendida). */
  nombreDuracionReal: string;
  perfil: string | null;
  pin: string | null;
  correo: string | null;
  usuario: string | null;
  codigo: string | null;
  enlace: string | null;
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
  if (componente.usaCorreo) lineas.push(`*CORREO:* ${componente.correo ?? ""}`);
  if (componente.usaUsuario) lineas.push(`*USUARIO:* ${componente.usuario ?? ""}`);
  if (componente.usaCodigo) lineas.push(`*CÓDIGO:* ${componente.codigo ?? ""}`);
  if (componente.usaEnlace) lineas.push(`*ENLACE:* ${componente.enlace ?? ""}`);
  lineas.push(`*CONTRASEÑA:* ${componente.clave}`);
  return lineas.join("\n");
}

export function renderizarMensajePaquete(plantilla: string, datos: DatosMensajePaquete): string {
  const plantillaAjustada = quitarBloquePrecioSiAplica(plantilla, datos);
  const listaCuentas = datos.componentes.map(bloqueListaCuentas).join("\n\n");
  return sustituirMarcadoresComunes(plantillaAjustada, datos)
    .replaceAll("{{paquete}}", datos.nombrePaquete)
    .replaceAll("{{listaCuentas}}", listaCuentas);
}
