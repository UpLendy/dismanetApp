import { Prisma, Rol } from "../generated/prisma/client.ts";

// ---------------------------------------------------------------------------
// Saldo — bloqueo de la fila del usuario antes de verificar/cobrar saldo.
//
// Prisma no tiene forma de expresar `SELECT ... FOR UPDATE` con su API de
// consultas: por eso, y solo para esto, se usa $queryRaw dentro de la
// transacción de venta. $queryRaw NO pasa por la extensión de aislamiento de
// prismaParaEmpresa (R1) — el filtro de empresaId va escrito a mano en el
// WHERE, parametrizado. Usuario es el único modelo del esquema con empresaId
// NULLABLE (el SUPER_ADMIN no pertenece a ninguna empresa): un WHERE solo por
// id sería una fuga entre empresas esperando a pasar, así que el WHERE lleva
// id Y empresaId.
//
// Si no hay fila que cumpla ambas condiciones (el caso del SUPER_ADMIN
// vendiendo dentro de una empresa activa que no es "la suya" — su propia fila
// de Usuario tiene empresaId nulo), esta función devuelve null. El caller lo
// trata como "no es un revendedor de esta empresa": sin saldo que verificar,
// sin movimiento que registrar. Es la misma conclusión a la que llegaría
// `tx.usuario.findUnique({ where: { id } })` bajo el cliente extendido
// (prismaParaEmpresa inyecta el mismo filtro de empresaId), así que no es un
// caso nuevo, solo el primero en tocar la tabla Usuario en medio de una venta.
//
// SIN SKIP LOCKED, a propósito — a diferencia de tomarPantallasDisponibles
// (R2). Con SKIP LOCKED, dos ventas simultáneas del mismo revendedor se
// saltarían la fila bloqueada por la otra y ambas leerían el saldo viejo: es
// exactamente el bug de doble gasto que este bloqueo existe para evitar. Debe
// esperar a que la transacción que la tiene bloqueada termine.
//
// Orden global de bloqueos dentro de la transacción de venta (ver
// lib/ventas.ts): PRIMERO esta fila (la más específica — una por vendedor),
// DESPUÉS las pantallas con FOR UPDATE SKIP LOCKED. Dos tipos de bloqueo sin
// un orden fijo es un deadlock esperando a pasar.
// ---------------------------------------------------------------------------

type ClienteTx = Prisma.TransactionClient;

export interface UsuarioBloqueado {
  id: string;
  rol: Rol;
  saldo: Prisma.Decimal;
}

/**
 * Bloquea (FOR UPDATE, sin SKIP LOCKED: espera) la fila de Usuario `usuarioId`
 * dentro de la empresa `empresaId`, y devuelve su `rol`/`saldo` vigentes. El
 * saldo es exclusivo de VENDEDOR (revendedor) — un EMPLEADO nunca lo usa,
 * sin importar lo que diga la columna `usaSaldo`, que ya no se lee en código.
 * Devuelve null si no existe una fila de Usuario con ese id Y ese empresaId.
 */
export async function bloquearUsuarioParaVenta(
  tx: ClienteTx,
  empresaId: string,
  usuarioId: string,
): Promise<UsuarioBloqueado | null> {
  const filas = await tx.$queryRaw<UsuarioBloqueado[]>(Prisma.sql`
    SELECT id, rol, saldo
    FROM "Usuario"
    WHERE id = ${usuarioId}
      AND "empresaId" = ${empresaId}
    FOR UPDATE
  `);
  return filas[0] ?? null;
}
