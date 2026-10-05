import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prismaRaw } from "./prisma.ts";

// ---------------------------------------------------------------------------
// R1 — Aislamiento entre empresas.
//
// La lista de modelos que tienen empresaId se deriva LEYENDO EL ESQUEMA de
// Prisma (prisma/schema.prisma), no escribiéndola a mano. Así, un modelo
// nuevo que agregue empresaId queda cubierto automáticamente por la
// extensión sin tocar este archivo. Un modelo omitido aquí es una fuga de
// datos entre clientes.
//
// No se usa el runtimeDataModel embebido en el cliente generado
// (src/generated/prisma/internal/class.ts): ese archivo dice explícitamente
// "no editar directamente" y no es una API pública estable entre
// regeneraciones. El esquema .prisma sí es la fuente de verdad del proyecto.
// ---------------------------------------------------------------------------

const RUTA_ESQUEMA = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));

function derivarModelosConEmpresaId(): ReadonlySet<string> {
  const esquema = readFileSync(RUTA_ESQUEMA, "utf-8");
  const modelos = new Set<string>();

  for (const coincidencia of esquema.matchAll(/model\s+(\w+)\s*{([^}]*)}/g)) {
    const [, nombreModelo, cuerpo] = coincidencia;
    if (/^\s*empresaId\b/m.test(cuerpo)) {
      modelos.add(nombreModelo);
    }
  }

  return modelos;
}

const MODELOS_CON_EMPRESA_ID = derivarModelosConEmpresaId();

// "PaquetePlataforma" -> "paquetePlataforma": nombre de la propiedad del
// cliente de Prisma para ese modelo (convención estándar de Prisma).
function propiedadCliente(modelo: string): string {
  return modelo.charAt(0).toLowerCase() + modelo.slice(1);
}

const PROPIEDADES_CON_EMPRESA_ID = new Set([...MODELOS_CON_EMPRESA_ID].map(propiedadCliente));

const METODOS_CON_WHERE = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

const METODOS_CON_DATA_MUCHOS = new Set(["createMany", "createManyAndReturn"]);

// upsert no se puede filtrar de forma segura: su `where` exige un selector
// único (ej. id) y Prisma no permite combinarlo con empresaId salvo que el
// índice único ya incluya empresaId — no es el caso general del esquema.
// Inyectar empresaId en `create`/`update` y dejar el `where` tal cual dejaría
// pasar un upsert que lee/escribe la fila de OTRA empresa si el id coincide.
// Mejor un error ruidoso en desarrollo que un filtro silenciosamente
// incorrecto: el caller debe usar findFirst + create/update con manejo de
// P2002 (ver restriccionViolada() en errores.ts).
function lanzarErrorUpsert(): never {
  throw new Error(
    "prismaParaEmpresa no soporta upsert: su `where` exige un selector único " +
      "que no siempre admite empresaId, así que no puede filtrarse de forma " +
      "segura entre empresas. Usa findFirst + create/update, manejando la " +
      "colisión P2002 con restriccionViolada().",
  );
}

type Args = Record<string, unknown>;

function conWhereEmpresa(args: Args | undefined, empresaId: string): Args {
  return { ...(args ?? {}), where: { ...((args?.where as Args | undefined) ?? {}), empresaId } };
}

function conDataEmpresa(args: Args | undefined, empresaId: string): Args {
  return { ...(args ?? {}), data: { ...((args?.data as Args | undefined) ?? {}), empresaId } };
}

function conDataEmpresaMany(args: Args | undefined, empresaId: string): Args {
  const data = args?.data;
  if (Array.isArray(data)) {
    return { ...(args ?? {}), data: data.map((fila) => ({ ...(fila as Args), empresaId })) };
  }
  return conDataEmpresa(args, empresaId);
}

// Envuelve un delegado de modelo (ej. cliente.usuario) para inyectar
// empresaId en cada llamada. `objetivo` es el delegado REAL (no el proxy
// exterior): cada método se invoca con `.call(objetivo, ...)` a propósito,
// para no romper el `this` interno que Prisma espera en cada delegado.
function envolverDelegadoModelo(objetivo: Record<string, unknown>, empresaId: string): Record<string, unknown> {
  return new Proxy(objetivo, {
    get(delegadoReal, prop, receptor) {
      const original = Reflect.get(delegadoReal, prop, receptor);
      if (typeof original !== "function" || typeof prop !== "string") return original;
      const metodo = original as (...args: unknown[]) => unknown;

      if (prop === "upsert") {
        return lanzarErrorUpsert;
      }
      if (METODOS_CON_WHERE.has(prop)) {
        return (args?: Args) => metodo.call(delegadoReal, conWhereEmpresa(args, empresaId));
      }
      if (prop === "create") {
        return (args: Args) => metodo.call(delegadoReal, conDataEmpresa(args, empresaId));
      }
      if (METODOS_CON_DATA_MUCHOS.has(prop)) {
        return (args: Args) => metodo.call(delegadoReal, conDataEmpresaMany(args, empresaId));
      }
      return metodo.bind(delegadoReal);
    },
  });
}

/**
 * Cliente de Prisma aislado por empresa (R1).
 *
 * Para los MODELOS_CON_EMPRESA_ID (las trece tablas de negocio), inyecta:
 * - `where.empresaId` en findMany, findFirst, findFirstOrThrow, findUnique,
 *   findUniqueOrThrow, update, updateMany, updateManyAndReturn, delete,
 *   deleteMany, count, aggregate y groupBy.
 * - `data.empresaId` en create, createMany y createManyAndReturn.
 * - `upsert` NO se envuelve: lanza un error explícito (ver lanzarErrorUpsert
 *   arriba) porque su `where` no admite un filtro seguro por empresaId.
 *
 * findUnique/update/delete reciben un `where` con un campo único (ej. id)
 * MÁS empresaId. Prisma soporta filtros adicionales no-únicos combinados con
 * un identificador único (extendedWhereUnique, GA): si el registro existe
 * pero es de otra empresa, findUnique devuelve null y update/delete lanzan
 * P2025 (registro no encontrado) — nunca devuelven ni tocan el registro
 * ajeno. Verificado empíricamente contra la base antes de esta entrega.
 *
 * Empresa queda fuera: no tiene empresaId.
 *
 * El segundo parámetro (`cliente`) es opcional y por defecto es prismaRaw —
 * todo el código existente que llama prismaParaEmpresa(empresaId) sigue
 * funcionando igual. Pero también acepta el `tx` de una transacción
 * interactiva (`prismaRaw.$transaction(async (tx) => ...)`), para poder
 * crear la empresa y su primer ADMIN en la MISMA conexión/transacción
 * (ver rutas de empresas). Por eso la inyección se implementa con Proxy en
 * vez de `.$extends()`: el `tx` de Prisma 7 con el adapter de `pg` no
 * expone `.$extends()` (verificado empíricamente), así que la extensión no
 * puede construirse sobre él — pero envolver sus delegados de modelo con un
 * Proxy manual sí funciona igual sobre prismaRaw o sobre tx.
 */
export function prismaParaEmpresa<C extends object = typeof prismaRaw>(
  empresaId: string | null | undefined,
  cliente: C = prismaRaw as unknown as C,
): C {
  if (!empresaId) {
    throw new Error(
      "prismaParaEmpresa requiere un empresaId. Nunca se debe invocar con empresaId nulo o indefinido.",
    );
  }

  return new Proxy(cliente as Record<string, unknown>, {
    get(objetivo, prop, receptor) {
      // $transaction entrega un `tx` SIN extender a su callback si se deja
      // pasar sin envolver — exactamente la fuga que describe R1 para
      // transacciones. Se intercepta aquí para que, sin importar quién
      // llame prismaParaEmpresa(empresaId).$transaction(cb), el `tx` que
      // recibe `cb` venga envuelto con prismaParaEmpresa(empresaId, tx): la
      // misma empresa, nunca el cliente crudo.
      // No existe sobre un `tx` (Prisma no soporta transacciones anidadas):
      // en ese caso Reflect.get devuelve undefined y se retorna tal cual.
      if (prop === "$transaction") {
        const original = Reflect.get(objetivo, prop, receptor);
        if (typeof original !== "function") return original;
        const metodoTransaction = original as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          const [primero, ...resto] = args;
          if (typeof primero !== "function") {
            // Forma secuencial ($transaction([...])): cada promesa del
            // arreglo ya se construyó con su propio cliente antes de
            // llamar $transaction, no hay tx de callback que envolver.
            return metodoTransaction.call(objetivo, primero, ...resto);
          }
          const callback = primero as (tx: unknown) => unknown;
          return metodoTransaction.call(
            objetivo,
            (tx: unknown) => callback(prismaParaEmpresa(empresaId, tx as C)),
            ...resto,
          );
        };
      }
      if (typeof prop === "string" && PROPIEDADES_CON_EMPRESA_ID.has(prop)) {
        const delegado = Reflect.get(objetivo, prop, receptor);
        if (delegado && typeof delegado === "object") {
          return envolverDelegadoModelo(delegado as Record<string, unknown>, empresaId);
        }
      }
      const valor = Reflect.get(objetivo, prop, receptor);
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  }) as C;
}

// Exportado solo para que las pruebas puedan recorrer "las trece tablas" sin
// mantener una lista aparte a mano.
export { MODELOS_CON_EMPRESA_ID };

// Exportados para que la prueba de aislamiento pueda armar el producto
// completo modelo × operación sin mantener una lista de operaciones a mano:
// ambos conjuntos son el inventario real de lo que este archivo clasifica.
// Cualquier operación del delegado de Prisma que NO aparezca en ninguno de
// los tres (envuelta-where, envuelta-data o bloqueada) es una fuga sin
// clasificar, y la prueba debe fallar hasta que un humano decida dónde va.
export { METODOS_CON_WHERE, METODOS_CON_DATA_MUCHOS };
export const OPERACIONES_DE_UN_SOLO_REGISTRO = new Set(["create"]);
export const OPERACIONES_BLOQUEADAS = new Set(["upsert"]);

// Propiedades de un delegado de modelo que no son operaciones de Prisma
// sobre la base de datos y por tanto no necesitan clasificación de
// aislamiento: `findRaw`/`aggregateRaw` son específicas de MongoDB y Prisma
// mismo las rechaza en tiempo de ejecución bajo el adapter de Postgres de
// este proyecto (verificado empíricamente) — no hay filtro que inyectarles
// porque nunca llegan a ejecutarse. `fields`, `name`, `$name` y `$parent`
// son metadatos del delegado, no invocaciones contra la base de datos.
export const PROPIEDADES_NO_OPERACION = new Set([
  "findRaw",
  "aggregateRaw",
  "fields",
  "name",
  "$name",
  "$parent",
]);

/**
 * Para los modelos donde `empresaId` es un campo NO nullable en el esquema
 * (ej. Plataforma, Duracion, TipoCliente, Paquete): el tipo `...CreateInput`
 * que genera Prisma exige `empresaId` en `data`, aunque en tiempo de
 * ejecución el Proxy de `prismaParaEmpresa` siempre lo inyecta y lo
 * SOBRESCRIBE (ver `conDataEmpresa`/`conDataEmpresaMany` arriba) — pasar uno
 * aquí sería inerte.
 * Este helper ajusta el tipo en el punto de llamada para que el caller no
 * tenga que escribir un `empresaId` que nunca se usa. Nunca pasar aquí un
 * empresaId real: no tendría ningún efecto y sugeriría al lector que sí lo
 * tiene.
 */
export function datosSinEmpresa<T extends { empresaId: string }>(data: Omit<T, "empresaId">): T {
  return data as T;
}
