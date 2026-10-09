// Migración de datos, idempotente: construye la PlataformaPantalla inicial
// de cada plataforma a partir de la cuenta con más pantallas que ya exista
// (Parte 4 del encargo "plantilla de pantallas"). Sin esto, el admin no
// podría crear una cuenta nueva hasta configurar las 16 plataformas a mano.
//
// La lógica vive en src/lib/backfill-plataforma-pantalla.ts (así se puede
// probar directamente); este archivo solo recorre las empresas e imprime el
// reporte.
import { backfillPlataformaPantallaDeEmpresa } from "../src/lib/backfill-plataforma-pantalla.ts";
import { prismaRaw } from "../src/lib/prisma.ts";
import { prismaParaEmpresa } from "../src/lib/prisma-empresa.ts";

async function main() {
  // prismaRaw: autorizado — mismo caso que prisma/backfill-catalogo-base.ts,
  // necesita listar TODAS las empresas para recorrerlas. Cada operación de
  // negocio dentro del loop usa prismaParaEmpresa, nunca prismaRaw directo.
  const empresas = await prismaRaw.empresa.findMany({ select: { id: true, nombre: true } });

  let totalConPlantilla = 0;
  let totalSinPlantilla = 0;
  const todasDivergentes: { empresa: string; cuentaId: string; correo: string; nombrePlataforma: string; pantallasCuenta: number; pantallasPlantilla: number }[] = [];

  for (const empresa of empresas) {
    const cliente = prismaParaEmpresa(empresa.id);
    const reporte = await backfillPlataformaPantallaDeEmpresa(cliente);
    totalConPlantilla += reporte.plataformasConPlantilla;
    totalSinPlantilla += reporte.plataformasSinPlantilla;
    for (const d of reporte.cuentasDivergentes) {
      todasDivergentes.push({ empresa: empresa.nombre, ...d });
    }
    console.log(
      `✔ ${empresa.nombre}: ${reporte.plataformasConPlantilla} plataformas con plantilla, ${reporte.plataformasSinPlantilla} sin ella.`,
    );
  }

  console.log("");
  console.log(`Total: ${totalConPlantilla} plataformas con plantilla, ${totalSinPlantilla} sin ella.`);
  if (todasDivergentes.length === 0) {
    console.log("Ninguna cuenta diverge del número de pantallas que quedó en su plataforma.");
  } else {
    console.log(`${todasDivergentes.length} cuenta(s) con un número de pantallas distinto al de su plataforma:`);
    for (const d of todasDivergentes) {
      console.log(
        `  - [${d.empresa}] ${d.correo} (${d.nombrePlataforma}): cuenta tiene ${d.pantallasCuenta}, plantilla quedó en ${d.pantallasPlantilla}.`,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prismaRaw.$disconnect());
