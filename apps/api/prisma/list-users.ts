import { prismaRaw as prisma } from "../src/lib/prisma.js";

async function main() {
  const users = await prisma.usuario.findMany({
    select: { email: true, rol: true, id: true }
  });
  console.log(JSON.stringify(users, null, 2));
}

main().finally(() => prisma.$disconnect());
