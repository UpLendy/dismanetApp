import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// ---------------------------------------------------------------------------
// R1 — "los handlers de negocio no usan prismaRaw" deja de ser solo una
// convención de CLAUDE.md: esta prueba recorre el código fuente de apps/api,
// encuentra todo archivo que importe prismaRaw, y falla si aparece en un
// archivo que no está en la lista blanca de abajo.
//
// La misma prueba vigila $queryRaw/$executeRaw (R2): ninguno de los dos pasa
// por la extensión de aislamiento de prismaParaEmpresa, así que su uso fuera
// de una lista blanca aparte es una fuga de empresaId tan real como usar
// prismaRaw directamente. Las variantes `Unsafe` (query/executeRawUnsafe)
// están prohibidas en todo el proyecto, sin excepción: admiten SQL
// interpolado en vez de parametrizado y son la puerta de entrada clásica a
// inyección SQL — ni siquiera un archivo en lista blanca puede usarlas.
// ---------------------------------------------------------------------------

const RAIZ_API = fileURLToPath(new URL("../..", import.meta.url));

// Archivos de negocio autorizados a usar prismaRaw directamente, y por qué:
const LISTA_BLANCA = new Set<string>([
  // Seed: corre fuera de cualquier request autenticado, no hay empresaId
  // de sesión que inyectar.
  "prisma/seed.ts",
  // Login y /auth/yo: antes/al resolver la sesión no se conoce todavía la
  // empresa del usuario (o, para SUPER_ADMIN, nunca hay una empresa propia).
  "src/routes/auth.ts",
  // Rutas de empresas: Empresa es la única tabla de negocio sin empresaId
  // (R1 no aplica — no hay nada que aislar en esa tabla). Además, crear la
  // empresa y su primer ADMIN en la misma transacción es la única situación
  // del proyecto donde el empresaId no existe todavía al abrir la
  // transacción, así que no hay forma de abrirla con prismaParaEmpresa.
  "src/routes/empresas.ts",
  // Migración de datos (backfill de plantillas/tipos de cliente para
  // empresas creadas antes de que el alta las sembrara): necesita listar
  // TODAS las empresas para recorrerlas, igual que empresas.ts arriba. Cada
  // operación de negocio dentro del loop usa prismaParaEmpresa, nunca
  // prismaRaw directamente.
  "prisma/backfill-catalogo-base.ts",
  // Resuelve la identidad del usuario a partir del JWT: todavía no hay
  // empresaId de sesión fiable en ese punto (es justamente lo que esta
  // consulta ayuda a derivar), y para SUPER_ADMIN nunca hay una empresa
  // propia que inyectar. Solo lee versionSesion por id, nunca escribe.
  "src/plugins/contexto.ts",
  // Perfil propio: la fila que se lee/actualiza es siempre la del propio
  // usuario autenticado (contexto.usuarioId), nunca una fila ajena. Para
  // SUPER_ADMIN (empresaId nulo en su propio registro, igual que en
  // /auth/yo) no hay cliente extendido posible.
  "src/routes/perfil.ts",
]);

// Archivos que son el MECANISMO de aislamiento en sí, no un handler que lo
// esquiva: prisma.ts define prismaRaw (no lo importa), y prisma-empresa.ts
// lo envuelve para construir el cliente extendido — es la implementación de
// la regla, no una excepción a ella.
const EXCLUIDOS_DEL_RASTREO = new Set<string>(["src/lib/prisma.ts", "src/lib/prisma-empresa.ts"]);

// Archivos de negocio autorizados a usar $queryRaw/$executeRaw (sin la
// variante Unsafe, prohibida en todo el proyecto), y por qué:
const LISTA_BLANCA_RAW_SQL = new Set<string>([
  // R2: SELECT ... FOR UPDATE SKIP LOCKED no se puede expresar con la API
  // de consultas de Prisma. empresaId va escrito a mano en el WHERE,
  // parametrizado — ver el comentario al inicio de ese archivo.
  "src/lib/bloqueo-pantallas.ts",
  // Saldo: SELECT ... FOR UPDATE (sin SKIP LOCKED, a propósito) sobre la
  // fila de Usuario antes de verificar/cobrar saldo. Mismo motivo que
  // bloqueo-pantallas.ts — la API de Prisma no expresa FOR UPDATE — y mismo
  // cuidado: Usuario es el único modelo con empresaId nullable, así que el
  // WHERE filtra por id Y empresaId a mano. Ver el comentario al inicio de
  // ese archivo.
  "src/lib/bloqueo-usuario.ts",
  // Entrega 9, 0c: SAVEPOINT/RELEASE SAVEPOINT/ROLLBACK TO SAVEPOINT
  // alrededor del create() del reintento de código de compra. Postgres
  // aborta toda la transacción tras un P2002 (Prisma no pone savepoints
  // automáticos dentro de una transacción interactiva); sin esto, el
  // reintento de más abajo nunca llega a ejecutarse de verdad. No es una
  // consulta de datos, no hay empresaId que filtrar — el nombre del
  // savepoint es un literal fijo, sin interpolación de usuario.
  "src/lib/ventas.ts",
]);

function esArchivoDePrueba(rutaRelativa: string): boolean {
  return rutaRelativa.endsWith(".test.ts");
}

function recolectarArchivosTs(directorioAbsoluto: string, raiz: string, acumulado: string[]): void {
  for (const entrada of readdirSync(directorioAbsoluto)) {
    if (entrada === "node_modules" || entrada === "generated") continue;

    const rutaAbsoluta = join(directorioAbsoluto, entrada);
    const info = statSync(rutaAbsoluta);

    if (info.isDirectory()) {
      recolectarArchivosTs(rutaAbsoluta, raiz, acumulado);
    } else if (entrada.endsWith(".ts")) {
      acumulado.push(relative(raiz, rutaAbsoluta));
    }
  }
}

// Detecta uso de $queryRaw/$executeRaw como llamada de método (ej.
// `tx.$queryRaw(...)`), no como import — estos no se importan, se llaman
// sobre un cliente. El \b final evita que "$queryRaw" haga match dentro de
// "$queryRawUnsafe" (no hay límite de palabra entre "Raw" y "Unsafe").
function usaQueryOExecuteRaw(contenidoArchivo: string): boolean {
  return /\$(queryRaw|executeRaw)\b/.test(contenidoArchivo);
}

// Las variantes Unsafe aceptan SQL interpolado en vez de parametrizado:
// prohibidas en todo el proyecto, sin excepción ni lista blanca.
function usaVarianteUnsafe(contenidoArchivo: string): boolean {
  return /\$(queryRawUnsafe|executeRawUnsafe)\b/.test(contenidoArchivo);
}

function importaPrismaRaw(contenidoArchivo: string): boolean {
  // `import type { prismaRaw } from ...` no cuenta: no toca la base de
  // datos en tiempo de ejecución, solo referencia el tipo del cliente
  // (ej. para tipar un parámetro que recibe prismaRaw o un `tx`).
  for (const coincidencia of contenidoArchivo.matchAll(/import\s+(type\s+)?\{([\s\S]*?)\}\s*from/g)) {
    const esImportDeTipo = Boolean(coincidencia[1]);
    if (!esImportDeTipo && /\bprismaRaw\b/.test(coincidencia[2])) return true;
  }
  return false;
}

describe("R1 — lista blanca de prismaRaw", () => {
  const archivos: string[] = [];
  recolectarArchivosTs(join(RAIZ_API, "src"), RAIZ_API, archivos);
  recolectarArchivosTs(join(RAIZ_API, "prisma"), RAIZ_API, archivos);

  const conPrismaRaw = archivos.filter((ruta) => {
    if (EXCLUIDOS_DEL_RASTREO.has(ruta)) return false;
    const contenido = readFileSync(join(RAIZ_API, ruta), "utf-8");
    return importaPrismaRaw(contenido);
  });

  it("recolectó al menos un archivo con prismaRaw (la prueba no está vacía por error)", () => {
    expect(conPrismaRaw.length).toBeGreaterThan(0);
  });

  it("ningún archivo fuera de la lista blanca importa prismaRaw", () => {
    const noAutorizados = conPrismaRaw.filter(
      (ruta) => !LISTA_BLANCA.has(ruta) && !esArchivoDePrueba(ruta),
    );

    if (noAutorizados.length > 0) {
      throw new Error(
        `Los siguientes archivos importan prismaRaw sin estar en la lista blanca de R1: ` +
          `${noAutorizados.join(", ")}.\n\n` +
          `Regla (CLAUDE.md R1): ningún handler de negocio usa prismaRaw — ese cliente no ` +
          `filtra por empresaId, así que una consulta con él puede devolver o modificar filas ` +
          `de OTRA empresa. Si este archivo de verdad necesita prismaRaw (por ej. porque toca ` +
          `una tabla sin empresaId, o corre antes de conocer la empresa), agrégalo a ` +
          `LISTA_BLANCA en este archivo de prueba con un comentario que explique por qué, y ` +
          `agrega un comentario de una línea arriba de cada uso en el archivo mismo.`,
      );
    }

    expect(noAutorizados).toEqual([]);
  });

  it("cada entrada de la lista blanca sigue existiendo y sigue usando prismaRaw (sin entradas obsoletas)", () => {
    for (const ruta of LISTA_BLANCA) {
      expect(conPrismaRaw).toContain(ruta);
    }
  });
});

describe("R2 — lista blanca de $queryRaw / $executeRaw", () => {
  const archivos: string[] = [];
  recolectarArchivosTs(join(RAIZ_API, "src"), RAIZ_API, archivos);
  recolectarArchivosTs(join(RAIZ_API, "prisma"), RAIZ_API, archivos);

  const contenidoPorArchivo = new Map(
    archivos.map((ruta) => [ruta, readFileSync(join(RAIZ_API, ruta), "utf-8")] as const),
  );

  const conRawSql = archivos.filter((ruta) => usaQueryOExecuteRaw(contenidoPorArchivo.get(ruta)!));

  it("recolectó al menos un archivo con $queryRaw/$executeRaw (la prueba no está vacía por error)", () => {
    expect(conRawSql.length).toBeGreaterThan(0);
  });

  it("ningún archivo fuera de la lista blanca de R2 usa $queryRaw/$executeRaw", () => {
    const noAutorizados = conRawSql.filter(
      (ruta) => !LISTA_BLANCA_RAW_SQL.has(ruta) && !esArchivoDePrueba(ruta),
    );

    if (noAutorizados.length > 0) {
      throw new Error(
        `Los siguientes archivos usan $queryRaw/$executeRaw sin estar en la lista blanca de R2: ` +
          `${noAutorizados.join(", ")}.\n\n` +
          `Regla (CLAUDE.md R1/R2): $queryRaw y $executeRaw no pasan por la extensión de ` +
          `aislamiento de prismaParaEmpresa — el empresaId tiene que filtrarse a mano, ` +
          `parametrizado, en el WHERE. Si este archivo de verdad necesita SQL crudo (ej. ` +
          `FOR UPDATE SKIP LOCKED, que la API de Prisma no expresa), agrégalo a ` +
          `LISTA_BLANCA_RAW_SQL en este archivo de prueba con un comentario que explique por ` +
          `qué, y encapsula la consulta en una sola función con el filtro de empresaId visible.`,
      );
    }

    expect(noAutorizados).toEqual([]);
  });

  it("cada entrada de la lista blanca de R2 sigue existiendo y sigue usando $queryRaw/$executeRaw (sin entradas obsoletas)", () => {
    for (const ruta of LISTA_BLANCA_RAW_SQL) {
      expect(conRawSql).toContain(ruta);
    }
  });

  it("ningún archivo del proyecto usa $queryRawUnsafe ni $executeRawUnsafe (prohibidas sin excepción)", () => {
    // Los archivos de prueba quedan fuera del rastreo: este mismo archivo
    // necesita mencionar los nombres prohibidos en el mensaje de error y en
    // el propio patrón que los detecta, lo que de otra forma se detectaría
    // a sí mismo como una violación.
    const conVarianteUnsafe = archivos
      .filter((ruta) => !esArchivoDePrueba(ruta))
      .filter((ruta) => usaVarianteUnsafe(contenidoPorArchivo.get(ruta)!));

    if (conVarianteUnsafe.length > 0) {
      throw new Error(
        `Los siguientes archivos usan $queryRawUnsafe/$executeRawUnsafe, prohibidas en todo ` +
          `el proyecto sin excepción porque admiten SQL interpolado en vez de parametrizado: ` +
          `${conVarianteUnsafe.join(", ")}. Usa $queryRaw/$executeRaw con Prisma.sql y ` +
          `parámetros, nunca interpolación de texto.`,
      );
    }

    expect(conVarianteUnsafe).toEqual([]);
  });
});
