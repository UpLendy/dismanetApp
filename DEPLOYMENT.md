# Despliegue

Arquitectura: **Railway** para el API + PostgreSQL, **Vercel** para el frontend
(Next.js). Se eligió Railway sobre Fly.io por tener Postgres administrado de
primera clase en la misma plataforma — ver la sección "Por qué Railway y no
Fly" al final si se quiere migrar.

```
Vercel (apps/web)  ──HTTPS──>  Railway: servicio API (apps/api, Docker)
                                    │
                                    └── Railway: plugin PostgreSQL
```

## 0. Qué ya está verificado y qué no

Lo que sigue se construyó y se probó de punta a punta **localmente** con
Docker, contra el Postgres de `docker-compose.yml`:

- La imagen (`apps/api/Dockerfile`) compila.
- El contenedor arranca, corre `prisma migrate deploy` (lo deja sin
  pendientes), y responde `GET /salud` con `{"ok":true}`.
- Con `NODE_ENV=production`, el login real devuelve la cookie de sesión con
  `Secure; SameSite=Lax` — el proxy de Next.js hace que el navegador nunca
  vea el dominio de Railway, así que no hace falta `SameSite=None` (ver
  sección 5).

Lo que **no** se pudo verificar porque requiere crear/acceder a cuentas en
Railway y Vercel que no están disponibles en este entorno: la creación real
de los servicios, que las variables de entorno se configuren correctamente
en sus paneles, y el primer despliegue real. Los pasos de abajo son exactos
y reproducibles, pero alguien con acceso a esas cuentas debe ejecutarlos y
confirmar el resultado.

## 1. API en Railway

### 1.1 Crear el proyecto

1. Railway → New Project → Deploy from GitHub repo → seleccionar este repo.
2. Add a service → Database → PostgreSQL. Railway genera `DATABASE_URL`
   automáticamente para los servicios del mismo proyecto — **no la escribas
   a mano**, referénciala desde el servicio del API con
   `${{Postgres.DATABASE_URL}}`.
3. Add a service → GitHub repo (el mismo repo) → esta vez para el API.
   - Root Directory: `/` (la raíz del monorepo — el Dockerfile necesita
     `bun.lock` y `packages/shared`, que viven fuera de `apps/api`).
   - Railway detecta `railway.json` en la raíz y usa
     `apps/api/Dockerfile` como build. Si el dashboard no lo recoge solo,
     configúralo a mano en Settings → Build.

### 1.2 Variables de entorno del servicio API

| Variable | Valor | Notas |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Referencia al plugin, no un valor fijo |
| `JWT_SECRET` | `openssl rand -hex 32` | Firma las sesiones. Rotarla cierra la sesión de todos los usuarios |
| `CLAVE_CIFRADO` | `openssl rand -hex 32` | Cifra contraseñas/pines de cuentas. **Si se pierde, esos datos son irrecuperables** (ver `src/lib/cifrado.ts`). Generarla una sola vez y guardarla también fuera de Railway (gestor de secretos del equipo) |
| `NODE_ENV` | `production` | Activa `secure` en las cookies y el chequeo estricto del seed. `SameSite` sale de `SAME_SITE_COOKIE_SESION` (ver sección 5), no de `NODE_ENV` |
| `WEB_URL` | `https://<tu-app>.vercel.app` | Origen exacto para CORS (sin barra final). Se actualiza después de desplegar el web (ver 1.4) |
| `PORT` | (dejar que Railway lo inyecte) | Elysia ya lee `process.env.PORT` |

Credenciales del seed (`SEED_SUPERADMIN_EMAIL/PASSWORD`,
`SEED_ADMIN_EMAIL/PASSWORD`, `SEED_VENDEDOR_EMAIL/PASSWORD`) **no** son
necesarias para que el servicio arranque — el seed se corre una sola vez, a
mano (sección 1.3). Si no se definen y `NODE_ENV=production`, el seed falla
en vez de crear cuentas con las contraseñas de ejemplo de este repositorio
(ver `src/lib/credenciales-seed.ts`).

### 1.3 Primer despliegue y seed inicial

1. Deploy. Railway construye la imagen y, en el arranque del contenedor,
   corre `npx prisma migrate deploy` antes de `bun run src/index.ts` (ver
   `CMD` del Dockerfile) — las migraciones quedan aplicadas antes de que el
   servicio acepte tráfico.
2. Verificar: `curl https://<tu-api>.up.railway.app/salud` → `{"ok":true}`.
3. Correr el seed **una sola vez**, con el CLI de Railway para que use las
   variables de entorno reales del servicio:
   ```bash
   railway link              # selecciona el proyecto/servicio del API
   railway run --service api -- \
     env SEED_SUPERADMIN_EMAIL=... SEED_SUPERADMIN_PASSWORD=... \
         SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... \
         SEED_VENDEDOR_EMAIL=... SEED_VENDEDOR_PASSWORD=... \
     bun run prisma/seed.ts
   ```
   El seed usa `upsert`, así que volver a correrlo no duplica usuarios.

### 1.4 Resolver la dependencia circular de dominios

El API necesita `WEB_URL` (para CORS) y el web necesita la URL del API (para
`NEXT_PUBLIC_API_URL`), pero cada plataforma solo asigna el dominio después
del primer deploy. Orden recomendado:

1. Desplegar el API primero con `WEB_URL` apuntando a cualquier valor
   temporal (ej. `http://localhost:3000`).
2. Desplegar el web (sección 2) con `NEXT_PUBLIC_API_URL` = la URL real que
   Railway ya asignó al API.
3. Volver a Railway y actualizar `WEB_URL` con la URL real que Vercel
   asignó al web. Railway redespliega solo al cambiar una variable.

## 2. Web en Vercel

1. Vercel → Add New → Project → importar el repo.
2. Root Directory: `apps/web`. Vercel detecta Next.js solo (build/start
   command por defecto).
3. Variables de entorno (Production):

   | Variable | Valor |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<tu-api>.up.railway.app` |

4. Deploy. Luego completar el paso 1.4.3 de arriba (actualizar `WEB_URL` en
   Railway).

## 3. Migraciones

`npx prisma migrate deploy` corre en **cada** arranque del contenedor (parte
del `CMD` del Dockerfile), nunca `migrate dev`: `deploy` solo aplica
migraciones que ya existen en `prisma/migrations/` (committeadas), nunca
genera una nueva ni resetea datos. Es idempotente — si no hay pendientes,
no hace nada (así se verificó localmente en la sección 0).

### Si una migración falla a la mitad

`migrate deploy` aplica las migraciones pendientes en orden; si una falla,
Prisma la marca como fallida en la tabla `_prisma_migrations` y el
contenedor no arranca (el `&&` del `CMD` corta antes de `bun run
src/index.ts` — el servicio viejo sigue sirviendo tráfico mientras tanto,
gracias al healthcheck de Railway, que no promueve el deploy nuevo si el
contenedor no levanta).

1. Mirar el log del deploy fallido para identificar la migración y el error
   SQL exacto.
2. Conectarse a la base de datos de producción y revisar a mano si la
   migración alcanzó a aplicar parte de su SQL (Postgres ejecuta cada
   *statement* de la migración en su propia transacción salvo que el
   archivo use `BEGIN`/`COMMIT` explícito — revisar el archivo `.sql` de esa
   migración para saber qué statements pudieron haber quedado aplicados).
3. Corregir el problema de fondo (ej. una columna NOT NULL sin default
   sobre una tabla con filas existentes) y decidir:
   - Si la migración **no** aplicó nada (falló en el primer statement):
     corregir el archivo de migración (solo si todavía no se desplegó en
     ningún otro ambiente) y volver a desplegar.
   - Si la migración **sí** aplicó su efecto a pesar del error reportado
     (statement posterior falló, pero el DDL ya corrió):
     ```bash
     npx prisma migrate resolve --applied <nombre_de_la_migracion>
     ```
   - Si se revirtió el efecto a mano (`DROP`/`ALTER` manual para dejar el
     esquema como estaba):
     ```bash
     npx prisma migrate resolve --rolled-back <nombre_de_la_migracion>
     ```
4. Redesplegar. `migrate deploy` continúa desde la siguiente migración
   pendiente.

Por esto CLAUDE.md pide una migración por entrega y nunca editar una ya
aplicada: `resolve --applied` asume que el contenido del archivo es
exactamente lo que corrió en producción.

## 4. Backups diarios

Railway Postgres (plan Pro) incluye snapshots automáticos diarios con
retención configurable desde el dashboard del plugin (Database → Backups) —
confirmar la retención deseada ahí; no requiere configuración adicional en
este repo.

Como respaldo independiente de la plataforma (y para no depender de un plan
de pago específico), un cron diario con `pg_dump`:

```bash
#!/usr/bin/env bash
set -euo pipefail
FECHA=$(date +%Y-%m-%d)
pg_dump "$DATABASE_URL" --format=custom --file="dismanet-$FECHA.dump"
# subir dismanet-$FECHA.dump a almacenamiento externo (S3, Backblaze, etc.)
# y borrar dumps locales/remotos con más de N días de antigüedad.
```

Programarlo con un Cron Service de Railway (un servicio del mismo proyecto,
sin puerto expuesto, con este script como start command y acceso a
`DATABASE_URL`) o con un workflow de GitHub Actions con `schedule:`.

### Restaurar

```bash
# Contra una base NUEVA y vacía — nunca sobre la de producción en caliente.
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL_DESTINO" dismanet-2026-10-02.dump
```

Luego de restaurar, correr `npx prisma migrate deploy` contra esa base
antes de apuntar el servicio a ella, por si el dump es más viejo que el
código que se va a correr contra él.

## 5. Cookies entre dominios — resuelto con un proxy, no con SameSite=None

`apps/web` y `apps/api` viven en dominios distintos (`*.vercel.app` /
`*.up.railway.app`), pero el navegador **nunca ve el dominio de Railway**:
`apps/web/next.config.ts` define un rewrite (`/api/:path*` →
`${API_INTERNAL_URL}/:path*`) y el cliente de Eden Treaty (`lib/api.ts`)
llama a `window.location.origin + "/api"` desde el navegador. Es Vercel
quien retransmite esa petición al API servidor-a-servidor — una llamada que
el navegador no gobierna y que por lo tanto no es cross-site.

Con esto, para el navegador **todo el tráfico es del mismo origen**: la
cookie de sesión (`src/plugins/contexto.ts`, `SAME_SITE_COOKIE_SESION`) usa
`sameSite: "lax"` en producción igual que en desarrollo. Ya no hace falta
`"none"` — que exigía `secure: true` + HTTPS y, sobre todo, dejaba que
cualquier sitio de terceros disparara peticiones autenticadas contra el API
mientras el navegador conservara la cookie (CSRF).

**Si en el futuro se quita el proxy** (el frontend vuelve a apuntar directo
al dominio de Railway vía `NEXT_PUBLIC_API_URL` desde el navegador), esto se
rompe: el navegador deja de reenviar la cookie en esas llamadas cross-site y
el login "funciona" pero se cae de inmediato. Hay que volver a
`sameSite: "none"` — posible sin tocar código, fijando la variable de
entorno `SAME_SITE_COOKIE_SESION=none` en el servicio del API — y asumir que
eso reabre la superficie de CSRF hasta donde la alcanza a mitigar la lista
blanca de `Origin` (`src/plugins/origen.ts`, variable `ORIGENES_PERMITIDOS`).

Variables de entorno relevantes:

| Variable | Valor en producción | Qué hace |
|---|---|---|
| `SAME_SITE_COOKIE_SESION` | sin definir → cae a `"lax"` | Atributo `SameSite` de la cookie de sesión |
| `ORIGENES_PERMITIDOS` | sin definir → cae a `WEB_URL` | Lista blanca (separada por coma) de `Origin` aceptados en POST/PUT/PATCH/DELETE |

## 6. Health check

`GET /salud` → `{"ok":true}` (`src/index.ts`), sin tocar la base de datos —
es una señal de "el proceso está vivo", no de "la base de datos responde".
Ya wireado en `railway.json` (`deploy.healthcheckPath`). En Fly.io el
equivalente es `[[http_service.checks]]` en `fly.toml` apuntando a la misma
ruta.

## Por qué Railway y no Fly

Ambos cumplen lo que pide esta entrega (Docker, healthcheck, variables de
entorno, Postgres administrado). Se eligió Railway porque su plugin de
Postgres vive en el mismo proyecto que el API (una sola cuenta, un solo
dashboard, referencias de variables como `${{Postgres.DATABASE_URL}}` sin
copiar strings de conexión a mano). Migrar a Fly.io más adelante no
requiere cambios en `apps/api/Dockerfile` — solo escribir un `fly.toml` que
apunte a él y mover `DATABASE_URL`/`JWT_SECRET`/`CLAVE_CIFRADO` a `fly
secrets set`.
