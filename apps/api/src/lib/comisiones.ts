import { Prisma, ModoComision, AmbitoUmbral, PeriodoUmbral, Rol } from "../generated/prisma/client.ts";
import { inicioDiaBogota, inicioMesBogota, finDiaBogota } from "./periodos.ts";
import { repartirPorDiaBogota } from "./turnos.ts";

// ---------------------------------------------------------------------------
// F6.6 — Cálculo de comisiones. Esta entrega CALCULA Y MUESTRA, no congela
// ni paga nada (PROMPT-F6.6, Parte 5): la comisión se recalcula cada vez que
// se lee, a partir de ConfiguracionComision vigente y de los Turno que haya
// en ese momento. La consecuencia es deliberada, no un olvido: si un ADMIN
// edita un turno del pasado, las cifras de días YA CERRADOS cambian también
// — eso es correcto mientras esto sea información para mostrar, y deja de
// serlo el día que se pague con estos números. Ese día hace falta un paso de
// liquidación que congele el período con la configuración vigente de ese
// momento (por eso ConfiguracionComision ya guarda versiones, no sobrescribe
// — ver routes/comisiones.ts).
// ---------------------------------------------------------------------------

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

function inicioDePeriodoBogota(periodo: PeriodoUmbral, fecha: Date): Date {
  return periodo === PeriodoUmbral.DIA ? inicioDiaBogota(fecha) : inicioMesBogota(fecha);
}

export interface AportePantalla {
  ventaDetalleId: string;
  ventaId: string;
  plataformaId: string;
  /** Venta.fechaVenta de la venta a la que pertenece esta pantalla. */
  fechaVenta: Date;
  /** `true` si el umbral se la comió: no aporta nada al pozo. */
  absorbida: boolean;
  /** Lo que esta pantalla aporta al pozo. `0` si `absorbida`. */
  monto: Prisma.Decimal;
}

/**
 * LA regla del dinero, en un solo lugar (PROMPT-F6.6, Parte 2): decide,
 * pantalla por pantalla y en el mismo orden determinista que usa el umbral,
 * si esa pantalla comisiona y cuánto aporta. El simulador (parámetros por
 * query) y el cálculo real (parámetros de la ConfiguracionComision vigente,
 * ver calcularComisiones más abajo) llaman a esta misma función — ninguno
 * la reimplementa. Una segunda copia de esta regla es exactamente cómo se
 * desincroniza; ya pasó tres veces en este proyecto (ver R5 y F4.12).
 *
 * Una sola consulta (findMany, select mínimo, sin include anidados, sin una
 * consulta por plataforma) y todo el conteo/prorrateo se hace en memoria.
 *
 * R1: `cliente` debe ser prismaParaEmpresa(empresaId) o un tx ya extendido
 * con esa empresa — ver CLAUDE.md.
 */
export async function aportesPantallasComisionables(
  cliente: ClienteEmpresa,
  parametros: ParametrosComision & { desde: Date; hasta: Date },
): Promise<AportePantalla[]> {
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
  const resultado: AportePantalla[] = [];

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

    const numeroRenglones = renglonesPorVenta.get(renglon.ventaId) ?? 1;
    const monto = absorbida
      ? CERO
      : modo === ModoComision.FIJO_POR_PANTALLA
        ? valor
        : renglon.venta.precioVenta.dividedBy(numeroRenglones).times(valor).dividedBy(100);

    resultado.push({
      ventaDetalleId: renglon.id,
      ventaId: renglon.ventaId,
      plataformaId: renglon.plataformaId,
      fechaVenta,
      absorbida,
      monto,
    });
  }

  return resultado;
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
 * R1: `cliente` debe ser prismaParaEmpresa(empresaId) o un tx ya extendido
 * con esa empresa — ver CLAUDE.md.
 */
export async function simularComisiones(
  cliente: ClienteEmpresa,
  parametros: ParametrosComision & { desde: Date; hasta: Date },
): Promise<ResultadoSimulacionComision> {
  const aportes = await aportesPantallasComisionables(cliente, parametros);

  const CERO = new Prisma.Decimal(0);
  const periodos = new Map<string, AcumuladorPeriodo>();

  let pantallasVendidas = 0;
  let pantallasAbsorbidas = 0;
  let pantallasComisionadas = 0;
  let pozoTotal = CERO;

  for (const aporte of aportes) {
    const inicioPeriodo = inicioDePeriodoBogota(parametros.umbralPeriodo, aporte.fechaVenta);
    const clavePeriodo = String(inicioPeriodo.getTime());
    const acumulado =
      periodos.get(clavePeriodo) ?? { inicio: inicioPeriodo, vendidas: 0, absorbidas: 0, comisionadas: 0, pozo: CERO };

    acumulado.vendidas += 1;
    pantallasVendidas += 1;

    if (aporte.absorbida) {
      acumulado.absorbidas += 1;
      pantallasAbsorbidas += 1;
    } else {
      acumulado.comisionadas += 1;
      acumulado.pozo = acumulado.pozo.plus(aporte.monto);
      pantallasComisionadas += 1;
      pozoTotal = pozoTotal.plus(aporte.monto);
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

export interface TajadaUsuarioDia {
  usuarioId: string;
  horas: number;
  tajada: Prisma.Decimal;
}

export interface PozoDia {
  /** inicioDiaBogota del día — mismo instante que Festivo.fecha. */
  dia: Date;
  /** `finDiaBogota(dia) < ahora`: el pasado no se mueve (Parte 4). */
  cerrado: boolean;
  /** Pozo de ese día, ya redondeado a pesos enteros. */
  pozo: Prisma.Decimal;
  /** `false` si hubo pozo pero nadie de turno — ver `pozoSinRepartir`. */
  repartido: boolean;
  tajadas: TajadaUsuarioDia[];
}

export interface ResultadoCalculoComisiones {
  /** `false` si no hay ConfiguracionComision guardada: todo lo demás es 0/[]. */
  configurada: boolean;
  pozoTotal: Prisma.Decimal;
  /** Pozo de días con ventas pero sin nadie de turno — no se reparte (Parte 3). */
  pozoSinRepartir: Prisma.Decimal;
  pantallasComisionadas: number;
  porDia: PozoDia[];
}

/**
 * Reparte el pozo de un día (ya redondeado a pesos enteros) entre
 * `horasPorUsuario`, proporcionalmente. Cada tajada se trunca hacia abajo y
 * el residuo del redondeo va a quien más horas tuvo ese día (a igualdad, el
 * primero en orden de `usuarioId` asciende, para que el resultado sea
 * determinista). La invariante: la suma de las tajadas es EXACTAMENTE
 * `pozo`, ni un peso de más ni de menos (PROMPT-F6.6, Parte 3).
 */
function repartirPozoDia(pozo: Prisma.Decimal, horasPorUsuario: Map<string, number>): TajadaUsuarioDia[] {
  const horasTotal = [...horasPorUsuario.values()].reduce((suma, horas) => suma + horas, 0);
  const entradas = [...horasPorUsuario.entries()].sort(([a], [b]) => a.localeCompare(b));

  const tajadas: TajadaUsuarioDia[] = entradas.map(([usuarioId, horas]) => ({
    usuarioId,
    horas,
    tajada: pozo
      .times(new Prisma.Decimal(horas).dividedBy(horasTotal))
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN),
  }));

  const sumaTajadas = tajadas.reduce((suma, t) => suma.plus(t.tajada), new Prisma.Decimal(0));
  const residuo = pozo.minus(sumaTajadas);

  if (!residuo.isZero()) {
    let indiceGanador = 0;
    for (let i = 1; i < tajadas.length; i++) {
      if (tajadas[i].horas > tajadas[indiceGanador].horas) indiceGanador = i;
    }
    tajadas[indiceGanador] = { ...tajadas[indiceGanador], tajada: tajadas[indiceGanador].tajada.plus(residuo) };
  }

  return tajadas;
}

/**
 * Calcula la comisión real por persona, sobre la ConfiguracionComision
 * vigente (PROMPT-F6.6, Parte 2 y 3). Un solo pozo, repartido entre quienes
 * tuvieron turno ese día Bogotá, proporcional a sus horas — sin importar el
 * cargo ni si vendieron. Las horas vienen de `repartirPorDiaBogota`
 * (lib/turnos.ts), reutilizada tal cual: un turno 22:00–06:00 participa en
 * los pozos de los dos días en proporción a las horas de cada uno. Las
 * `HoraAdicional` nunca entran aquí — esta función no las consulta.
 *
 * R1: `cliente` debe ser prismaParaEmpresa(empresaId) o un tx ya extendido
 * con esa empresa.
 */
export async function calcularComisiones(
  cliente: ClienteEmpresa,
  parametros: ParametrosComision & { desde: Date; hasta: Date },
  ahora: Date = new Date(),
): Promise<ResultadoCalculoComisiones> {
  const aportes = await aportesPantallasComisionables(cliente, parametros);

  const CERO = new Prisma.Decimal(0);
  const pozosPorDia = new Map<number, Prisma.Decimal>();
  let pantallasComisionadas = 0;

  for (const aporte of aportes) {
    if (aporte.absorbida) continue;
    pantallasComisionadas += 1;
    const clave = inicioDiaBogota(aporte.fechaVenta).getTime();
    pozosPorDia.set(clave, (pozosPorDia.get(clave) ?? CERO).plus(aporte.monto));
  }

  if (pozosPorDia.size === 0) {
    return { configurada: true, pozoTotal: CERO, pozoSinRepartir: CERO, pantallasComisionadas: 0, porDia: [] };
  }

  const diasOrdenados = [...pozosPorDia.keys()].sort((a, b) => a - b);
  const primerDia = new Date(diasOrdenados[0]);
  const ultimoDiaFin = finDiaBogota(new Date(diasOrdenados[diasOrdenados.length - 1]));

  // Mismo patrón de consulta que GET /turnos/horas (lib/turnos.ts): se traen
  // los turnos que se solapan con el rango y se recortan en memoria. Solo
  // EMPLEADO participa (Parte 1): un VENDEDOR es revendedor externo y un
  // ADMIN, aunque pudiera registrarse un turno, no es a quien esta regla
  // reparte.
  const turnos = await cliente.turno.findMany({
    where: {
      inicio: { lt: ultimoDiaFin },
      fin: { gt: primerDia },
      usuario: { rol: Rol.EMPLEADO },
    },
    select: { usuarioId: true, inicio: true, fin: true },
  });

  const horasPorDiaUsuario = new Map<number, Map<string, number>>();
  for (const turno of turnos) {
    const inicioClip = turno.inicio < primerDia ? primerDia : turno.inicio;
    const finClip = turno.fin > ultimoDiaFin ? ultimoDiaFin : turno.fin;
    if (finClip <= inicioClip) continue;

    for (const { fecha, horas } of repartirPorDiaBogota(inicioClip, finClip)) {
      const clave = fecha.getTime();
      const porUsuario = horasPorDiaUsuario.get(clave) ?? new Map<string, number>();
      porUsuario.set(turno.usuarioId, (porUsuario.get(turno.usuarioId) ?? 0) + horas);
      horasPorDiaUsuario.set(clave, porUsuario);
    }
  }

  let pozoTotal = CERO;
  let pozoSinRepartir = CERO;
  const porDia: PozoDia[] = [];

  for (const claveDia of diasOrdenados) {
    const dia = new Date(claveDia);
    // Redondeado a pesos enteros ANTES de repartir: es ese valor entero el
    // que la invariante de la Parte 3 exige que cuadre exacto, no la suma
    // fraccionaria cruda de los aportes.
    const pozo = (pozosPorDia.get(claveDia) ?? CERO).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    pozoTotal = pozoTotal.plus(pozo);
    // Un día cerrado es definitivo aunque el umbral sea mensual: las
    // pantallas se procesan en orden cronológico, así que una venta de hoy
    // no puede cambiar si una pantalla del día 3 fue absorbida por el
    // umbral — el pasado no se mueve (Parte 4). Lo único que cambia en vivo
    // es la tajada del día en curso.
    const cerrado = finDiaBogota(dia).getTime() < ahora.getTime();
    const horasPorUsuario = horasPorDiaUsuario.get(claveDia);

    if (!horasPorUsuario || horasPorUsuario.size === 0) {
      pozoSinRepartir = pozoSinRepartir.plus(pozo);
      porDia.push({ dia, cerrado, pozo, repartido: false, tajadas: [] });
      continue;
    }

    porDia.push({ dia, cerrado, pozo, repartido: true, tajadas: repartirPozoDia(pozo, horasPorUsuario) });
  }

  return { configurada: true, pozoTotal, pozoSinRepartir, pantallasComisionadas, porDia };
}

export type ConfiguracionVigente = ParametrosComision;

/**
 * La vigente es la de vigenteDesde más reciente que ya empezó — nunca
 * Venta.fechaVencimientoMax ni similar, es su propio campo de versión.
 * Extraída de routes/comisiones.ts (F6.9, PROMPT Parte 0): tanto /mias y
 * /resumen como GET /panel-empleado necesitan la misma configuración
 * vigente, y ninguna la recibe por query a diferencia de /simulacion.
 */
export async function configuracionVigente(cliente: ClienteEmpresa): Promise<ConfiguracionVigente | null> {
  return cliente.configuracionComision.findFirst({
    where: { vigenteDesde: { lte: new Date() } },
    orderBy: { vigenteDesde: "desc" },
    select: { modo: true, valor: true, umbralCantidad: true, umbralAmbito: true, umbralPeriodo: true },
  });
}

export interface ResumenComisionUsuario {
  configurada: boolean;
  totalCerrado: string;
  provisional: { dia: string; horas: number; tajada: string } | null;
  porDia: { dia: string; cerrado: boolean; horas: number; tajada: string }[];
}

/**
 * Recorta el resultado de calcularComisiones a lo que le corresponde a UN
 * usuario: su cerrado acumulado, su provisional de hoy aparte (marcado como
 * tal, PROMPT-F6.6 Parte 4), y su detalle por día — solo los días en que
 * tuvo turno, nunca el pozo total ni el precio de venta (Parte 7: con modo
 * porcentaje esos dos números le permitirían despejar cifras ajenas).
 *
 * Extraída de routes/comisiones.ts (F6.9, PROMPT Parte 0): GET /mias y GET
 * /panel-empleado muestran exactamente la misma tajada propia, por la misma
 * razón de R4 — una segunda forma de calcularla es cómo se desincroniza.
 */
export function comisionPropia(resultado: ResultadoCalculoComisiones, usuarioId: string): ResumenComisionUsuario {
  if (!resultado.configurada) {
    return { configurada: false, totalCerrado: "0", provisional: null, porDia: [] };
  }

  let totalCerrado = new Prisma.Decimal(0);
  let provisional: { dia: string; horas: number; tajada: string } | null = null;
  const porDia: { dia: string; cerrado: boolean; horas: number; tajada: string }[] = [];

  for (const dia of resultado.porDia) {
    const propia = dia.tajadas.find((tajada) => tajada.usuarioId === usuarioId);
    if (!propia) continue;

    porDia.push({ dia: dia.dia.toISOString(), cerrado: dia.cerrado, horas: propia.horas, tajada: propia.tajada.toString() });

    if (dia.cerrado) {
      totalCerrado = totalCerrado.plus(propia.tajada);
    } else {
      provisional = { dia: dia.dia.toISOString(), horas: propia.horas, tajada: propia.tajada.toString() };
    }
  }

  return { configurada: true, totalCerrado: totalCerrado.toString(), provisional, porDia };
}
