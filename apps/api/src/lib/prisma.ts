import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// Cliente de Prisma SIN EXTENDER. Se usa en el seed, en el login (antes de
// conocer la empresa del usuario autenticado) y en las rutas de empresas que
// leen o escriben la tabla Empresa (que no tiene empresaId). Nunca en un
// handler de negocio (R1) — ahí va el cliente extendido con prismaParaEmpresa
// que inyecta empresaId automáticamente. La lista blanca completa vive en
// src/lib/prisma-raw-lista-blanca.test.ts.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prismaRaw = new PrismaClient({ adapter });
