import { Prisma } from "../generated/prisma/client.ts";

// ---------------------------------------------------------------------------
// R2 — Asignación atómica de pantallas.
//
// Prisma no tiene forma de expresar `SELECT ... FOR UPDATE SKIP LOCKED` con
// su API de consultas: por eso, y solo para esto, se usa $queryRaw dentro de
// la transacción de venta. $queryRaw NO pasa por la extensión de aislamiento
// de prismaParaEmpresa (R1) — el filtro de empresaId va escrito a mano en el
// WHERE, parametrizado (nunca interpolado en el texto del SQL). Toda la
// consulta cruda del proyecto para este propósito vive en esta única
// función, para que la lista blanca de prisma-raw-lista-blanca.test.ts
// pueda vigilar un solo archivo.
//
// La condición de disponibilidad (NOT EXISTS ... VentaDetalle no anulada y
// vigente) es la misma regla de R5 (estadoDePantallas en pantallas.ts),
// reescrita en SQL a propósito: con FOR UPDATE SKIP LOCKED no se puede
// primero leer con Prisma y luego bloquear por separado, porque entre la
// lectura y el bloqueo otra venta concurrente podría tomar la misma
// pantalla (la condición de carrera que R2 prohíbe explícitamente).
//
// FOR UPDATE OF p: bloquea solo las filas de Pantalla, no las de Cuenta que
// aporta el JOIN — dos ventas de paquetes que comparten una cuenta pero no
// una pantalla no deben bloquearse entre sí.
// ---------------------------------------------------------------------------

type ClienteTx = Prisma.TransactionClient;

export interface PantallaBloqueada {
  id: string;
  cuentaId: string;
}

/**
 * Bloquea y devuelve hasta `cantidad` pantallas libres de `plataformaId`,
 * dentro de la empresa `empresaId`. Las filas devueltas quedan bloqueadas
 * (FOR UPDATE) hasta que la transacción que las pidió termine (commit o
 * rollback) — ninguna otra transacción concurrente puede tomarlas mientras
 * tanto, y SKIP LOCKED hace que las ya bloqueadas por otra venta en curso
 * se ignoren en vez de esperar.
 *
 * Si devuelve menos de `cantidad`, el caller debe revertir toda la
 * transacción de venta (R2, todo o nada) — esta función nunca decide eso
 * por sí misma, solo informa cuántas pudo bloquear.
 */
export async function tomarPantallasDisponibles(
  tx: ClienteTx,
  empresaId: string,
  plataformaId: string,
  cantidad: number,
): Promise<PantallaBloqueada[]> {
  if (cantidad <= 0) return [];

  return tx.$queryRaw<PantallaBloqueada[]>(Prisma.sql`
    SELECT p.id, p."cuentaId"
    FROM "Pantalla" p
    INNER JOIN "Cuenta" c ON c.id = p."cuentaId"
    WHERE p."empresaId" = ${empresaId}
      AND c."plataformaId" = ${plataformaId}
      AND p.activa = true
      AND c.activa = true
      AND NOT EXISTS (
        SELECT 1
        FROM "VentaDetalle" vd
        INNER JOIN "Venta" v ON v.id = vd."ventaId"
        WHERE vd."pantallaId" = p.id
          AND v.anulada = false
          AND vd."fechaVencimiento" > now()
      )
    ORDER BY p."cuentaId" ASC, p.numero ASC
    FOR UPDATE OF p SKIP LOCKED
    LIMIT ${cantidad}
  `);
}
