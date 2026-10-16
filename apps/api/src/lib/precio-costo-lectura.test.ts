import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// ---------------------------------------------------------------------------
// Camino del dinero, punto 1: Precio.costo deja de ser la fuente de costo —
// el costo vive en CostoPlataforma (plataformaId + duracionId), no en Precio
// (que es por tipoCliente, una dimensión de la que el costo no depende).
//
// La columna Precio.costo se queda en el esquema por ahora (CLAUDE.md, punto
// 1 de la entrega: "no la borres esta entrega") y guardarCelda() la sigue
// escribiendo como "0" de relleno — pero nada de negocio debe volver a
// LEERLA, porque ya no se actualiza con datos reales. Esta prueba recorre
// src/ y falla si algún archivo fuera de la lista blanca lee ese campo, sea
// vía `select: { costo: true }` sobre el modelo Precio, sea accediendo
// `.costo` en una variable con uno de los nombres que esta base de código ya
// usa por convención para un registro de Precio.
// ---------------------------------------------------------------------------

const RAIZ_API = fileURLToPath(new URL("../..", import.meta.url));

// Único lector autorizado de Precio.costo, y por qué: migra el dato viejo
// (una fila por tipoCliente) al nuevo modelo CostoPlataforma (una fila por
// plataforma+duración), tomando el mayor costo registrado entre los tipos de
// cliente de cada combinación. Es un script de migración de datos que corre
// una sola vez por empresa; después de esa corrida, nada vuelve a leer el
// campo.
const LISTA_BLANCA = new Set<string>(["src/lib/migrar-costo-plataforma.ts"]);

// Nombres de variable que esta base de código usa, por convención, para un
// registro (o arreglo de registros) devuelto por `cliente.precio.*`. Ver
// lib/pantallas.ts, lib/paquetes.ts, lib/diagnostico-empresa.ts, lib/ventas.ts
// y routes/precios.ts — todos siguen este mismo patrón de nombres.
const NOMBRES_VARIABLE_PRECIO = ["precio", "precios", "preciosActivos", "existente", "carrera"];

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

// Aísla el texto de cada llamada `.precio.<método>(...)` con paréntesis
// balanceados, para revisar el `select` de ESA llamada puntual sin
// confundirlo con el de una llamada distinta más abajo en el archivo.
function llamadasPrecio(contenido: string): string[] {
  const llamadas: string[] = [];
  const regex = /\.precio\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|create|update|upsert|createMany)\s*\(/g;
  let coincidencia: RegExpExecArray | null;
  while ((coincidencia = regex.exec(contenido))) {
    const inicio = coincidencia.index + coincidencia[0].length - 1;
    let profundidad = 0;
    let fin = inicio;
    for (let i = inicio; i < contenido.length; i++) {
      if (contenido[i] === "(") profundidad++;
      else if (contenido[i] === ")") {
        profundidad--;
        if (profundidad === 0) {
          fin = i;
          break;
        }
      }
    }
    llamadas.push(contenido.slice(inicio, fin + 1));
  }
  return llamadas;
}

function leeCostoPorSelect(contenido: string): boolean {
  return llamadasPrecio(contenido).some((llamada) => /\bcosto\s*:\s*true\b/.test(llamada));
}

function leeCostoPorAcceso(contenido: string): boolean {
  return NOMBRES_VARIABLE_PRECIO.some((nombre) => new RegExp(`\\b${nombre}\\.costo\\b`).test(contenido));
}

describe("Precio.costo — nadie lo lee fuera de la migración (camino del dinero, punto 1)", () => {
  const archivos: string[] = [];
  recolectarArchivosTs(join(RAIZ_API, "src"), RAIZ_API, archivos);

  const contenidoPorArchivo = new Map(
    archivos
      .filter((ruta) => !esArchivoDePrueba(ruta))
      .map((ruta) => [ruta, readFileSync(join(RAIZ_API, ruta), "utf-8")] as const),
  );

  const conLecturaDeCosto = [...contenidoPorArchivo.entries()]
    .filter(([, contenido]) => leeCostoPorSelect(contenido) || leeCostoPorAcceso(contenido))
    .map(([ruta]) => ruta);

  it("recolectó al menos un archivo que lee Precio.costo (la migración, que la prueba no está vacía por error)", () => {
    expect(conLecturaDeCosto.length).toBeGreaterThan(0);
  });

  it("ningún archivo fuera de la lista blanca lee Precio.costo", () => {
    const noAutorizados = conLecturaDeCosto.filter((ruta) => !LISTA_BLANCA.has(ruta));

    if (noAutorizados.length > 0) {
      throw new Error(
        `Los siguientes archivos leen Precio.costo fuera de la lista blanca: ${noAutorizados.join(", ")}.\n\n` +
          `Regla (camino del dinero, punto 1): Precio.costo ya no se actualiza con datos reales — ` +
          `guardarCelda() lo escribe siempre como "0" de relleno. El costo real vive en ` +
          `CostoPlataforma (plataformaId + duracionId) o, para paquetes, se calcula con ` +
          `costoComponentesPaquete(). Si de verdad necesitas leer Precio.costo (por ej. otro ` +
          `script de migración de datos históricos), agrega el archivo a LISTA_BLANCA en esta ` +
          `prueba con un comentario que explique por qué.`,
      );
    }

    expect(noAutorizados).toEqual([]);
  });

  it("cada entrada de la lista blanca sigue existiendo y sigue leyendo Precio.costo (sin entradas obsoletas)", () => {
    for (const ruta of LISTA_BLANCA) {
      expect(conLecturaDeCosto).toContain(ruta);
    }
  });
});
