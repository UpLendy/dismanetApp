import { Elysia } from "elysia";

// Defensa en profundidad para CSRF, independiente de la configuración de la
// cookie de sesión (SAME_SITE_COOKIE_SESION): toda petición que cambia
// estado debe declarar un Origin dentro de la lista blanca, sin importar si
// la cookie viaja o no. Si el día de mañana alguien reintroduce
// SameSite=None por error, esto sigue bloqueando el origen ajeno.
const METODOS_QUE_CAMBIAN_ESTADO = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ORIGENES_PERMITIDOS admite varios separados por coma (ej. producción +
// una vista previa de Vercel). Sin esa variable, cae a WEB_URL —la misma
// que ya configura el CORS en index.ts— para no duplicar el valor en dos
// variables de entorno en el caso común de un solo origen.
function origenesPermitidos(): string[] {
  const lista = process.env.ORIGENES_PERMITIDOS ?? process.env.WEB_URL ?? "http://localhost:3000";
  return lista
    .split(",")
    .map((origen) => origen.trim())
    .filter((origen) => origen.length > 0);
}

export const validarOrigen = new Elysia({ name: "validar-origen" }).onBeforeHandle(
  { as: "global" },
  ({ request, set }) => {
    if (!METODOS_QUE_CAMBIAN_ESTADO.has(request.method)) return;

    const origen = request.headers.get("origin");
    // Sin encabezado Origin: peticiones servidor-a-servidor (el layout de
    // Next.js, el healthcheck de Railway, curl) no lo envían y no las
    // gobierna el navegador — no hay CSRF que mitigar ahí.
    if (!origen) return;

    if (!origenesPermitidos().includes(origen)) {
      set.status = 403;
      return {
        error: {
          codigo: "ORIGEN_NO_PERMITIDO",
          mensaje: "Esta petición no está permitida desde ese origen.",
        },
      };
    }
  },
);
