// Migración de datos, idempotente: corrige empresas creadas ANTES de que el
// alta de empresa (src/routes/empresas.ts) sembrara sus plantillas de
// mensaje y sus tipos de cliente por defecto. Sin esto, esas empresas
// quedan atrapadas sin poder vender ("La empresa <id> no tiene una
// PlantillaMensaje...") y sin poder registrar un Precio (exige
// tipoClienteId).
//
// Correrla varias veces no duplica nada: cada plantilla se crea solo si
// falta ESE tipo exacto (UNIDAD/PAQUETE), y los tipos de cliente por
// defecto solo se crean si la empresa no tiene NINGUNO — una empresa que ya
// tiene al menos un tipo de cliente (aunque lo haya renombrado o
// desactivado) no está "sin ellos", así que se deja intacta.
import { PLANTILLA_PAQUETE_POR_DEFECTO, PLANTILLA_UNIDAD_POR_DEFECTO } from "../src/lib/plantillas-default.ts";
import { prismaRaw } from "../src/lib/prisma.ts";
import { datosSinEmpresa, prismaParaEmpresa } from "../src/lib/prisma-empresa.ts";
import { TIPOS_CLIENTE_POR_DEFECTO } from "../src/lib/tipos-cliente-default.ts";
import type { Prisma } from "../src/generated/prisma/client.ts";

async function main() {
  // prismaRaw: autorizado — Empresa no tiene empresaId (misma excepción que
  // src/routes/empresas.ts, ver prisma-raw-lista-blanca.test.ts).
  const empresas = await prismaRaw.empresa.findMany({ select: { id: true, nombre: true } });

  for (const empresa of empresas) {
    const cliente = prismaParaEmpresa(empresa.id);

    for (const tipo of ["UNIDAD", "PAQUETE"] as const) {
      const existente = await cliente.plantillaMensaje.findFirst({ where: { tipo } });
      if (existente) continue;

      const contenido = tipo === "UNIDAD" ? PLANTILLA_UNIDAD_POR_DEFECTO : PLANTILLA_PAQUETE_POR_DEFECTO;
      await cliente.plantillaMensaje.create({
        data: datosSinEmpresa<Prisma.PlantillaMensajeUncheckedCreateInput>({ tipo, contenido }),
      });
      console.log(`✔ ${empresa.nombre}: creada PlantillaMensaje ${tipo} faltante.`);
    }

    const tieneTiposCliente = (await cliente.tipoCliente.count()) > 0;
    if (!tieneTiposCliente) {
      for (const nombre of TIPOS_CLIENTE_POR_DEFECTO) {
        await cliente.tipoCliente.create({
          data: datosSinEmpresa<Prisma.TipoClienteUncheckedCreateInput>({ nombre }),
        });
      }
      console.log(`✔ ${empresa.nombre}: creados los ${TIPOS_CLIENTE_POR_DEFECTO.length} tipos de cliente por defecto.`);
    }
  }

  console.log(`Listo. ${empresas.length} empresas revisadas.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prismaRaw.$disconnect());
