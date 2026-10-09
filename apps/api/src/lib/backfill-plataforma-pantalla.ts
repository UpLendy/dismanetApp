import type { Prisma } from "../generated/prisma/client.ts";
import { datosSinEmpresa } from "./prisma-empresa.ts";

// Migración de datos (Parte 4 del encargo "plantilla de pantallas"):
// construye la PlataformaPantalla inicial de cada plataforma a partir de las
// cuentas que ya existen, para que el cliente no tenga que configurar las 16
// plataformas a mano antes de poder crear una cuenta nueva.
//
// Idempotente: una plataforma que YA tiene al menos una fila de
// PlataformaPantalla se deja intacta, sin importar si esa fila la puso una
// corrida anterior de este script o un ADMIN editándola a mano — nunca se
// sobrescribe una plantilla existente.
//
// Nunca borra ni modifica una Pantalla existente: solo LEE las pantallas de
// la cuenta representativa para copiar numero/perfil/pin a la plantilla.

type ClienteEmpresa = Prisma.TransactionClient;

export interface CuentaDivergente {
  cuentaId: string;
  correo: string;
  plataformaId: string;
  nombrePlataforma: string;
  pantallasCuenta: number;
  pantallasPlantilla: number;
}

export interface ReporteBackfillPlataformaPantalla {
  plataformasConPlantilla: number;
  plataformasSinPlantilla: number;
  cuentasDivergentes: CuentaDivergente[];
}

/**
 * Corre el backfill dentro de UNA empresa (el `cliente` ya viene acotado por
 * prismaParaEmpresa). El llamador (prisma/backfill-plataforma-pantalla.ts)
 * recorre todas las empresas y llama esto una vez por cada una.
 */
export async function backfillPlataformaPantallaDeEmpresa(
  cliente: ClienteEmpresa,
): Promise<ReporteBackfillPlataformaPantalla> {
  const plataformas = await cliente.plataforma.findMany({ select: { id: true, nombre: true } });

  for (const plataforma of plataformas) {
    const yaConfigurada = (await cliente.plataformaPantalla.count({ where: { plataformaId: plataforma.id } })) > 0;
    if (yaConfigurada) continue;

    const cuentas = await cliente.cuenta.findMany({ where: { plataformaId: plataforma.id }, select: { id: true } });
    if (cuentas.length === 0) continue;

    const pantallasPorCuenta = await Promise.all(
      cuentas.map((c) => cliente.pantalla.findMany({ where: { cuentaId: c.id }, orderBy: { numero: "asc" } })),
    );

    let representativa = pantallasPorCuenta[0]!;
    for (const pantallas of pantallasPorCuenta) {
      if (pantallas.length > representativa.length) representativa = pantallas;
    }
    if (representativa.length === 0) continue;

    await cliente.plataformaPantalla.createMany({
      data: representativa.map((p) =>
        datosSinEmpresa<Prisma.PlataformaPantallaCreateManyInput>({
          plataformaId: plataforma.id,
          numero: p.numero,
          perfil: p.perfil,
          pin: p.pin,
        }),
      ),
    });
    await cliente.plataforma.update({
      where: { id: plataforma.id },
      data: { capacidadPantallas: representativa.length },
    });
  }

  let plataformasConPlantilla = 0;
  let plataformasSinPlantilla = 0;
  for (const plataforma of plataformas) {
    const cantidad = await cliente.plataformaPantalla.count({ where: { plataformaId: plataforma.id } });
    if (cantidad > 0) plataformasConPlantilla++;
    else plataformasSinPlantilla++;
  }

  const plataformasFinal = await cliente.plataforma.findMany({
    select: { id: true, nombre: true, capacidadPantallas: true },
  });
  const porId = new Map(plataformasFinal.map((p) => [p.id, p]));
  const cuentasTodas = await cliente.cuenta.findMany({
    select: { id: true, correo: true, plataformaId: true, capacidadPantallas: true },
  });
  const cuentasDivergentes: CuentaDivergente[] = cuentasTodas
    .filter((c) => porId.get(c.plataformaId)?.capacidadPantallas !== c.capacidadPantallas)
    .map((c) => {
      const plataforma = porId.get(c.plataformaId)!;
      return {
        cuentaId: c.id,
        correo: c.correo,
        plataformaId: c.plataformaId,
        nombrePlataforma: plataforma.nombre,
        pantallasCuenta: c.capacidadPantallas,
        pantallasPlantilla: plataforma.capacidadPantallas,
      };
    });

  return { plataformasConPlantilla, plataformasSinPlantilla, cuentasDivergentes };
}
