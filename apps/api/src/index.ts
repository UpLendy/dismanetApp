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
import { plantillas } from "./routes/plantillas.ts";
import { manejadorErrores } from "./plugins/errores.ts";

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
  .use(plantillas);

export type App = typeof app;

app.listen(process.env.PORT ?? 3001, () => {
  console.log(
    `🦊 API corriendo en http://${app.server?.hostname}:${app.server?.port}`,
  );
});
