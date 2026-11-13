import { Prisma, ModoComision, AmbitoUmbral, PeriodoUmbral } from "../generated/prisma/client.ts";
import { inicioDiaBogota, inicioMesBogota } from "./periodos.ts";

// Prisma.TransactionClient (no PrismaClient completo): ver el comentario
// equivalente en pantallas.ts — así esta función acepta tanto
// prismaParaEmpresa(empresaId) como un tx dentro de una transacción.
type ClienteEmpresa = Prisma.TransactionClient;

export interface ParametrosComision {
  modo: ModoComision;
  valor: Prisma.Decimal;
  umbralCantidad: number;
  umbralAmbito: AmbitoUmbral;
  umbralPeriodo: PeriodoUmbral;
}

export interface ErrorValidacionComision {
  codigo: string;
  mensaje: string;
}

/**
 * Validación al guardar (PROMPT-F6.5, Parte 1) y también al simular — la
 * simulación recibe estos mismos parámetros por query, así que debe
 * rechazar los mismos valores inválidos que rechazaría guardar.
 */
export function validarParametrosComision(parametros: ParametrosComision): ErrorValidacionComision | null {
  if (parametros.modo === ModoComision.PORCENTAJE_VENTA) {
    if (!(parametros.valor.greaterThan(0) && parametros.valor.lessThanOrEqualTo(100))) {
      return {
        codigo: "VALOR_INVALIDO",
        mensaje: "El porcentaje debe ser mayor a 0 y menor o igual a 100.",
      };
    }
  } else if (!parametros.valor.greaterThan(0)) {
    return {
      codigo: "VALOR_INVALIDO",
      mensaje: "El monto fijo por pantalla debe ser mayor a 0.",
    };
  }

  if (parametros.umbralCantidad < 0) {
    return {
      codigo: "UMBRAL_INVALIDO",
      mensaje: "La cantidad del umbral no puede ser negativa.",
    };
  }

  return null;
}

export interface FilaPeriodoSimulacion {
  /** Instante UTC real del inicio del día o mes (Bogotá) de esta fila. */
  periodoInicio: string;
  pantallasVendidas: number;
  pantallasAbsorbidas: number;
  pantallasComisionadas: number;
  porcentajeComisionado: number;
  pozoTotal: string;
}

export interface ResultadoSimulacionComision {
  pantallasVendidas: number;
  pantallasAbsorbidas: number;
  pantallasComisionadas: number;
  porcentajeComisionado: number;
  pozoTotal: string;
  porPeriodo: FilaPeriodoSimulacion[];
}

function inicioDePeriodoBogota(periodo: PeriodoUmbral, fecha: Date): Date {
  return periodo === PeriodoUmbral.DIA ? inicioDiaBogota(fecha) : inicioMesBogota(fecha);
}

interface AcumuladorPeriodo {
  inicio: Date;
  vendidas: number;
  absorbidas: number;
  comisionadas: number;
  pozo: Prisma.Decimal;
}

/**
 * Simula la política de comisiones sobre las pantallas vendidas (R3:
 * VentaDetalle) en [desde, hasta), SIN leer ni escribir ConfiguracionComision
 * — los parámetros llegan siempre por argumento, nunca de lo guardado (ese
 * es el punto del simulador: mover el número antes de guardar nada).
 *
 * Una sola consulta (findMany, select mínimo, sin include anidados, sin una
 * consulta por plataforma — el patrón que ya se arregló en F4.12) y todo el
 * conteo/prorrateo se hace en memoria.
 *
 * R1: `cliente` debe ser prismaParaEmpresa(empresaId) o un tx ya extendido
 * con esa empresa — ver CLAUDE.md.
 */
export async function simularComisiones(
  cliente: ClienteEmpresa,
  parametros: ParametrosComision & { desde: Date; hasta: Date },
): Promise<ResultadoSimulacionComision> {
  const { desde, hasta, modo, valor, umbralCantidad, umbralAmbito, umbralPeriodo } = parametros;

  // Orden determinista (CLAUDE.md / PROMPT-F6.5 Parte 2): fechaVenta
  // ascendente y, a igualdad, VentaDetalle.id. No es cosmético — con
  // PORCENTAJE_VENTA cambia CUÁLES pantallas absorbe el umbral, y eso
  // cambia el tamaño del pozo porque no todas valen igual.
  const renglones = await cliente.ventaDetalle.findMany({
    where: {
      venta: {
        anulada: false,
        esExterna: false,
        fechaVenta: { gte: desde, lt: hasta },
      },
    },
    select: {
      id: true,
      ventaId: true,
      plataformaId: true,
      venta: { select: { fechaVenta: true, precioVenta: true } },
    },
    orderBy: [{ venta: { fechaVenta: "asc" } }, { id: "asc" }],
  });

  // Renglones por venta, para prorratear (Parte 2: Venta.precioVenta /
  // número de renglones de esa venta — nunca VentaDetalle.precioSugerido).
  // Se deriva del mismo resultado: todos los renglones de una venta
  // comparten fechaVenta/anulada/esExterna, así que si uno entra al rango
  // todos entran, y no hace falta una consulta aparte.
  const renglonesPorVenta = new Map<string, number>();
  for (const renglon of renglones) {
    renglonesPorVenta.set(renglon.ventaId, (renglonesPorVenta.get(renglon.ventaId) ?? 0) + 1);
  }

  const CERO = new Prisma.Decimal(0);
  const contadorUmbral = new Map<string, number>();
  const periodos = new Map<string, AcumuladorPeriodo>();

  let pantallasVendidas = 0;
  let pantallasAbsorbidas = 0;
  let pantallasComisionadas = 0;
  let pozoTotal = CERO;

  for (const renglon of renglones) {
    const fechaVenta = renglon.venta.fechaVenta;
    const inicioContador = inicioDePeriodoBogota(umbralPeriodo, fechaVenta);
    const claveContador =
      umbralAmbito === AmbitoUmbral.TOTAL
        ? String(inicioContador.getTime())
        : `${renglon.plataformaId}:${inicioContador.getTime()}`;

    const vistos = contadorUmbral.get(claveContador) ?? 0;
    contadorUmbral.set(claveContador, vistos + 1);
    const absorbida = vistos < umbralCantidad;

    const inicioPeriodo = inicioDePeriodoBogota(umbralPeriodo, fechaVenta);
    const clavePeriodo = String(inicioPeriodo.getTime());
    const acumulado =
      periodos.get(clavePeriodo) ?? { inicio: inicioPeriodo, vendidas: 0, absorbidas: 0, comisionadas: 0, pozo: CERO };

    acumulado.vendidas += 1;
    pantallasVendidas += 1;

    if (absorbida) {
      acumulado.absorbidas += 1;
      pantallasAbsorbidas += 1;
    } else {
      const numeroRenglones = renglonesPorVenta.get(renglon.ventaId) ?? 1;
      const monto =
        modo === ModoComision.FIJO_POR_PANTALLA
          ? valor
          : renglon.venta.precioVenta.dividedBy(numeroRenglones).times(valor).dividedBy(100);

      acumulado.comisionadas += 1;
      acumulado.pozo = acumulado.pozo.plus(monto);
      pantallasComisionadas += 1;
      pozoTotal = pozoTotal.plus(monto);
    }

    periodos.set(clavePeriodo, acumulado);
  }

  const porPeriodo: FilaPeriodoSimulacion[] = Array.from(periodos.values())
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime())
    .map((acumulado) => ({
      periodoInicio: acumulado.inicio.toISOString(),
      pantallasVendidas: acumulado.vendidas,
      pantallasAbsorbidas: acumulado.absorbidas,
      pantallasComisionadas: acumulado.comisionadas,
      porcentajeComisionado: acumulado.vendidas > 0 ? (acumulado.comisionadas / acumulado.vendidas) * 100 : 0,
      pozoTotal: acumulado.pozo.toString(),
    }));

  return {
    pantallasVendidas,
    pantallasAbsorbidas,
    pantallasComisionadas,
    porcentajeComisionado: pantallasVendidas > 0 ? (pantallasComisionadas / pantallasVendidas) * 100 : 0,
    pozoTotal: pozoTotal.toString(),
    porPeriodo,
  };
}
