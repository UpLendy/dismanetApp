/**
 * F6.8 — Registro de visualización de video.
 *
 * ADVERTENCIA PARA QUIEN LEA ESTO DENTRO DE UN AÑO: nada de lo que hay aquí
 * es una prueba de que alguien vio un video. Todo lo que reporta el
 * navegador (tramos reproducidos, eventos de pausa, de fin) se puede
 * falsificar por completo desde las herramientas de desarrollador, y no hay
 * forma de verificarlo del lado del servidor. No existe tal cosa como
 * "verificar visualización" y este módulo no lo intenta.
 *
 * Lo que sí hace: subir el costo de hacer trampa de "cero esfuerzo"
 * (arrastrar la barra al final) a "manipulación deliberada" (simular tráfico
 * de red con el reloj correcto durante toda la duración del video). Dos
 * mecanismos:
 *
 *  1. Se guardan TRAMOS CUBIERTOS, no la posición máxima alcanzada —
 *     `fusionarTramos`/`segundosCubiertos` — para que arrastrar la barra no
 *     complete nada.
 *  2. CONTROL DE RELOJ EN EL SERVIDOR — `recortarPorPresupuesto` — que acota
 *     la cobertura nueva que se acredita en cada reporte al tiempo real
 *     transcurrido (×2) desde el reporte anterior. Este es el único control
 *     que de verdad importa, porque vive aquí y no en el navegador.
 */

export type Tramo = [number, number];

/** Un cliente manipulado que manda cientos de fragmentos sueltos se rechaza en vez de crecer sin límite. */
export const MAXIMO_TRAMOS = 50;

/** Fusiona tramos solapados o adyacentes. Ordena por inicio; una pasada. */
export function fusionarTramos(tramos: Tramo[]): Tramo[] {
  const ordenados = [...tramos].sort((a, b) => a[0] - b[0]);
  const fusionados: Tramo[] = [];
  for (const [inicio, fin] of ordenados) {
    const ultimo = fusionados[fusionados.length - 1];
    if (ultimo && inicio <= ultimo[1]) {
      ultimo[1] = Math.max(ultimo[1], fin);
    } else {
      fusionados.push([inicio, fin]);
    }
  }
  return fusionados;
}

/** Suma de anchos de los tramos. Se asume ya fusionados (si no, puede inflar). */
export function segundosCubiertos(tramos: Tramo[]): number {
  return tramos.reduce((total, [inicio, fin]) => total + (fin - inicio), 0);
}

/**
 * Recorta `hasta` de forma que la cobertura NUEVA que aporta [desde, hasta]
 * sobre `existentes` (ya fusionados y ordenados) nunca exceda `presupuesto`
 * segundos. El exceso se recorta por la cola, nunca se rechaza el reporte
 * completo por esto — Parte 1.2 de PROMPT-F6.8.
 */
export function recortarPorPresupuesto(existentes: Tramo[], desde: number, hasta: number, presupuesto: number): number {
  if (presupuesto <= 0) return desde;
  let cursor = desde;
  let restante = presupuesto;

  for (const [inicioExistente, finExistente] of existentes) {
    if (finExistente <= cursor) continue;
    if (inicioExistente >= hasta) break;

    const huecoFin = Math.min(inicioExistente, hasta);
    if (huecoFin > cursor) {
      const anchoHueco = huecoFin - cursor;
      if (anchoHueco > restante) return cursor + restante;
      restante -= anchoHueco;
    }
    cursor = Math.max(cursor, Math.min(finExistente, hasta));
    if (cursor >= hasta) return hasta;
  }

  const anchoHuecoFinal = hasta - cursor;
  if (anchoHuecoFinal > restante) return cursor + restante;
  return hasta;
}

export interface EstadoVisualizacion {
  tramos: Tramo[];
  segundosVistos: number;
  primerReporte: Date;
  ultimoReporte: Date;
  completadoEn: Date | null;
}

export type ResultadoProgreso = { ok: true; estado: EstadoVisualizacion; cobertura: number } | { ok: false; razon: "DEMASIADOS_TRAMOS" };

/**
 * Aplica un reporte de progreso [desde, hasta] (segundos del video) a un
 * estado previo (null si es el primer reporte de este archivo+usuario).
 *
 * El control de reloj (1.2) no se aplica en el primer reporte: no hay
 * `ultimoReporte` contra el cual medir tiempo transcurrido. Es seguro no
 * aplicarlo ahí porque la otra condición de cumplimiento (1.3, tiempo real
 * acumulado desde `primerReporte` ≥ 90%) es necesariamente 0 en esa misma
 * llamada — un primer reporte generoso no puede completar nada por sí solo.
 */
export function aplicarProgreso(params: {
  estadoPrevio: EstadoVisualizacion | null;
  desde: number;
  hasta: number;
  ahora: Date;
  duracionSegundos: number | null;
}): ResultadoProgreso {
  const { estadoPrevio, ahora, duracionSegundos } = params;

  const tope = duracionSegundos && duracionSegundos > 0 ? duracionSegundos : Infinity;
  const desde = Math.max(0, Math.min(params.desde, tope));
  const hastaSolicitado = Math.max(desde, Math.min(params.hasta, tope));

  const existentes = estadoPrevio ? estadoPrevio.tramos : [];

  let hastaAcreditado = hastaSolicitado;
  if (estadoPrevio) {
    const segundosReloj = Math.max(0, (ahora.getTime() - estadoPrevio.ultimoReporte.getTime()) / 1000);
    const presupuesto = segundosReloj * 2;
    hastaAcreditado = recortarPorPresupuesto(existentes, desde, hastaSolicitado, presupuesto);
  }

  const tramosFusionados = fusionarTramos([...existentes, [desde, hastaAcreditado]]);
  if (tramosFusionados.length > MAXIMO_TRAMOS) {
    return { ok: false, razon: "DEMASIADOS_TRAMOS" };
  }

  const segundosVistos = segundosCubiertos(tramosFusionados);
  const primerReporte = estadoPrevio ? estadoPrevio.primerReporte : ahora;

  const cobertura = duracionSegundos && duracionSegundos > 0 ? Math.min(1, segundosVistos / duracionSegundos) : 0;
  const tiempoRealAcumulado = (ahora.getTime() - primerReporte.getTime()) / 1000;

  const yaCompletado = estadoPrevio?.completadoEn ?? null;
  const seCompletaAhora =
    !yaCompletado &&
    duracionSegundos !== null &&
    duracionSegundos > 0 &&
    cobertura >= 0.95 &&
    tiempoRealAcumulado >= 0.9 * duracionSegundos;

  return {
    ok: true,
    cobertura,
    estado: {
      tramos: tramosFusionados,
      segundosVistos,
      primerReporte,
      ultimoReporte: ahora,
      completadoEn: yaCompletado ?? (seCompletaAhora ? ahora : null),
    },
  };
}
