// Migración de datos, idempotente: siembra los cinco cargos por defecto
// (Gerencia, Coordinación, Soporte técnico, Seguimiento, Asesores
// comerciales) en las empresas que ya existían antes de F6.1. Las empresas
// nuevas los reciben directamente en routes/empresas.ts.
//
// La lógica vive en src/lib/migrar-cargos-default.ts (así se puede probar
// directamente); este archivo solo recorre las empresas e imprime el
// reporte.
import { migrarCargosDefaultDeEmpresa } from "../src/lib/migrar-cargos-default.ts";
import { prismaRaw } from "../src/lib/prisma.ts";
import { prismaParaEmpresa } from "../src/lib/prisma-empresa.ts";

async function main() {
  // prismaRaw: autorizado — mismo caso que prisma/migrar-costo-plataforma.ts,
  // necesita listar TODAS las empresas para recorrerlas. Cada operación de
  // negocio dentro del loop usa prismaParaEmpresa, nunca prismaRaw directo.
  const empresas = await prismaRaw.empresa.findMany({ select: { id: true, nombre: true } });

  let totalCreados = 0;

  for (const empresa of empresas) {
    const cliente = prismaParaEmpresa(empresa.id);
    const reporte = await migrarCargosDefaultDeEmpresa(cliente);
    totalCreados += reporte.creados.length;
    console.log(
      `✔ ${empresa.nombre}: ${reporte.creados.length} cargo(s) creado(s), ${reporte.yaExistian.length} ya existían.`,
    );
  }

  console.log("");
  console.log(`Total: ${totalCreados} cargo(s) creado(s) en ${empresas.length} empresa(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prismaRaw.$disconnect());
