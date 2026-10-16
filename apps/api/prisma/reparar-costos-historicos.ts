// Script de reparación, uno-solo-vez ("camino del dinero", punto 7) — NO es
// una migración, NO es un endpoint. Se corre una sola vez vía CLI de
// Railway, después de que el cliente carga sus costos reales en la matriz
// de precios. Ver src/lib/reparar-costos-historicos.ts para la lógica y el
// porqué de la excepción a R3 (CLAUDE.md).
//
// Modo simulación por defecto: imprime la tabla y NO escribe nada. Solo
// escribe en la base si se pasa --aplicar.
//
//   bun run prisma/reparar-costos-historicos.ts              (simulación)
//   bun run prisma/reparar-costos-historicos.ts --aplicar     (escribe)
import { repararCostosHistoricosDeEmpresa } from "../src/lib/reparar-costos-historicos.ts";
import { prismaRaw } from "../src/lib/prisma.ts";
import { prismaParaEmpresa } from "../src/lib/prisma-empresa.ts";

const aplicar = process.argv.includes("--aplicar");

function formatearFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

async function main() {
  // prismaRaw: autorizado — mismo caso que prisma/migrar-costo-plataforma.ts,
  // necesita listar TODAS las empresas para recorrerlas. La reparación en sí
  // usa siempre prismaParaEmpresa, nunca prismaRaw directo.
  const empresas = await prismaRaw.empresa.findMany({ select: { id: true, nombre: true } });

  console.log(
    aplicar
      ? "Modo --aplicar: esta corrida ESCRIBE en la base de datos."
      : "Modo simulación (por defecto): no se escribe nada. Volver a correr con --aplicar para aplicar los cambios.",
  );
  console.log(
    "Aviso: el costo usado es el de HOY (CostoPlataforma vigente), no el histórico real del día de " +
      "cada venta — ese dato nunca se cargó. Esto es una aproximación, no una recuperación real del " +
      "costo histórico.\n",
  );

  let totalReparadas = 0;
  let totalNoDeterminables = 0;

  for (const empresa of empresas) {
    const cliente = prismaParaEmpresa(empresa.id);
    const reporte = await repararCostosHistoricosDeEmpresa(cliente, { aplicar });
    if (reporte.reparadas.length === 0 && reporte.noDeterminables.length === 0) continue;

    console.log(`=== ${empresa.nombre} ===`);

    if (reporte.reparadas.length > 0) {
      console.log(`${reporte.reparadas.length} venta(s) ${aplicar ? "reparada(s)" : "a reparar"}:`);
      console.log(
        "  id".padEnd(27) +
          "código".padEnd(14) +
          "fecha".padEnd(12) +
          "costo antes".padEnd(14) +
          "costo después".padEnd(16) +
          "utilidad antes".padEnd(16) +
          "utilidad después",
      );
      for (const fila of reporte.reparadas) {
        console.log(
          `  ${fila.ventaId}`.padEnd(27) +
            fila.codigoCompra.padEnd(14) +
            formatearFecha(fila.fechaVenta).padEnd(12) +
            fila.costoAntes.padEnd(14) +
            fila.costoDespues.padEnd(16) +
            fila.utilidadAntes.padEnd(16) +
            fila.utilidadDespues,
        );
      }
    }

    if (reporte.noDeterminables.length > 0) {
      console.log(`${reporte.noDeterminables.length} venta(s) sin costo determinable (se dejan como están):`);
      for (const fila of reporte.noDeterminables) {
        console.log(`  - ${fila.codigoCompra} (${formatearFecha(fila.fechaVenta)}): ${fila.motivo}`);
      }
    }

    console.log("");
    totalReparadas += reporte.reparadas.length;
    totalNoDeterminables += reporte.noDeterminables.length;
  }

  console.log(
    `Total: ${totalReparadas} venta(s) ${aplicar ? "reparada(s)" : "reparable(s)"}, ` +
      `${totalNoDeterminables} sin costo determinable.`,
  );
  if (!aplicar && totalReparadas > 0) {
    console.log("Nada se escribió todavía. Correr de nuevo con --aplicar para aplicar los cambios de arriba.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prismaRaw.$disconnect());
