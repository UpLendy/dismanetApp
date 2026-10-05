const MAX_INTENTOS = 5;

/** Subconjunto del cliente de Prisma que esta función necesita, para poder recibir tanto el cliente normal como un cliente de transacción (tx). */
export interface ClienteConVentas {
  venta: {
    findUnique(args: {
      where: { empresaId_codigoCompra: { empresaId: string; codigoCompra: string } };
    }): Promise<unknown>;
  };
}

function generarSufijo(): string {
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
}

/**
 * Genera el código de compra de una venta: prefijoCodigo (3 letras) + seis
 * dígitos aleatorios, ej. DIS995865. Verifica unicidad contra
 * (empresaId, codigoCompra) usando el cliente de transacción recibido y
 * reintenta hasta 5 veces si colisiona. Nunca devuelve un código duplicado:
 * si agota los intentos, lanza un error.
 */
export async function generarCodigoCompra(
  tx: ClienteConVentas,
  empresaId: string,
  prefijoCodigo: string,
): Promise<string> {
  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    const codigoCompra = `${prefijoCodigo}${generarSufijo()}`;
    const existente = await tx.venta.findUnique({
      where: { empresaId_codigoCompra: { empresaId, codigoCompra } },
    });
    if (!existente) return codigoCompra;
  }
  // El empresaId solo va al registro del servidor: este mensaje puede llegar
  // sin más tratamiento hasta el usuario (ver plugins/errores.ts).
  console.error(`[codigo-compra] sin código único para la empresa ${empresaId} tras ${MAX_INTENTOS} intentos`);
  throw new Error(`No se pudo generar un código de compra único tras ${MAX_INTENTOS} intentos. Intenta de nuevo.`);
}
