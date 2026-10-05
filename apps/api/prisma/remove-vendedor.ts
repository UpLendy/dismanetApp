import { prismaRaw as prisma } from "../src/lib/prisma.js";

async function main() {
  console.log("Buscando vendedor...");
  const vendedorEmail = "vendedor@uplendy.com";
  
  const vendedor = await prisma.usuario.findUnique({ where: { email: vendedorEmail } });
  if (vendedor) {
    await prisma.usuario.delete({ where: { id: vendedor.id } });
    console.log(`Vendedor ${vendedorEmail} eliminado exitosamente.`);
  } else {
    console.log("Vendedor no encontrado.");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
