import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { verificarEntorno } from "./lib/entorno.ts";
import { auth } from "./routes/auth.ts";
import { empresas } from "./routes/empresas.ts";
import { usuarios } from "./routes/usuarios.ts";
import { plataformas } from "./routes/plataformas.ts";
import { duraciones } from "./routes/duraciones.ts";
import { tiposCliente } from "./routes/tipos-cliente.ts";
import { paquetes } from "./routes/paquetes.ts";
import { precios } from "./routes/precios.ts";
import { cuentas } from "./routes/cuentas.ts";
import { disponibilidad } from "./routes/disponibilidad.ts";
import { ventas } from "./routes/ventas.ts";
import { garantias } from "./routes/garantias.ts";
import { plantillas } from "./routes/plantillas.ts";
import { perfil } from "./routes/perfil.ts";
import { manejadorErrores } from "./plugins/errores.ts";
import { validarOrigen } from "./plugins/origen.ts";

verificarEntorno();

const app = new Elysia()
  .use(
    cors({
      origin: process.env.WEB_URL ?? "http://localhost:3000",
      credentials: true,
    }),
  )
  // Red de seguridad para errores no manejados: el cuerpo que llega al
  // cliente nunca trae ids ni detalles internos (ver plugins/errores.ts).
  .use(manejadorErrores)
  // Defensa en profundidad contra CSRF (ver plugins/origen.ts): independiente
  // de SAME_SITE_COOKIE_SESION, así que sigue protegiendo aunque la cookie se
  // reconfigure mal en el futuro.
  .use(validarOrigen)
  .get("/salud", () => ({ ok: true }))
  .use(auth)
  .use(empresas)
  .use(usuarios)
  .use(plataformas)
  .use(duraciones)
  .use(tiposCliente)
  .use(paquetes)
  .use(precios)
  .use(cuentas)
  .use(disponibilidad)
  .use(ventas)
  .use(garantias)
  .use(plantillas)
  .use(perfil);

export type App = typeof app;

app.listen(process.env.PORT ?? 3001, () => {
  console.log(
    `🦊 API corriendo en http://${app.server?.hostname}:${app.server?.port}`,
  );
});
