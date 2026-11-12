import { Elysia, t } from "elysia";
import { contarPantallasPorPlataforma } from "../lib/pantallas.ts";
import { prismaParaEmpresa } from "../lib/prisma-empresa.ts";
import { Rol } from "../generated/prisma/client.ts";
import { requiereRol } from "../plugins/guardas.ts";

const esquemaConteo = t.Object({
  plataformaId: t.String(),
  nombre: t.String(),
  usaPerfilPin: t.Boolean(),
  usaCorreo: t.Boolean(),
  usaUsuario: t.Boolean(),
  usaCodigo: t.Boolean(),
  usaEnlace: t.Boolean(),
  capacidadPantallas: t.Number(),
  libres: t.Number(),
  // F4.11 — pantallas retenidas (vencidas sin reiniciar la cuenta). Sin este
  // número, el vendedor ve 0 libres sin ninguna explicación de por qué.
  porReiniciar: t.Number(),
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
        select: {
          id: true,
          nombre: true,
          usaPerfilPin: true,
          usaCorreo: true,
          usaUsuario: true,
          usaCodigo: true,
          usaEnlace: true,
          capacidadPantallas: true,
        },
      });

      const conteosPorPlataforma = await contarPantallasPorPlataforma(
        cliente,
        plataformas.map((p) => p.id),
      );
      const conteos = plataformas.map((plataforma) => {
        const conteo = conteosPorPlataforma.get(plataforma.id) ?? { libres: 0, porReiniciar: 0, ocupadas: 0 };
        return {
          plataformaId: plataforma.id,
          nombre: plataforma.nombre,
          usaPerfilPin: plataforma.usaPerfilPin,
          usaCorreo: plataforma.usaCorreo,
          usaUsuario: plataforma.usaUsuario,
          usaCodigo: plataforma.usaCodigo,
          usaEnlace: plataforma.usaEnlace,
          capacidadPantallas: plataforma.capacidadPantallas,
          libres: conteo.libres,
          porReiniciar: conteo.porReiniciar,
          total: conteo.libres + conteo.porReiniciar + conteo.ocupadas,
        };
      });

      return { disponibilidad: conteos };
    },
    { response: { 200: t.Object({ disponibilidad: t.Array(esquemaConteo) }) } },
  );
