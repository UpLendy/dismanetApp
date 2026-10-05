import { Elysia } from "elysia";
import { Rol } from "../generated/prisma/client.ts";
import { contexto } from "./contexto.ts";

// R4 — Cada endpoint valida el rol antes de ejecutar. Estas guardas se
// aplican a nivel de ruta (`.use(requiereRol("ADMIN"))`), nunca dentro del
// handler: ocultar un botón en el frontend no es control de acceso.

/** Exige que la petición tenga una sesión válida, sin importar el rol. */
export const requiereAutenticacion = new Elysia({ name: "requiere-autenticacion" })
  .use(contexto)
  .onBeforeHandle({ as: "scoped" }, ({ contexto, set }) => {
    if (!contexto.usuarioId) {
      set.status = 401;
      return { error: { codigo: "NO_AUTENTICADO", mensaje: "Debes iniciar sesión para continuar." } };
    }
  });

// SUPER_ADMIN puede operar dentro de cualquier empresa: jerarquía, no lista
// cerrada de roles exactos. requiereRol(rol) exige ese rol como mínimo.
const RANGO_ROL: Record<Rol, number> = {
  [Rol.VENDEDOR]: 0,
  [Rol.ADMIN]: 1,
  [Rol.SUPER_ADMIN]: 2,
};

export const requiereRol = (rolMinimo: Rol) =>
  new Elysia({ name: `requiere-rol-${rolMinimo}` })
    .use(requiereAutenticacion)
    .onBeforeHandle({ as: "scoped" }, ({ contexto, set }) => {
      if (!contexto.rol || RANGO_ROL[contexto.rol] < RANGO_ROL[rolMinimo]) {
        set.status = 403;
        return {
          error: { codigo: "PERMISO_DENEGADO", mensaje: "No tienes permiso para realizar esta acción." },
        };
      }
    });
