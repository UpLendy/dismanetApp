import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// ---------------------------------------------------------------------------
// F4.2 parte 2.2 — antes de esta entrega, el PIN siempre tenía exactamente 4
// dígitos. Ahora la regla es 4 a 6 (PIN_LONGITUD_MIN/MAX/PATRON en
// @dismanet/shared). Un regex "[0-9]{4}" o "\d{4}" escrito a mano para
// validar el PIN es exactamente el bug que esta refactorización resolvió:
// rechazaría en silencio un PIN de 5 o 6 dígitos que el resto del sistema
// acepta.
//
// Esta prueba detecta ese literal de 4 dígitos como patrón de regex en
// cualquier archivo de negocio (no de prueba). La única entrada legítima de
// la lista blanca es la definición de PIN_LONGITUD_MIN/MAX en
// packages/shared — ahí el 4 y el 6 son los límites, no una longitud fija.
// ---------------------------------------------------------------------------

const RAIZ_REPO = fileURLToPath(new URL("../../../..", import.meta.url));

// La definición de los límites en @dismanet/shared usa PIN_LONGITUD_MIN/MAX
// interpolados, no un literal "4" suelto en el regex — por eso la lista
// blanca queda vacía a propósito. Si alguna vez se agrega una entrada aquí,
// debe venir con un comentario que explique por qué no basta con PIN_PATRON.
const LISTA_BLANCA = new Set<string>([]);

const DIRECTORIOS_A_RECORRER = ["apps/api/src", "apps/web/app", "apps/web/components", "apps/web/lib", "packages/shared/src"];

function esArchivoDePrueba(rutaRelativa: string): boolean {
  return rutaRelativa.endsWith(".test.ts") || rutaRelativa.endsWith(".test.tsx");
}

function recolectarArchivosTs(directorioAbsoluto: string, raiz: string, acumulado: string[]): void {
  for (const entrada of readdirSync(directorioAbsoluto)) {
    if (entrada === "node_modules" || entrada === "generated" || entrada === ".next") continue;

    const rutaAbsoluta = join(directorioAbsoluto, entrada);
    const info = statSync(rutaAbsoluta);

    if (info.isDirectory()) {
      recolectarArchivosTs(rutaAbsoluta, raiz, acumulado);
    } else if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) {
      acumulado.push(relative(raiz, rutaAbsoluta));
    }
  }
}

function sinComentarios(contenidoArchivo: string): string {
  return contenidoArchivo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// Detecta un regex de longitud fija de 4 dígitos: "[0-9]{4}" o "\d{4}",
// escrito directamente en el código en vez de usar PIN_PATRON.
function tieneRegexDeCuatroDigitosFijo(contenidoArchivo: string): boolean {
  return /(\[0-9\]|\\d)\{4\}/.test(sinComentarios(contenidoArchivo));
}

describe("F4.2 — ningún archivo de negocio valida el PIN con un regex fijo de 4 dígitos", () => {
  const archivos: string[] = [];
  for (const directorio of DIRECTORIOS_A_RECORRER) {
    recolectarArchivosTs(join(RAIZ_REPO, directorio), RAIZ_REPO, archivos);
  }

  const conRegexFijo = archivos.filter((ruta) => {
    const contenido = readFileSync(join(RAIZ_REPO, ruta), "utf-8");
    return tieneRegexDeCuatroDigitosFijo(contenido);
  });

  it("ningún archivo fuera de la lista blanca usa [0-9]{4} ni \\d{4} para el PIN", () => {
    const noAutorizados = conRegexFijo.filter((ruta) => !LISTA_BLANCA.has(ruta) && !esArchivoDePrueba(ruta));

    if (noAutorizados.length > 0) {
      throw new Error(
        `Los siguientes archivos usan un regex fijo de 4 dígitos: ${noAutorizados.join(", ")}.\n\n` +
          `Desde F4.2 el PIN acepta 4 a 6 dígitos (PIN_LONGITUD_MIN/MAX/PATRON de @dismanet/shared). ` +
          `Un regex de longitud fija reintroduce el límite viejo en silencio. Usa PIN_PATRON en vez ` +
          `de escribir el regex a mano.`,
      );
    }

    expect(noAutorizados).toEqual([]);
  });

  it("cada entrada de la lista blanca sigue existiendo y sigue teniendo el regex fijo (sin entradas obsoletas)", () => {
    for (const ruta of LISTA_BLANCA) {
      expect(conRegexFijo).toContain(ruta);
    }
  });
});
