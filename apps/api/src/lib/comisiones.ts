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
//
// F6.10 — Comisión configurable por plataforma. ConfiguracionComision deja
// de ser "la regla" y pasa a ser el VALOR POR DEFECTO: lo que aplica a toda
// plataforma sin excepción propia, incluidas las que se creen después. Las
// excepciones (ConfiguracionComisionPlataforma) cuelgan de la VERSIÓN, nunca
// de la plataforma — ver el comentario del modelo en schema.prisma. El
// reparto por horas de turno, el redondeo al peso, pozoSinRepartir y la
// vista del empleado (comisionPropia) no se tocan: consumen `monto` y
// `fechaVenta` de cada pantalla y no se enteran de dónde salió el monto.
// ---------------------------------------------------------------------------

// Prisma.TransactionClient (no PrismaClient completo): ver el comentario
// equivalente en pantallas.ts — así esta función acepta tanto
// prismaParaEmpresa(empresaId) como un tx dentro de una transacción.
type ClienteEmpresa = Prisma.TransactionClient;

/** Excepción de UNA plataforma dentro de una versión de ConfiguracionComision. `null` en modo/valor/umbralCantidad = hereda el valor por defecto. */
export interface ExcepcionPlataforma {
  plataformaId: string;
  comisiona: boolean;
  modo: ModoComision | null;
  valor: Prisma.Decimal | null;
  umbralCantidad: number | null;
}

export interface ParametrosComision {
  modo: ModoComision;
  valor: Prisma.Decimal;
  umbralCantidad: number;
  umbralAmbito: AmbitoUmbral;
  umbralPeriodo: PeriodoUmbral;
  /** Excepciones por plataforma de la versión en uso (F6.10). Ausente o vacío = ninguna plataforma tiene regla propia, todas heredan el valor por defecto. */
  excepciones?: ExcepcionPlataforma[];
}

export interface ErrorValidacionComision {
  codigo: string;
  mensaje: string;
}

/** Reglas de rango de F6.5, compartidas por el valor por defecto y por cada excepción: porcentaje (0,100], monto fijo > 0. */
function validarValorModo(modo: ModoComision, valor: Prisma.Decimal): ErrorValidacionComision | null {
  if (modo === ModoComision.PORCENTAJE_VENTA) {
    if (!(valor.greaterThan(0) && valor.lessThanOrEqualTo(100))) {
      return {
        codigo: "VALOR_INVALIDO",
        mensaje: "El porcentaje debe ser mayor a 0 y menor o igual a 100.",
      };
    }
  } else if (!valor.greaterThan(0)) {
    return {
      codigo: "VALOR_INVALIDO",
      mensaje: "El monto fijo por pantalla debe ser mayor a 0.",
    };
  }
  return null;
}

/**
 * Validación al guardar el valor por defecto (PROMPT-F6.5, Parte 1) y
 * también al simular — la simulación recibe estos mismos parámetros por
 * body, así que debe rechazar los mismos valores inválidos que rechazaría
 * guardar.
 */
export function validarParametrosComision(parametros: ParametrosComision): ErrorValidacionComision | null {
  const errorValor = validarValorModo(parametros.modo, parametros.valor);
  if (errorValor) return errorValor;

  if (parametros.umbralCantidad < 0) {
    return {
      codigo: "UMBRAL_INVALIDO",
      mensaje: "La cantidad del umbral no puede ser negativa.",
    };
  }

  return null;
}

/** Lo que llega por body para UNA excepción, antes de normalizar (F6.10, Parte 1). */
export interface EntradaExcepcionComision {
  plataformaId: string;
  comisiona: boolean;
  modo?: ModoComision | null;
  valor?: Prisma.Decimal | null;
  umbralCantidad?: number | null;
}

/**
 * Valida UNA fila de excepción antes de guardarla (PROMPT-F6.10, Parte 1).
 * No valida existencia/actividad de la plataforma — eso necesita la base de
 * datos y vive en routes/comisiones.ts.
 *
 * - `comisiona: false` no valida nada más: modo/valor/umbralCantidad se
 *   normalizan a null al guardar (ver routes/comisiones.ts), así que lo que
 *   traiga el body ahí no importa.
 * - Si llega `modo`, tiene que llegar `valor` — un modo sin valor no se
 *   puede resolver.
 * - Si llega `valor`, se valida contra el modo EFECTIVO: el propio si lo
 *   manda, si no el del valor por defecto — mismas reglas de rango que
 *   validarParametrosComision.
 * - Si llega `umbralCantidad`, no puede ser negativo.
 * - `umbralAmbito: TOTAL` junto con un `umbralCantidad` propio es
 *   contradictorio: un contador compartido no tiene dueño de quién es el
 *   umbral. Se rechaza aquí, antes de guardar nada.
 */
export function validarExcepcionComision(
  defecto: Pick<ParametrosComision, "modo">,
  umbralAmbito: AmbitoUmbral,
  excepcion: EntradaExcepcionComision,
): ErrorValidacionComision | null {
  if (!excepcion.comisiona) return null;

  const tieneModoPropio = excepcion.modo !== null && excepcion.modo !== undefined;
  const tieneValorPropio = excepcion.valor !== null && excepcion.valor !== undefined;
  const tieneUmbralPropio = excepcion.umbralCantidad !== null && excepcion.umbralCantidad !== undefined;

  if (tieneModoPropio && !tieneValorPropio) {
    return {
      codigo: "MODO_SIN_VALOR",
      mensaje: "Si defines un modo propio para esta plataforma, también debes definir su valor.",
    };
  }

  if (tieneValorPropio) {
    const modoEfectivo = excepcion.modo ?? defecto.modo;
    const errorValor = validarValorModo(modoEfectivo, excepcion.valor as Prisma.Decimal);
    if (errorValor) return errorValor;
  }

  if (tieneUmbralPropio) {
    if ((excepcion.umbralCantidad as number) < 0) {
      return {
        codigo: "UMBRAL_INVALIDO",
        mensaje: "La cantidad del umbral no puede ser negativa.",
      };
    }
    if (umbralAmbito === AmbitoUmbral.TOTAL) {
      return {
        codigo: "UMBRAL_INCOMPATIBLE_CON_AMBITO_TOTAL",
        mensaje:
          "El ámbito del umbral es TOTAL (un solo contador compartido entre todas las plataformas): esta plataforma no puede traer su propio umbralCantidad porque no hay dueño del contador. Usa ámbito POR_PLATAFORMA si quieres umbrales distintos por servicio.",
      };
    }
  }

  return null;
}

function inicioDePeriodoBogota(periodo: PeriodoUmbral, fecha: Date): Date {
  return periodo === PeriodoUmbral.DIA ? inicioDiaBogota(fecha) : inicioMesBogota(fecha);
}

export interface ReglaResuelta {
  comisiona: boolean;
  modo: ModoComision;
  valor: Prisma.Decimal;
  umbralCantidad: number;
}

/**
 * Resuelve la regla real de UNA plataforma: su excepción (si tiene), con los
 * campos en `null` rellenados desde el valor por defecto (PROMPT-F6.10,
 * Parte 2). Nombrada y exportada aparte porque la usan tres sitios que no
 * deben reimplementarla — el cálculo real y el simulador (los dos a través
 * de aportesPantallasComisionables, más abajo) y GET
 * /comisiones/configuracion, para mostrar qué hereda cada fila sin campos
 * vacíos.
 */
export function resolverReglaPlataforma(
  defecto: Pick<ParametrosComision, "modo" | "valor" | "umbralCantidad">,
  excepcion: ExcepcionPlataforma | undefined,
): ReglaResuelta {
  if (!excepcion) {
    return { comisiona: true, modo: defecto.modo, valor: defecto.valor, umbralCantidad: defecto.umbralCantidad };
  }
  if (!excepcion.comisiona) {
    // modo/valor/umbralCantidad no importan cuando no comisiona (nunca se
    // leen), pero se devuelven resueltos de todas formas para que el tipo
    // sea uniforme y la pantalla de configuración pueda mostrarlos atenuados.
    return { comisiona: false, modo: defecto.modo, valor: defecto.valor, umbralCantidad: defecto.umbralCantidad };
  }
  return {
    comisiona: true,
    modo: excepcion.modo ?? defecto.modo,
    valor: excepcion.valor ?? defecto.valor,
    umbralCantidad: excepcion.umbralCantidad ?? defecto.umbralCantidad,
  };
}

export interface AportePantalla {
  ventaDetalleId: string;
  ventaId: string;
  plataformaId: string;
  /** Venta.fechaVenta de la venta a la que pertenece esta pantalla. */
  fechaVenta: Date;
  /** `true` si el umbral se la comió: no aporta nada al pozo. */
  absorbida: boolean;
  /** `true` si la plataforma de esta pantalla no comisiona (F6.10): no entra al pozo y NO CONSUMIÓ contador de umbral. Distinto de `absorbida`. */
  excluida: boolean;
  /** Lo que esta pantalla aporta al pozo. `0` si `absorbida` o `excluida`. */
  monto: Prisma.Decimal;
}

/**
 * LA regla del dinero, en un solo lugar (PROMPT-F6.6, Parte 2; PROMPT-F6.10,
 * Parte 0 y 2): decide, pantalla por pantalla y en el mismo orden
 * determinista que usa el umbral, si esa pantalla comisiona y cuánto aporta.
 * El simulador (parámetros por body) y el cálculo real (parámetros de la
 * ConfiguracionComision vigente, ver calcularComisiones más abajo) llaman a
 * esta misma función — ninguno la reimplementa. Una segunda copia de esta
 * regla es exactamente cómo se desincroniza; ya pasó tres veces en este
 * proyecto (ver R5 y F4.12).
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
  const { desde, hasta, modo, valor, umbralCantidad, umbralAmbito, umbralPeriodo, excepciones } = parametros;

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

  // Mapa de excepciones por plataforma, armado antes del bucle (PROMPT-F6.10,
  // Parte 2): dentro del bucle ya se tiene renglon.plataformaId en la mano,
  // justo donde se decide si la pantalla absorbe umbral y cuánto aporta.
  const excepcionesPorPlataforma = new Map(
    (excepciones ?? []).map((excepcion) => [excepcion.plataformaId, excepcion]),
  );

  const CERO = new Prisma.Decimal(0);
  const contadorUmbral = new Map<string, number>();
  const resultado: AportePantalla[] = [];

  for (const renglon of renglones) {
    const fechaVenta = renglon.venta.fechaVenta;
    const regla = resolverReglaPlataforma({ modo, valor, umbralCantidad }, excepcionesPorPlataforma.get(renglon.plataformaId));

    if (!regla.comisiona) {
      // No toca contadorUmbral (Parte 2, punto 2): si lo consumiera, una
      // plataforma que no comisiona le estaría comiendo el umbral
      // compartido a las que sí (ámbito TOTAL), y el dueño vería menos
      // comisión de la que configuró sin entender por qué.
      resultado.push({
        ventaDetalleId: renglon.id,
        ventaId: renglon.ventaId,
        plataformaId: renglon.plataformaId,
        fechaVenta,
        absorbida: false,
        excluida: true,
        monto: CERO,
      });
      continue;
    }

    const inicioContador = inicioDePeriodoBogota(umbralPeriodo, fechaVenta);
    const claveContador =
      umbralAmbito === AmbitoUmbral.TOTAL
        ? String(inicioContador.getTime())
        : `${renglon.plataformaId}:${inicioContador.getTime()}`;

    const vistos = contadorUmbral.get(claveContador) ?? 0;
    contadorUmbral.set(claveContador, vistos + 1);
    const absorbida = vistos < regla.umbralCantidad;

    const numeroRenglones = renglonesPorVenta.get(renglon.ventaId) ?? 1;
    const montoAporte = absorbida
      ? CERO
      : regla.modo === ModoComision.FIJO_POR_PANTALLA
        ? regla.valor
        : renglon.venta.precioVenta.dividedBy(numeroRenglones).times(regla.valor).dividedBy(100);

    resultado.push({
      ventaDetalleId: renglon.id,
      ventaId: renglon.ventaId,
      plataformaId: renglon.plataformaId,
      fechaVenta,
      absorbida,
      excluida: false,
      monto: montoAporte,
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

/** Desglose por plataforma (PROMPT-F6.10, Parte 3): lo que permite comparar servicios, que es para lo que se pidió esto. */
export interface FilaPlataformaSimulacion {
  plataformaId: string;
  pantallasVendidas: number;
  pantallasAbsorbidas: number;
  pantallasExcluidas: number;
  pantallasComisionadas: number;
  pozo: string;
}

export interface ResultadoSimulacionComision {
  pantallasVendidas: number;
  pantallasAbsorbidas: number;
  pantallasComisionadas: number;
  porcentajeComisionado: number;
  pozoTotal: string;
  porPeriodo: FilaPeriodoSimulacion[];
  porPlataforma: FilaPlataformaSimulacion[];
}

interface AcumuladorPeriodo {
  inicio: Date;
  vendidas: number;
  absorbidas: number;
  comisionadas: number;
  pozo: Prisma.Decimal;
}

interface AcumuladorPlataforma {
  vendidas: number;
  absorbidas: number;
  excluidas: number;
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
  const plataformas = new Map<string, AcumuladorPlataforma>();

  let pantallasVendidas = 0;
  let pantallasAbsorbidas = 0;
  let pantallasComisionadas = 0;
  let pozoTotal = CERO;

  for (const aporte of aportes) {
    const inicioPeriodo = inicioDePeriodoBogota(parametros.umbralPeriodo, aporte.fechaVenta);
    const clavePeriodo = String(inicioPeriodo.getTime());
    const acumulado =
      periodos.get(clavePeriodo) ?? { inicio: inicioPeriodo, vendidas: 0, absorbidas: 0, comisionadas: 0, pozo: CERO };
    const accPlataforma =
      plataformas.get(aporte.plataformaId) ??
      { vendidas: 0, absorbidas: 0, excluidas: 0, comisionadas: 0, pozo: CERO };

    acumulado.vendidas += 1;
    accPlataforma.vendidas += 1;
    pantallasVendidas += 1;

    if (aporte.excluida) {
      accPlataforma.excluidas += 1;
    } else if (aporte.absorbida) {
      acumulado.absorbidas += 1;
      accPlataforma.absorbidas += 1;
      pantallasAbsorbidas += 1;
    } else {
      acumulado.comisionadas += 1;
      acumulado.pozo = acumulado.pozo.plus(aporte.monto);
      accPlataforma.comisionadas += 1;
      accPlataforma.pozo = accPlataforma.pozo.plus(aporte.monto);
      pantallasComisionadas += 1;
      pozoTotal = pozoTotal.plus(aporte.monto);
    }

    periodos.set(clavePeriodo, acumulado);
    plataformas.set(aporte.plataformaId, accPlataforma);
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

  const porPlataforma: FilaPlataformaSimulacion[] = Array.from(plataformas.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([plataformaId, acc]) => ({
      plataformaId,
      pantallasVendidas: acc.vendidas,
      pantallasAbsorbidas: acc.absorbidas,
      pantallasExcluidas: acc.excluidas,
      pantallasComisionadas: acc.comisionadas,
      pozo: acc.pozo.toString(),
    }));

  return {
    pantallasVendidas,
    pantallasAbsorbidas,
    pantallasComisionadas,
    porcentajeComisionado: pantallasVendidas > 0 ? (pantallasComisionadas / pantallasVendidas) * 100 : 0,
    pozoTotal: pozoTotal.toString(),
    porPeriodo,
    porPlataforma,
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
    if (aporte.absorbida || aporte.excluida) continue;
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
 * vigente, y ninguna la recibe por body a diferencia de /simulacion.
 *
 * Incluye las excepciones por plataforma de esa versión (F6.10): al venir
 * ya en el `ConfiguracionVigente` que se spreadea como
 * `{ desde, hasta, ...configuracion }` en /mias, /resumen y
 * GET /panel-empleado, esos tres sitios siguen pasando por
 * aportesPantallasComisionables con las excepciones correctas sin tocar una
 * sola línea de esos archivos.
 */
export async function configuracionVigente(cliente: ClienteEmpresa): Promise<ConfiguracionVigente | null> {
  return cliente.configuracionComision.findFirst({
    where: { vigenteDesde: { lte: new Date() } },
    orderBy: { vigenteDesde: "desc" },
    select: {
      modo: true,
      valor: true,
      umbralCantidad: true,
      umbralAmbito: true,
      umbralPeriodo: true,
      excepciones: { select: { plataformaId: true, comisiona: true, modo: true, valor: true, umbralCantidad: true } },
    },
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
