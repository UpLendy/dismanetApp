# F6.1 — Cargos y asignación a empleados

Primera entrega del bloque de empleados (Fase 2 B). Es la base: el
calendario, las comisiones y los reportes por cargo dependen de que esto
exista. No incluye nada de horarios, comisiones ni reportes.

## La decisión que define esta entrega

Los cargos **no son `Rol`**, y no se tocan entre sí.

`Rol` (VENDEDOR 0, EMPLEADO 1, ADMIN 2, SUPER_ADMIN 3) es la escala de
permisos: tiene rango numérico y de él dependen todas las guardas del
sistema (R4). Un **cargo** es el oficio: Gerencia, Coordinación, Soporte
técnico, Seguimiento, Asesores comerciales. No ordena nada y no concede
nada.

Un coordinador puede tener menos permisos que un asesor, y eso tiene que
ser posible. Si se mezclan, cambiar el cargo de alguien le cambia los
permisos sin querer.

**No modifiques el enum `Rol`, ni `RANGO_ROL`, ni ninguna guarda.** Si algo
de esta entrega parece pedirlo, para y dime.

## Parte 1 — Esquema

### 1.1 Modelo `Cargo`

```prisma
model Cargo {
  id        String   @id @default(cuid())
  empresaId String
  nombre    String
  activo    Boolean  @default(true)
  createdAt DateTime @default(now())
  // relación a Empresa y a Usuario[], índices y @@unique([empresaId, nombre])
  // siguiendo exactamente el patrón de Duracion / TipoCliente.
}
```

Multi-tenant como todo lo demás (R1): `empresaId` y relación a `Empresa`,
para que la extensión de aislamiento lo cubra.

### 1.2 `Usuario.cargoId`

`cargoId String?` con relación a `Cargo`, **nullable**: los usuarios que ya
existen no tienen cargo y eso es válido.

Va en `Usuario`, no en una tabla `PerfilEmpleado` aparte. `Usuario` ya
carga campos de negocio (`usaSaldo`, `saldo`), y una tabla 1:1 agregaría un
join en cada lectura sin dar nada a cambio. Las entregas siguientes
(valor hora, etc.) suman campos aquí mismo.

### 1.3 Migración

**Solo DDL**, sin sembrar datos adentro — la migración de F4.11 funcionó
bien así y mantiene el despliegue reversible. No se agregan valores a
ningún enum, así que va en un solo archivo.

### 1.4 Los cinco cargos por defecto

- Donde el sistema siembra una **empresa nueva** (busca el sitio que ya
  crea sus plantillas y catálogo inicial), agrega los cinco: Gerencia,
  Coordinación, Soporte técnico, Seguimiento, Asesores comerciales.
- Para las empresas **que ya existen**, un script idempotente siguiendo la
  convención de `migrar-costo-plataforma.ts`: si el cargo ya está, no lo
  duplica. Que se pueda correr dos veces sin daño.

## Parte 2 — API

Rutas `/cargos`, **solo ADMIN**, copiando el patrón de `/duraciones` o
`/tipos-cliente` (mira uno de los dos y síguelo, no inventes forma nueva):

- `GET /cargos` — listado, con filtro opcional por estado.
- `POST /cargos` — crear.
- `PATCH /cargos/:id` — renombrar. Esto cubre "el cargo debe ser
  modificable para cada uno".
- `PATCH /cargos/:id/activar` y `/desactivar`.

**Nunca se borra un cargo, se desactiva** (R3 y la convención del resto del
catálogo). Un cargo desactivado deja de ofrecerse para asignaciones nuevas,
pero los usuarios que ya lo tienen lo conservan: su historial no cambia
porque alguien reorganice el catálogo. Escribe eso como comentario.

Nombre único por empresa: crear o renombrar a un nombre que ya existe en
esa empresa responde 409, no 500 por el índice.

### Asignación

En las rutas de crear y editar usuario (`routes/usuarios.ts`), un
`cargoId` opcional. Validar que el cargo exista, **sea de la misma
empresa** y esté activo al momento de asignarlo. Que `GET /usuarios`
devuelva el cargo (id y nombre) de cada uno.

## Parte 3 — Frontend

- **Página de catálogo** en `panel/catalogo/cargos`, siguiendo el patrón de
  las otras páginas de catálogo, y su entrada en el sidebar
  (`apps/web/lib/nav.ts`, grupo CONFIGURACIÓN, `rolMinimo: "ADMIN"`).
- **En `panel/usuarios`**: columna de cargo en el listado y selector de
  cargo en los formularios de crear y editar. El selector solo ofrece
  cargos activos, pero si el usuario tiene asignado uno desactivado, se
  muestra tal cual y no se pierde al guardar otros campos.

No toques la pastilla de activo/inactivo que ya existe ahí; esta entrega no
cambia nada de eso.

## Parte 4 — Pruebas

- R1: los cargos de la empresa A nunca salen en la empresa B; asignarle a
  un usuario un `cargoId` de otra empresa falla.
- Rol: EMPLEADO y VENDEDOR reciben 403 en todas las rutas de `/cargos`.
- Nombre duplicado en la misma empresa responde 409; el mismo nombre en dos
  empresas distintas es válido.
- Desactivar un cargo no desasigna a los usuarios que lo tienen.
- Un usuario sin cargo (`null`) se crea, se edita y se lista sin problema.
- El script de los cinco cargos corrido dos veces no duplica nada.

Las pruebas corren desde `apps/api`, y recuerda que `mock.module` en Bun es
global al proceso.

## Lo que NO entra

- Calendario, turnos, horas, comisiones, metas, reportes semanales,
  estadísticas por empleado, instrucciones con video. Todo eso viene
  después y depende de esto.
- Cualquier cambio a `Rol`, `RANGO_ROL` o las guardas de permisos.
- Tocar el activo/inactivo de usuario que ya funciona.

## Al terminar

Reporta archivos tocados —la lista real, verificada contra `git status`— y
pruebas antes y después. Si algo te obligó a rozar `Rol` o las guardas,
dilo explícitamente en vez de resolverlo por tu cuenta.
