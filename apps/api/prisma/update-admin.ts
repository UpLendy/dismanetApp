import { prismaRaw as prisma } from "../src/lib/prisma.js";
import argon2 from "argon2";

async function main() {
  const adminAnterior = "admin-sucursal@uplendy.com";
  const nuevoEmail = "admin@dismanet.com";
  const nuevaClave = "AdminDismanet#2026";
  
  const usuario = await prisma.usuario.findUnique({ where: { email: adminAnterior } });
  if (usuario) {
    const passwordHash = await argon2.hash(nuevaClave, { type: argon2.argon2id });
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { 
        email: nuevoEmail,
        passwordHash: passwordHash
      }
    });
    console.log(`Usuario actualizado a: ${nuevoEmail} con clave ${nuevaClave}`);
  } else {
    console.log("No se encontró el admin anterior.");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
