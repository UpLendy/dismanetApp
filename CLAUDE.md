# CLAUDE.md — Reglas del proyecto

Sistema Interno de Gestión — MVP del módulo de ventas. Plataforma multi-empresa.

La especificación completa está en `PRD-MVP-Ventas.md`. **Léela antes de escribir código.** Si algo no está ahí, no está en el alcance: pregunta antes de construirlo.

---

## Stack

- **Runtime:** Bun · **API:** Elysia.js · **ORM:** Prisma 7 · **BD:** PostgreSQL 16+
- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- **Cliente de API:** Eden Treaty · **Auth:** `@elysiajs/jwt` + Argon2id
- **Validación:** esquemas TypeBox de Elysia en cada endpoint

```
apps/api     Elysia + Prisma
apps/web     Next.js
packages/shared   tipos y constantes compartidos
```

---

## Reglas no negociables

### R1 — Aislamiento entre empresas

Ninguna consulta a una tabla con `empresaId` se ejecuta sin filtrar por la empresa del usuario autenticado.

Se implementa con una **extensión de Prisma Client** (`$extends`) que:
- inyecta `where: { empresaId }` en `findMany`, `findFirst`, `findUnique`, `update`, `updateMany`, `delete`, `deleteMany`, `count` y `aggregate`
- inyecta `data.empresaId` en `create` y `createMany`

El cliente Prisma sin extender (`prismaRaw`) solo se usa en el seed y en el login, antes de conocer la empresa. **Nunca en un handler de negocio.**

Si escribes un query que necesita saltarse la extensión, para y consulta primero.

**Cobertura por operación, no solo por modelo.** La extensión debe cubrir *todas* las operaciones de Prisma sobre los modelos con `empresaId`, no solo las que ya se usaron. Una operación no envuelta es una fuga silenciosa: funciona, devuelve datos, y devuelve los de todas las empresas.

Operaciones que deben estar cubiertas o bloqueadas explícitamente: `findUnique`, `findUniqueOrThrow`, `findFirst`, `findFirstOrThrow`, `findMany`, `create`, `createMany`, `createManyAndReturn`, `update`, `updateMany`, `updateManyAndReturn`, `upsert`, `delete`, `deleteMany`, `count`, `aggregate`, `groupBy`.

`upsert` no se puede filtrar de forma segura, porque su `where` exige un selector único y no siempre admite `empresaId`. **Debe lanzar un error explícito** diciendo que se use `findFirst` + `create`/`update` con manejo de P2002. Es preferible un error ruidoso a un filtro silenciosamente incorrecto.

`aggregate` y `groupBy` son especialmente peligrosos: alimentan los totales del administrador. Sin filtrar, DISMANET vería sumado el dinero de otras empresas.

**Las transacciones también.** `prismaRaw.$transaction(tx => …)` entrega un `tx` sin extender: toda operación dentro de ese bloque consulta sin filtro de empresa. La transacción se abre siempre desde el cliente extendido, y el `tx` que entrega debe venir extendido con el mismo `empresaId`. Las pruebas deben ejercer las operaciones dentro de una transacción, no solo fuera.

**El SQL crudo tampoco.** `$queryRaw` y `$executeRaw` no pasan por la extensión: el `empresaId` va escrito a mano en el `WHERE`, parametrizado. Confinados a una lista blanca de archivos, con prueba que la vigile. Las variantes `Unsafe` están prohibidas.

### R2 — Asignación atómica de pantallas

La asignación ocurre dentro de una transacción de Postgres con `FOR UPDATE SKIP LOCKED`. Sin eso, dos ventas simultáneas entregan la misma pantalla.

Tres reglas:

1. **Orden determinista de bloqueo.** En una venta de paquete, recorrer las plataformas ordenadas por `plataformaId` ascendente. Sin orden fijo, dos ventas de paquetes que comparten plataformas se bloquean mutuamente.
2. **Todo o nada.** Si alguna plataforma del paquete no aporta su cupo completo, se revierte la transacción entera. Una venta de paquete nunca queda a medias.
3. **No sustituir** por "buscar pantalla libre, luego insertar la venta". Esa secuencia tiene condición de carrera aunque esté dentro de una transacción.

### R3 — Inmutabilidad del histórico

`Venta` guarda copia de `precioVenta`, `costo`, `utilidad`, `cantidadDuracion`, `unidadDuracion`, `nombreItem`, `nombreDuracion`, `nombreTipoCliente` y `mensajeGenerado`. `VentaDetalle` guarda copia de `nombrePlataforma`, `correoCuenta` y `passwordCuenta`. Todos esos campos se escriben una vez al crear la venta y **nunca se actualizan**.

Editar la plantilla de WhatsApp no cambia los mensajes de ventas ya registradas.

Anular una venta la marca con `anulada = true` y libera todas sus pantallas. No se borra ninguna venta jamás.

Las entidades de catálogo (plataformas, duraciones, tipos de cliente, paquetes, cuentas) se desactivan, no se borran: hay ventas históricas que las referencian.

### R4 — Permisos en el servidor

Cada endpoint valida el rol antes de ejecutar. Ocultar un botón en el frontend no es control de acceso.

En particular: ningún endpoint devuelve `costo`, `utilidad` ni `margen` cuando quien consulta tiene rol `VENDEDOR`. La exclusión se hace en el `select` de Prisma, no filtrando el objeto después.

### R5 — La disponibilidad se calcula por renglón

Una pantalla está ocupada si existe un `VentaDetalle` con venta no anulada y `VentaDetalle.fechaVencimiento > now()`.

**Nunca** usar `Venta.fechaVencimientoMax` para calcular disponibilidad. Ese campo existe solo para filtrar y ordenar listados.

Un combo puede tener vencimientos distintos por plataforma: "Básico 1" vendido a 30 días lleva Netflix a 28 días y Disney+ a 30. Usar el vencimiento de la venta dejaría la pantalla de Netflix bloqueada dos días de más en cada combo, que es inventario sin vender.

---

## Roles

| Rol | Alcance |
|---|---|
| `SUPER_ADMIN` | Toda la plataforma. `empresaId` nulo. Puede operar dentro de cualquier empresa. |
| `ADMIN` | Su empresa completa, incluyendo cifras financieras. Puede crear una empresa nueva sin conservar acceso a ella. |
| `VENDEDOR` | Vender, ver sus propias ventas sin cifras financieras, consultar disponibilidad. |

---

## Convenciones

- **Idioma:** nombres de entidades, campos, rutas y textos de interfaz en español. Comentarios en español.
- **Dinero:** `Decimal` en Prisma, nunca `Float`. En TypeScript se maneja como string o entero de centavos, nunca como `number` flotante.
- **Fechas:** todo en UTC en la base de datos. La conversión a hora local (`America/Bogota`) se hace en el frontend.
- **Aritmética de duraciones:** usar `date-fns`. `unidad = DIAS` → `addDays`. `unidad = MESES` → `addMonths`, que recorta al último día del mes destino (31 de enero + 1 mes = 28 de febrero). No implementar la suma de meses a mano.
- **Errores:** el API responde con `{ error: { codigo, mensaje } }`. El mensaje es apto para mostrar al usuario final.
- **Restricciones únicas violadas (P2002):** con `@prisma/adapter-pg`, que es el driver de este proyecto, el nombre de la restricción **no** viaja en `error.meta.target` — esa es la forma del motor binario. Viaja en `error.meta.driverAdapterError.cause.constraint.index`. Usar siempre el helper `restriccionViolada()` de la capa de errores, que revisa ambas formas. **Nunca leer `meta.target` directamente.** Cualquier código que dependa de detectar una colisión falla en silencio si lee la forma equivocada: devuelve 500 en vez del error de negocio, y los reintentos por colisión nunca se disparan.
- **Migraciones:** una migración por entrega, con nombre descriptivo. Nunca editar una migración ya aplicada.
- **Scope de las guardas de Elysia:** las guardas de rol van con scope `scoped`, **nunca** `global`. Un hook `global` se propaga hasta la raíz de la app y contamina todo lo que se monte después: una guarda de SUPER_ADMIN en un router termina bloqueando a los ADMIN en routers que ni la declararon.
- **Pruebas de la app compuesta:** probar un router aislado con `.handle()` no detecta fugas de hooks entre routers, porque cada uno se monta solo. Todo router nuevo debe agregarse a `app-compuesta.test.ts`, que monta la app exactamente como `index.ts` y verifica que cada rol alcanza lo que le corresponde en todas las rutas. Una entrega que agrega rutas sin tocar ese archivo está incompleta.
- **Validar antes no reemplaza manejar P2002.** Comprobar que un nombre no existe y luego insertarlo es una condición de carrera: dos peticiones simultáneas pasan ambas la validación y una revienta contra la restricción. Toda ruta que inserte sobre una restricción única debe manejar además el P2002 con `restriccionViolada()`.

---

## Trampa conocida: Prisma CLI bajo Bun

El CLI de Prisma tiene problemas ejecutándose con Bun ([prisma/prisma#28805](https://github.com/prisma/prisma/issues/28805)).

Ejecutar siempre los comandos de Prisma con Node:

```bash
npx prisma migrate dev --name <nombre>
npx prisma generate
```

La aplicación sí corre con Bun. Solo el CLI va con Node.

---

## Definición de "terminado"

Una entrega está terminada cuando:

1. Corre sin errores de tipos (`tsc --noEmit` limpio en ambas apps)
2. La funcionalidad descrita se puede ejecutar de punta a punta desde la interfaz
3. Las pruebas de la entrega pasan
4. No quedan `TODO`, datos quemados ni credenciales en el código
