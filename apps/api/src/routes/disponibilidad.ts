import { Elysia, t } from "elysia";
import { pantallasDisponibles } from "../lib/pantallas.ts";
import { prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaConteo = t.Object({
  plataformaId: t.String(),
  nombre: t.String(),
  usaPerfilPin: t.Boolean(),
  capacidadPantallas: t.Number(),
  libres: t.Number(),
  total: t.Number(),
});

// Parte 4 del PRD — endpoint separado de cuentas.ts, abierto a VENDEDOR (y
// por jerarquía a EMPLEADO/ADMIN/SUPER_ADMIN): solo conteos por plataforma,
// cero credenciales. El vendedor no tiene, ni debe tener, acceso a /cuentas
// (D6: la base de correos/contraseñas es exclusiva de ADMIN). usaPerfilPin
// y capacidadPantallas se incluyen porque EMPLEADO usa este mismo endpoint
// para poblar el selector de plataforma del formulario de "nueva cuenta"
// (capacidadPantallas es cuántas pantallas va a generar la plantilla) —
// GET /plataformas es ADMIN-only, así que este es el único catálogo de
// plataformas al que EMPLEADO tiene acceso.
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
        select: { id: true, nombre: true, usaPerfilPin: true, capacidadPantallas: true },
      });

      const conteos = await Promise.all(
        plataformas.map(async (plataforma) => {
          const estados = await pantallasDisponibles(cliente, plataforma.id);
          return {
            plataformaId: plataforma.id,
            nombre: plataforma.nombre,
            usaPerfilPin: plataforma.usaPerfilPin,
            capacidadPantallas: plataforma.capacidadPantallas,
            libres: estados.filter((p) => p.libre).length,
            total: estados.length,
          };
        }),
      );

      return { disponibilidad: conteos };
    },
    { response: { 200: t.Object({ disponibilidad: t.Array(esquemaConteo) }) } },
  );
