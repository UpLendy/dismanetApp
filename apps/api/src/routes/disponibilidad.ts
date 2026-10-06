import { Elysia, t } from "elysia";
import { pantallasDisponibles } from "../lib/pantallas.ts";
import { prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaConteo = t.Object({
  plataformaId: t.String(),
  nombre: t.String(),
  libres: t.Number(),
  total: t.Number(),
});

// Parte 4 del PRD — endpoint separado de cuentas.ts, abierto a VENDEDOR (y
// por jerarquía a ADMIN/SUPER_ADMIN): solo conteos por plataforma, cero
// credenciales. El vendedor no tiene, ni debe tener, acceso a /cuentas
// (D6: la base de correos/contraseñas es exclusiva de ADMIN).
export const disponibilidad = new Elysia({ prefix: "/disponibilidad" })
  .use(requiereRol(Rol.VENDEDOR))
  .onBeforeHandle(({ contexto, set }) => {
    if (!contexto.empresaId) {
      set.status = 400;
      return {
        error: {
          codigo: "SIN_EMPRESA_ACTIVA",
          mensaje: "Selecciona una empresa antes de consultar disponibilidad.",
        },
      };
    }
  })
  .get(
    "/",
    async ({ contexto }) => {
      const cliente = prismaParaEmpresa(contexto.empresaId);
      const plataformas = await cliente.plataforma.findMany({
        where: { activa: true },
        orderBy: { nombre: "asc" },
        select: { id: true, nombre: true },
      });

      const conteos = await Promise.all(
        plataformas.map(async (plataforma) => {
          const estados = await pantallasDisponibles(cliente, plataforma.id);
          return {
            plataformaId: plataforma.id,
            nombre: plataforma.nombre,
            libres: estados.filter((p) => p.libre).length,
            total: estados.length,
          };
        }),
      );

      return { disponibilidad: conteos };
    },
    { response: { 200: t.Object({ disponibilidad: t.Array(esquemaConteo) }) } },
  );
