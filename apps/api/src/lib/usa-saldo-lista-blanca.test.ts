import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// ---------------------------------------------------------------------------
// División de VENDEDOR en VENDEDOR/EMPLEADO: el saldo pasó de depender de la
// columna Usuario.usaSaldo a depender de contexto.rol === Rol.VENDEDOR (ver
// lib/bloqueo-usuario.ts, lib/ventas.ts, routes/perfil.ts, routes/usuarios.ts).
// La columna usaSaldo sigue existiendo en la base (no se borra: hay código de
// producción que todavía podría tener filas con ella poblada de antes de la
// migración de datos), pero ningún handler debe volver a LEERLA — leerla
// reintroduce exactamente el bug que esta refactorización resolvió: un
// EMPLEADO con la columna vieja en true volvería a ver saldo.
//
// Esta prueba detecta lectura de la columna como acceso a propiedad
// (`algo.usaSaldo`) sobre cualquier objeto — el patrón que tendría una fila
// de Usuario recién consultada. No marca `usaSaldo: true` / `usaSaldo: false`
// como literal de un objeto que se está construyendo (esos son el campo de
// SALIDA del JSON de respuesta, derivado de rol, y debe seguir existiendo por
// estabilidad del contrato con el frontend).
// ---------------------------------------------------------------------------

const RAIZ_API = fileURLToPath(new URL("../..", import.meta.url));

// Ningún archivo de negocio necesita leer la columna usaSaldo: la lista
// blanca queda vacía a propósito. Si alguna vez se agrega una entrada aquí,
// debe venir con un comentario que explique por qué no basta con contexto.rol.
const LISTA_BLANCA = new Set<string>([]);

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

// Quita comentarios de bloque y de línea antes de buscar: varios archivos
// mencionan "Usuario.usaSaldo" en prosa para explicar que la columna ya NO
// se lee (ver bloqueo-usuario.ts, usuarios.ts), y esa mención no debe
// contar como una lectura real.
function sinComentarios(contenidoArchivo: string): string {
  return contenidoArchivo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// Detecta `algo.usaSaldo` (acceso a propiedad — lectura de la columna desde
// una fila ya consultada). No hace match contra `usaSaldo: valor`, que es la
// forma de CONSTRUIR un objeto de salida con esa clave, no de leer la
// columna.
function leeColumnaUsaSaldo(contenidoArchivo: string): boolean {
  return /\.usaSaldo\b/.test(sinComentarios(contenidoArchivo));
}

describe("R-saldo — ningún archivo lee la columna Usuario.usaSaldo", () => {
  const archivos: string[] = [];
  recolectarArchivosTs(join(RAIZ_API, "src"), RAIZ_API, archivos);

  const conLecturaUsaSaldo = archivos.filter((ruta) => {
    const contenido = readFileSync(join(RAIZ_API, ruta), "utf-8");
    return leeColumnaUsaSaldo(contenido);
  });

  it("ningún archivo fuera de la lista blanca lee usuario.usaSaldo", () => {
    const noAutorizados = conLecturaUsaSaldo.filter(
      (ruta) => !LISTA_BLANCA.has(ruta) && !esArchivoDePrueba(ruta),
    );

    if (noAutorizados.length > 0) {
      throw new Error(
        `Los siguientes archivos leen la columna Usuario.usaSaldo como propiedad de un objeto: ` +
          `${noAutorizados.join(", ")}.\n\n` +
          `Desde la división de VENDEDOR en VENDEDOR/EMPLEADO, el saldo depende exclusivamente ` +
          `de contexto.rol === Rol.VENDEDOR (ver lib/bloqueo-usuario.ts, lib/ventas.ts, ` +
          `routes/perfil.ts, routes/usuarios.ts) — la columna usaSaldo ya no es la fuente de ` +
          `verdad y puede tener datos obsoletos de antes de la migración. Si este archivo de ` +
          `verdad necesita leer la columna, agrégalo a LISTA_BLANCA en este archivo de prueba ` +
          `con un comentario que explique por qué contexto.rol no es suficiente.`,
      );
    }

    expect(noAutorizados).toEqual([]);
  });

  it("cada entrada de la lista blanca sigue existiendo y sigue leyendo usaSaldo (sin entradas obsoletas)", () => {
    for (const ruta of LISTA_BLANCA) {
      expect(conLecturaUsaSaldo).toContain(ruta);
    }
  });
});
