import { prismaRaw as prisma } from "../src/lib/prisma.js";

async function main() {
  console.log("Iniciando limpieza...");

  // Borrar todas las pantallas y cuentas
  const deletedPantallas = await prisma.pantalla.deleteMany({});
  console.log(`Pantallas eliminadas: ${deletedPantallas.count}`);

  const deletedCuentas = await prisma.cuenta.deleteMany({});
  console.log(`Cuentas eliminadas: ${deletedCuentas.count}`);

  // Borrar Pornhub
  const pornhub = await prisma.plataforma.findFirst({ where: { nombre: "Pornhub" } });
  if (pornhub) {
    await prisma.precio.deleteMany({ where: { plataformaId: pornhub.id } });
    await prisma.paqueteDuracionPlataforma.deleteMany({ where: { plataformaId: pornhub.id } });
    await prisma.paquetePlataforma.deleteMany({ where: { plataformaId: pornhub.id } });
    await prisma.plataforma.delete({ where: { id: pornhub.id } });
    console.log("Plataforma Pornhub y sus dependencias eliminadas.");
  } else {
    console.log("Pornhub no se encontró.");
  }

  console.log("Limpieza terminada.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
