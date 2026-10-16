// Migración de datos, idempotente: copia el costo de Precio (que hoy varía
// por tipo de cliente, aunque el costo real de una pantalla no depende de
// eso) a CostoPlataforma (una fila por plataforma+duración). Parte 1 del
// encargo "camino del dinero".
//
// La lógica vive en src/lib/migrar-costo-plataforma.ts (así se puede probar
// directamente); este archivo solo recorre las empresas e imprime el
// reporte.
import { migrarCostoPlataformaDeEmpresa } from "../src/lib/migrar-costo-plataforma.ts";
import { prismaRaw } from "../src/lib/prisma.ts";
import { prismaParaEmpresa } from "../src/lib/prisma-empresa.ts";

async function main() {
  // prismaRaw: autorizado — mismo caso que prisma/backfill-catalogo-base.ts,
  // necesita listar TODAS las empresas para recorrerlas. Cada operación de
  // negocio dentro del loop usa prismaParaEmpresa, nunca prismaRaw directo.
  const empresas = await prismaRaw.empresa.findMany({ select: { id: true, nombre: true } });

  let totalConCosto = 0;
  const todosSinCosto: { empresa: string; nombrePlataforma: string; nombreDuracion: string }[] = [];

  for (const empresa of empresas) {
    const cliente = prismaParaEmpresa(empresa.id);
    const reporte = await migrarCostoPlataformaDeEmpresa(cliente);
    totalConCosto += reporte.paresConCosto;
    for (const p of reporte.paresSinCosto) {
      todosSinCosto.push({ empresa: empresa.nombre, nombrePlataforma: p.nombrePlataforma, nombreDuracion: p.nombreDuracion });
    }
    console.log(
      `✔ ${empresa.nombre}: ${reporte.paresConCosto} pares plataforma+duración con costo, ${reporte.paresSinCosto.length} sin él.`,
    );
  }

  console.log("");
  console.log(`Total: ${totalConCosto} pares plataforma+duración con costo registrado.`);
  if (todosSinCosto.length === 0) {
    console.log("Ningún par quedó sin costo.");
  } else {
    console.log(`${todosSinCosto.length} par(es) sin costo — el cliente debe cargarlos a mano en la matriz de precios:`);
    for (const p of todosSinCosto) {
      console.log(`  - [${p.empresa}] ${p.nombrePlataforma} / ${p.nombreDuracion}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prismaRaw.$disconnect());
