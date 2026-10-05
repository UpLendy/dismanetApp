// Seed idempotente: correrlo varias veces no duplica ni falla.
//
// Usa el cliente de Prisma SIN EXTENDER (R1: prismaRaw solo se usa en el
// seed y en el login, nunca en un handler de negocio).
import argon2 from "argon2";
import { cifrar } from "../src/lib/cifrado.js";
import { credencialSeed } from "../src/lib/credenciales-seed.js";
import { letraPerfil, pinAleatorio } from "../src/lib/pantallas.js";
import { PLANTILLA_PAQUETE_POR_DEFECTO, PLANTILLA_UNIDAD_POR_DEFECTO } from "../src/lib/plantillas-default.js";
import { prismaRaw as prisma } from "../src/lib/prisma.js";
import { TIPOS_CLIENTE_POR_DEFECTO } from "../src/lib/tipos-cliente-default.js";

function slug(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

async function obtenerOCrearPorNombre<T extends { id: string }>(
  buscar: () => Promise<T | null>,
  crear: () => Promise<T>,
): Promise<T> {
  const existente = await buscar();
  if (existente) return existente;
  return crear();
}

// ---------------------------------------------------------------------------
// Anexo A.1 — Duraciones
// ---------------------------------------------------------------------------
const DURACIONES = [
  { nombre: "14 días", cantidad: 14, unidad: "DIAS" as const },
  { nombre: "28 días", cantidad: 28, unidad: "DIAS" as const },
  { nombre: "30 días", cantidad: 30, unidad: "DIAS" as const },
  { nombre: "1 mes", cantidad: 1, unidad: "MESES" as const },
  { nombre: "2 meses", cantidad: 2, unidad: "MESES" as const },
  { nombre: "3 meses", cantidad: 3, unidad: "MESES" as const },
  { nombre: "1 año", cantidad: 12, unidad: "MESES" as const },
];

// ---------------------------------------------------------------------------
// Anexo A.2 — Plataformas
// capacidadPantallas: el catálogo real de DISMANET no trae este dato (PRD
// sección 11, insumo "Faltante", bloqueante para la entrega 7). Los valores
// de abajo son PROVISIONALES, a falta de la cifra real del cliente, solo
// para tener inventario suficiente donde correr las pruebas de concurrencia
// de la entrega 8. El admin las corrige en cuanto DISMANET confirme.
// ---------------------------------------------------------------------------
const PLATAFORMAS = [
  { nombre: "Netflix", condiciones: "1 pantalla", usaPerfilPin: true, capacidadPantallas: 5 },
  {
    nombre: "Disney+ Premium",
    condiciones: "1 pantalla, solo TV. Incluye ESPN y Hulu",
    usaPerfilPin: true,
    capacidadPantallas: 4,
  },
  { nombre: "Prime Video", condiciones: "1 pantalla", usaPerfilPin: true, capacidadPantallas: 3 },
  { nombre: "Max", condiciones: "1 pantalla", usaPerfilPin: true, capacidadPantallas: 3 },
  { nombre: "Win+ + IPTV", condiciones: null, usaPerfilPin: false, capacidadPantallas: 1 },
  { nombre: "YouTube Premium", condiciones: null, usaPerfilPin: false, capacidadPantallas: 1 },
  { nombre: "Canva", condiciones: "Con correo personal", usaPerfilPin: false, capacidadPantallas: 1 },
  { nombre: "DIRECTV GO", condiciones: null, usaPerfilPin: false, capacidadPantallas: 1 },
  { nombre: "Plex", condiciones: null, usaPerfilPin: false, capacidadPantallas: 1 },
  { nombre: "Crunchyroll", condiciones: null, usaPerfilPin: false, capacidadPantallas: 1 },
  { nombre: "Paramount+", condiciones: null, usaPerfilPin: true, capacidadPantallas: 6 },
  { nombre: "ViX", condiciones: null, usaPerfilPin: false, capacidadPantallas: 1 },
  { nombre: "Spotify", condiciones: null, usaPerfilPin: false, capacidadPantallas: 1 },
  { nombre: "Viki Rakuten", condiciones: null, usaPerfilPin: false, capacidadPantallas: 1 },
  { nombre: "DramaBox", condiciones: null, usaPerfilPin: false, capacidadPantallas: 1 },
];

// ---------------------------------------------------------------------------
// Anexo A.3 — Precios de plataformas individuales, tipo de cliente
// "Cliente normal". El costo va en 0: el cliente todavía no entregó la tabla
// de costos (PRD sección 11, insumo "Faltante" y bloqueante para utilidad).
//
// Prime Video y Max se OMITEN aquí a propósito: el PRD marca su duración
// individual como "por confirmar" (anexo A.3) y section 11 lo lista como
// bloqueante solo para esos dos precios. No se inventa una duración.
// ---------------------------------------------------------------------------
const PRECIOS_INDIVIDUALES: Array<[plataforma: string, duracion: string, precioVenta: number]> = [
  ["Netflix", "14 días", 7900],
  ["Netflix", "28 días", 10900],
  ["Netflix", "30 días", 11400],
  ["Disney+ Premium", "30 días", 10900],
  ["Win+ + IPTV", "2 meses", 16900],
  ["YouTube Premium", "30 días", 10900],
  ["Canva", "1 año", 15900],
  ["DIRECTV GO", "30 días", 14900],
  ["Plex", "30 días", 8900],
  ["Crunchyroll", "30 días", 8900],
  ["Paramount+", "30 días", 8900],
  ["ViX", "30 días", 8900],
  ["Spotify", "3 meses", 26900],
  ["Viki Rakuten", "1 mes", 10900],
  ["DramaBox", "30 días", 8900],
];

// ---------------------------------------------------------------------------
// Anexo A.4 — Paquetes y su composición (todos con 1 pantalla por plataforma)
// ---------------------------------------------------------------------------
const PAQUETES: Array<{ nombre: string; plataformas: string[] }> = [
  { nombre: "Básico 1", plataformas: ["Netflix", "Disney+ Premium"] },
  { nombre: "Básico 2", plataformas: ["Netflix", "Prime Video"] },
  { nombre: "Básico 3", plataformas: ["Netflix", "Max"] },
  { nombre: "Ya 1", plataformas: ["Max", "Disney+ Premium", "Prime Video"] },
  {
    nombre: "Especial 1",
    plataformas: ["Netflix", "Disney+ Premium", "Prime Video"],
  },
  {
    nombre: "Bacano",
    plataformas: ["Netflix", "Disney+ Premium", "Prime Video", "Max"],
  },
];

// ---------------------------------------------------------------------------
// Anexo A.5 — Precios de paquete, tipo de cliente "Cliente normal", con la
// excepción de duración "Netflix → 28 días" en los combos de 30 días (5 en
// total). Costo en 0 por la misma razón que los precios individuales.
// ---------------------------------------------------------------------------
const PRECIOS_PAQUETE: Array<
  [paquete: string, duracionVendida: string, precioVenta: number, excepcionNetflix: string | null]
> = [
  ["Básico 1", "14 días", 16700, null],
  ["Básico 1", "30 días", 19900, "28 días"],
  ["Básico 2", "28 días", 14200, null],
  ["Básico 2", "30 días", 14900, "28 días"],
  ["Básico 3", "28 días", 14200, null],
  ["Básico 3", "30 días", 14900, "28 días"],
  ["Ya 1", "30 días", 19900, null],
  ["Especial 1", "28 días", 18900, null],
  ["Especial 1", "30 días", 19900, "28 días"],
  ["Bacano", "28 días", 25200, null],
  ["Bacano", "30 días", 25900, "28 días"],
];

const TIPOS_CLIENTE = TIPOS_CLIENTE_POR_DEFECTO;

async function main() {
  // -- SUPER_ADMIN (empresaId nulo) -----------------------------------------
  const superAdminEmail = credencialSeed("SEED_SUPERADMIN_EMAIL", "admin@plataforma.local");
  const superAdminPassword = credencialSeed("SEED_SUPERADMIN_PASSWORD", "cambiar-en-produccion");

  const superAdmin = await prisma.usuario.upsert({
    where: { email: superAdminEmail },
    update: {},
    create: {
      email: superAdminEmail,
      passwordHash: await argon2.hash(superAdminPassword, { type: argon2.argon2id }),
      nombre: "Super Admin",
      rol: "SUPER_ADMIN",
      empresaId: null,
    },
  });
  console.log(`✔ SUPER_ADMIN: ${superAdmin.email}`);

  // -- Empresa DISMANET ------------------------------------------------------
  const empresa = await obtenerOCrearPorNombre(
    () => prisma.empresa.findFirst({ where: { nombre: "DISMANET" } }),
    () =>
      prisma.empresa.create({
        data: {
          nombre: "DISMANET",
          prefijoCodigo: "DIS",
          activa: true,
          creadaPorUsuarioId: superAdmin.id,
        },
      }),
  );
  console.log(`✔ Empresa: ${empresa.nombre} (${empresa.prefijoCodigo})`);

  // -- ADMIN y VENDEDOR de DISMANET ------------------------------------------
  const adminEmail = credencialSeed("SEED_ADMIN_EMAIL", "admin@dismanet.local");
  const adminPassword = credencialSeed("SEED_ADMIN_PASSWORD", "DismanetAdmin#2026");
  const admin = await prisma.usuario.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }),
      nombre: "Administrador DISMANET",
      rol: "ADMIN",
      empresaId: empresa.id,
    },
  });
  console.log(`✔ ADMIN: ${admin.email}`);

  const vendedorEmail = credencialSeed("SEED_VENDEDOR_EMAIL", "vendedor@dismanet.local");
  const vendedorPassword = credencialSeed("SEED_VENDEDOR_PASSWORD", "DismanetVendedor#2026");
  const vendedor = await prisma.usuario.upsert({
    where: { email: vendedorEmail },
    update: {},
    create: {
      email: vendedorEmail,
      passwordHash: await argon2.hash(vendedorPassword, { type: argon2.argon2id }),
      nombre: "Vendedor DISMANET",
      rol: "VENDEDOR",
      empresaId: empresa.id,
    },
  });
  console.log(`✔ VENDEDOR: ${vendedor.email}`);

  // -- Tipos de cliente --------------------------------------------------------
  const tipoClientePorNombre = new Map<string, { id: string }>();
  for (const nombre of TIPOS_CLIENTE) {
    const tipo = await obtenerOCrearPorNombre(
      () => prisma.tipoCliente.findFirst({ where: { empresaId: empresa.id, nombre } }),
      () => prisma.tipoCliente.create({ data: { empresaId: empresa.id, nombre } }),
    );
    tipoClientePorNombre.set(nombre, tipo);
  }
  console.log(`✔ Tipos de cliente: ${TIPOS_CLIENTE.join(", ")}`);

  // -- Duraciones (A.1) --------------------------------------------------------
  const duracionPorNombre = new Map<string, { id: string }>();
  for (const d of DURACIONES) {
    const duracion = await obtenerOCrearPorNombre(
      () => prisma.duracion.findFirst({ where: { empresaId: empresa.id, nombre: d.nombre } }),
      () =>
        prisma.duracion.create({
          data: { empresaId: empresa.id, nombre: d.nombre, cantidad: d.cantidad, unidad: d.unidad },
        }),
    );
    duracionPorNombre.set(d.nombre, duracion);
  }
  console.log(`✔ Duraciones: ${DURACIONES.length}`);

  // -- Plataformas (A.2) --------------------------------------------------------
  const plataformaPorNombre = new Map<string, { id: string; usaPerfilPin: boolean; capacidadPantallas: number }>();
  for (const p of PLATAFORMAS) {
    const plataforma = await obtenerOCrearPorNombre(
      () => prisma.plataforma.findFirst({ where: { empresaId: empresa.id, nombre: p.nombre } }),
      () =>
        prisma.plataforma.create({
          data: {
            empresaId: empresa.id,
            nombre: p.nombre,
            condiciones: p.condiciones,
            usaPerfilPin: p.usaPerfilPin,
            capacidadPantallas: p.capacidadPantallas,
          },
        }),
    );
    plataformaPorNombre.set(p.nombre, plataforma);
  }
  console.log(`✔ Plataformas: ${PLATAFORMAS.length}`);

  // -- Precios individuales (A.3) ------------------------------------------
  const tipoClienteNormal = tipoClientePorNombre.get("Cliente normal")!;
  for (const [nombrePlataforma, nombreDuracion, precioVenta] of PRECIOS_INDIVIDUALES) {
    const plataforma = plataformaPorNombre.get(nombrePlataforma)!;
    const duracion = duracionPorNombre.get(nombreDuracion)!;
    await prisma.precio.upsert({
      where: {
        empresaId_plataformaId_duracionId_tipoClienteId: {
          empresaId: empresa.id,
          plataformaId: plataforma.id,
          duracionId: duracion.id,
          tipoClienteId: tipoClienteNormal.id,
        },
      },
      update: {},
      create: {
        empresaId: empresa.id,
        plataformaId: plataforma.id,
        duracionId: duracion.id,
        tipoClienteId: tipoClienteNormal.id,
        precioVenta,
        costo: 0, // Costos pendientes de recibir de DISMANET (PRD sección 11).
      },
    });
  }
  console.log(`✔ Precios individuales: ${PRECIOS_INDIVIDUALES.length}`);

  // -- Paquetes y su composición (A.4) --------------------------------------
  const paquetePorNombre = new Map<string, { id: string }>();
  for (const paq of PAQUETES) {
    const paquete = await obtenerOCrearPorNombre(
      () => prisma.paquete.findFirst({ where: { empresaId: empresa.id, nombre: paq.nombre } }),
      () => prisma.paquete.create({ data: { empresaId: empresa.id, nombre: paq.nombre } }),
    );
    paquetePorNombre.set(paq.nombre, paquete);

    for (const nombrePlataforma of paq.plataformas) {
      const plataforma = plataformaPorNombre.get(nombrePlataforma)!;
      await prisma.paquetePlataforma.upsert({
        where: { paqueteId_plataformaId: { paqueteId: paquete.id, plataformaId: plataforma.id } },
        update: {},
        create: {
          empresaId: empresa.id,
          paqueteId: paquete.id,
          plataformaId: plataforma.id,
          cantidadPantallas: 1,
        },
      });
    }
  }
  console.log(`✔ Paquetes: ${PAQUETES.length}`);

  // -- Precios de paquete y excepciones de duración (A.5) -------------------
  const netflix = plataformaPorNombre.get("Netflix")!;
  for (const [nombrePaquete, nombreDuracionVendida, precioVenta, excepcionNetflix] of PRECIOS_PAQUETE) {
    const paquete = paquetePorNombre.get(nombrePaquete)!;
    const duracionVendida = duracionPorNombre.get(nombreDuracionVendida)!;

    await prisma.precio.upsert({
      where: {
        empresaId_paqueteId_duracionId_tipoClienteId: {
          empresaId: empresa.id,
          paqueteId: paquete.id,
          duracionId: duracionVendida.id,
          tipoClienteId: tipoClienteNormal.id,
        },
      },
      update: {},
      create: {
        empresaId: empresa.id,
        paqueteId: paquete.id,
        duracionId: duracionVendida.id,
        tipoClienteId: tipoClienteNormal.id,
        precioVenta,
        costo: 0,
      },
    });

    if (excepcionNetflix) {
      const duracionReal = duracionPorNombre.get(excepcionNetflix)!;
      await prisma.paqueteDuracionPlataforma.upsert({
        where: {
          paqueteId_duracionVendidaId_plataformaId: {
            paqueteId: paquete.id,
            duracionVendidaId: duracionVendida.id,
            plataformaId: netflix.id,
          },
        },
        update: { duracionRealId: duracionReal.id },
        create: {
          empresaId: empresa.id,
          paqueteId: paquete.id,
          duracionVendidaId: duracionVendida.id,
          plataformaId: netflix.id,
          duracionRealId: duracionReal.id,
        },
      });
    }
  }
  console.log(`✔ Precios de paquete: ${PRECIOS_PAQUETE.length} (5 excepciones Netflix → 28 días)`);

  // -- Cuentas y pantallas de ejemplo (Removidas para producción) ------------
  console.log(`✔ Cuentas de ejemplo: Se omitió la creación para producción.`);

  // -- Plantillas de mensaje (Anexo B) ---------------------------------------
  await prisma.plantillaMensaje.upsert({
    where: { empresaId_tipo: { empresaId: empresa.id, tipo: "UNIDAD" } },
    update: { contenido: PLANTILLA_UNIDAD_POR_DEFECTO },
    create: { empresaId: empresa.id, tipo: "UNIDAD", contenido: PLANTILLA_UNIDAD_POR_DEFECTO },
  });
  await prisma.plantillaMensaje.upsert({
    where: { empresaId_tipo: { empresaId: empresa.id, tipo: "PAQUETE" } },
    update: { contenido: PLANTILLA_PAQUETE_POR_DEFECTO },
    create: { empresaId: empresa.id, tipo: "PAQUETE", contenido: PLANTILLA_PAQUETE_POR_DEFECTO },
  });
  console.log("✔ Plantillas de mensaje: UNIDAD, PAQUETE");

  // -- Verificación: Básico 1 / 30 días → Netflix 28 días, Disney+ 30 días --
  const basico1 = paquetePorNombre.get("Básico 1")!;
  const duracion30 = duracionPorNombre.get("30 días")!;
  const disneyPremium = plataformaPorNombre.get("Disney+ Premium")!;

  const excepcionNetflixBasico1 = await prisma.paqueteDuracionPlataforma.findUnique({
    where: {
      paqueteId_duracionVendidaId_plataformaId: {
        paqueteId: basico1.id,
        duracionVendidaId: duracion30.id,
        plataformaId: netflix.id,
      },
    },
    include: { duracionReal: true },
  });
  const excepcionDisneyBasico1 = await prisma.paqueteDuracionPlataforma.findUnique({
    where: {
      paqueteId_duracionVendidaId_plataformaId: {
        paqueteId: basico1.id,
        duracionVendidaId: duracion30.id,
        plataformaId: disneyPremium.id,
      },
    },
  });

  console.log("\n--- Verificación: Básico 1 vendido a 30 días ---");
  console.log(
    `Netflix resuelve a: ${excepcionNetflixBasico1?.duracionReal.nombre ?? "(sin excepción — hereda 30 días)"}`,
  );
  console.log(
    `Disney+ Premium resuelve a: ${excepcionDisneyBasico1 ? "tiene excepción propia" : "30 días (hereda la duración vendida, sin excepción)"}`,
  );
  if (excepcionNetflixBasico1?.duracionReal.nombre !== "28 días" || excepcionDisneyBasico1) {
    throw new Error("Verificación de Básico 1 / 30 días falló: revisar datos de A.5.");
  }
  console.log("✔ Verificación correcta.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
