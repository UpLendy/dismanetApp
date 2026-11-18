# Construir con el ROOT DEL MONOREPO como contexto, no apps/web:
#   docker build -f apps/web/Dockerfile .
# El lockfile (bun.lock) vive en la raíz del workspace, no en apps/web.
#
# apps/web depende por workspace de @dismanet/api y @dismanet/shared.
# @dismanet/api expone sus tipos (el `App` de Eden Treaty) directo desde
# src/index.ts (ver "module"/"types" en su package.json) — por eso el
# chequeo de tipos de `next build` necesita el código fuente completo de
# apps/api, no solo prisma/schema.prisma.
#
# Ese build de apps/api también corre `prisma generate`: el frontend no
# habla con la base, pero los tipos de @dismanet/api reexportan el cliente
# generado, así que tienen que existir para que los tipos resuelvan. El CLI
# de Prisma tiene bugs conocidos bajo Bun (prisma/prisma#28805, ver
# CLAUDE.md): Node solo para `npx prisma ...`, Bun para todo lo demás —
# mismo patrón que apps/api/Dockerfile.
FROM oven/bun:1-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile

COPY apps/web apps/web
COPY apps/api apps/api
COPY packages/shared packages/shared

WORKDIR /app/apps/web

# NEXT_PUBLIC_API_URL se inlinea en el bundle del navegador EN ESTE PASO, no
# en runtime. Y next.config.ts lee API_INTERNAL_URL/NEXT_PUBLIC_API_URL
# dentro de `rewrites()`, que Next resuelve una sola vez durante el build y
# deja fijo en .next/routes-manifest.json — `next start` no lo vuelve a
# evaluar. Si estas variables no llegan como ARG de build (Railway las
# puebla solo si el Dockerfile las declara), el proxy /api/* queda
# apuntando a localhost:3001 para siempre, sin importar qué se configure
# después en runtime.
ARG NEXT_PUBLIC_API_URL
ARG API_INTERNAL_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV API_INTERNAL_URL=$API_INTERNAL_URL

# El generate escribe en apps/api/src/generated/prisma (el "output" del
# schema) — hace falta en disco para que los tipos de @dismanet/api, que lo
# reexportan, resuelvan durante el chequeo de tipos de `next build`.
RUN npx prisma generate --schema=../api/prisma/schema.prisma && bunx next build

EXPOSE 3000

# Nunca migrar acá: `prisma migrate deploy` es responsabilidad exclusiva de
# apps/api/Dockerfile. Este contenedor solo sirve el build ya hecho.
CMD ["sh", "-c", "bunx next start -p ${PORT:-3000}"]
