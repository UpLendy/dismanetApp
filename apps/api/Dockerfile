# Construir con el ROOT DEL MONOREPO como contexto, no apps/api:
#   docker build -f apps/api/Dockerfile .
# El lockfile (bun.lock) vive en la raíz del workspace, no en apps/api.
#
# La app corre con Bun, pero el CLI de Prisma tiene bugs conocidos bajo Bun
# (prisma/prisma#28805, ver CLAUDE.md), así que esta imagen trae los dos
# runtimes: Node solo para `npx prisma ...`, Bun para todo lo demás.
FROM oven/bun:1-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile

COPY apps/api apps/api
COPY packages/shared packages/shared

WORKDIR /app/apps/api

# El cliente de Prisma se genera en src/generated/prisma (gitignored) y
# `prisma migrate deploy` NO lo genera por sí solo — hay que hacerlo en el
# build, no solo al arrancar, para que falle temprano si el schema es
# inválido en vez de fallar en el primer query ya en producción.
RUN npx prisma generate

EXPOSE 3001

# migrate deploy corre cada arranque, no solo el primero: es idempotente
# (no reaplica migraciones ya registradas en _prisma_migrations) y así cada
# despliegue nuevo aplica las migraciones pendientes antes de aceptar
# tráfico. Nunca `migrate dev` aquí — esa variante puede generar una
# migración nueva o resetear datos; en producción solo se aplican las que ya
# están commiteadas. Ver DEPLOYMENT.md si `migrate deploy` falla a la mitad.
CMD ["sh", "-c", "npx prisma migrate deploy && bun run src/index.ts"]
