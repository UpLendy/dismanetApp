# Sistema Interno de Gestión — MVP Módulo de Ventas

Plataforma multi-empresa para revendedores de cuentas de streaming.
Cliente inicial: DISMANET.

## Documentos

| Archivo | Qué es |
|---|---|
| `PRD-MVP-Ventas.md` | Especificación completa. **Fuente de verdad del proyecto.** |
| `CLAUDE.md` | Reglas no negociables y convenciones. Lo lee Claude Code en cada sesión. |
| `PROMPTS-Claude-Code.md` | Secuencia de desarrollo, un prompt por entrega. |
| `DEPLOYMENT.md` | Despliegue a producción: Railway (API + Postgres) + Vercel (web), migraciones, backups, health check. |

## Estructura

```
apps/api        Elysia + Prisma        (puerto 3001)
apps/web        Next.js                (puerto 3000)
packages/shared tipos compartidos
```

## Requisitos

- Bun
- PostgreSQL 16+ (local o en Docker)
- Node, únicamente para el CLI de Prisma

## Arranque

```bash
cp .env.example .env     # y completar las claves
bun install
npx prisma migrate dev   # con Node, no con Bun
bun run seed
bun run dev
```

## Nota sobre Prisma

El CLI de Prisma tiene problemas ejecutándose bajo Bun
([prisma/prisma#28805](https://github.com/prisma/prisma/issues/28805)).
Los comandos `prisma` van con `npx`. La aplicación sí corre con Bun.
