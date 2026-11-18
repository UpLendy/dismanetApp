import type { Prisma } from "../generated/prisma/client.ts";
import { CARGOS_POR_DEFECTO } from "./cargos-default.ts";
import { datosSinEmpresa } from "./prisma-empresa.ts";

// Migración de datos, idempotente, para las empresas que ya existían antes
// de F6.1 (las nuevas los reciben en routes/empresas.ts al darse de alta).
//
// Por NOMBRE, no por "la empresa ya tiene algo": si el admin ya creó
// "Gerencia" a mano antes de correr esto, no se duplica; los otros cuatro
// igual se crean. Correr esto dos veces no cambia nada la segunda vez.

type ClienteEmpresa = Prisma.TransactionClient;

export interface ReporteMigracionCargosDefault {
  creados: string[];
  yaExistian: string[];
}

export async function migrarCargosDefaultDeEmpresa(
  cliente: ClienteEmpresa,
): Promise<ReporteMigracionCargosDefault> {
  const creados: string[] = [];
  const yaExistian: string[] = [];

  for (const nombre of CARGOS_POR_DEFECTO) {
    const existente = await cliente.cargo.findFirst({ where: { nombre }, select: { id: true } });
    if (existente) {
      yaExistian.push(nombre);
      continue;
    }

    await cliente.cargo.create({
      data: datosSinEmpresa<Prisma.CargoUncheckedCreateInput>({ nombre }),
    });
    creados.push(nombre);
  }

  return { creados, yaExistian };
}
