import type { Prisma } from "../generated/prisma/client.ts";
import { datosSinEmpresa } from "./prisma-empresa.ts";

// Migración de datos ("camino del dinero"): el costo deja de depender del
// tipo de cliente y pasa de Precio.costo (una fila por cada tipo de
// cliente) a CostoPlataforma (una sola fila por plataforma+duración).
//
// Para cada combinación activa de plataforma y duración, toma el MAYOR
// Precio.costo registrado entre sus tipos de cliente (costo > 0) y lo copia
// a CostoPlataforma. Si ninguno tenía costo, el par queda sin costo y se
// reporta para que el cliente lo cargue a mano en la matriz de precios.
//
// Idempotente: un par que YA tiene una fila en CostoPlataforma (de una
// corrida anterior de este script, o cargada a mano por el admin) nunca se
// sobrescribe — correr esto dos veces no cambia nada la segunda vez.

type ClienteEmpresa = Prisma.TransactionClient;

export interface ParSinCosto {
  plataformaId: string;
  nombrePlataforma: string;
  duracionId: string;
  nombreDuracion: string;
}

export interface ReporteMigracionCostoPlataforma {
  paresConCosto: number;
  paresSinCosto: ParSinCosto[];
}

export async function migrarCostoPlataformaDeEmpresa(
  cliente: ClienteEmpresa,
): Promise<ReporteMigracionCostoPlataforma> {
  const [plataformas, duraciones, precios] = await Promise.all([
    cliente.plataforma.findMany({ where: { activa: true }, select: { id: true, nombre: true } }),
    cliente.duracion.findMany({ where: { activa: true }, select: { id: true, nombre: true } }),
    cliente.precio.findMany({
      where: { plataformaId: { not: null } },
      select: { plataformaId: true, duracionId: true, costo: true },
    }),
  ]);

  const mayorCostoPorClave = new Map<string, Prisma.Decimal>();
  for (const precio of precios) {
    if (!precio.plataformaId || !precio.costo.greaterThan(0)) continue;
    const clave = `${precio.plataformaId}|${precio.duracionId}`;
    const actual = mayorCostoPorClave.get(clave);
    if (!actual || precio.costo.greaterThan(actual)) mayorCostoPorClave.set(clave, precio.costo);
  }

  let paresConCosto = 0;
  const paresSinCosto: ParSinCosto[] = [];

  for (const plataforma of plataformas) {
    for (const duracion of duraciones) {
      const yaExiste = await cliente.costoPlataforma.findFirst({
        where: { plataformaId: plataforma.id, duracionId: duracion.id },
        select: { id: true },
      });
      if (yaExiste) {
        paresConCosto++;
        continue;
      }

      const costo = mayorCostoPorClave.get(`${plataforma.id}|${duracion.id}`);
      if (costo === undefined) {
        paresSinCosto.push({
          plataformaId: plataforma.id,
          nombrePlataforma: plataforma.nombre,
          duracionId: duracion.id,
          nombreDuracion: duracion.nombre,
        });
        continue;
      }

      await cliente.costoPlataforma.create({
        data: datosSinEmpresa<Prisma.CostoPlataformaUncheckedCreateInput>({
          plataformaId: plataforma.id,
          duracionId: duracion.id,
          costo,
        }),
      });
      paresConCosto++;
    }
  }

  return { paresConCosto, paresSinCosto };
}
