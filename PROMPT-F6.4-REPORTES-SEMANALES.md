# F6.4 — Reportes semanales por cargo

Cuarta entrega del bloque de empleados. Cubre el punto 5 del cliente:
*"cada cargo tendrá un espacio para generar reportes semanales en texto,
registrando pendientes, fallas y oportunidades de mejora"*.

Depende de F6.1 (cargos). No toca comisiones ni metas.

## Parte 0 — La interpretación, por si hay que corregirla

El cliente escribió "cada cargo tendrá un espacio", pero su punto 6 pide
mostrar "tareas y reportes **pendientes**" por empleado. Un reporte por
cargo no se puede deber: no hay a quién reclamárselo.

Entonces: **cada empleado escribe su propio reporte semanal, y el cargo es
la agrupación al leerlos.** El ADMIN ve "los reportes de Soporte técnico de
esta semana" y también quién no lo ha entregado.

Si el cliente quería literalmente uno por cargo, se cambia después; el
modelo aguanta porque el cargo ya queda guardado en cada reporte.

## Parte 1 — Modelo

```prisma
model ReporteSemanal {
  id            String   @id @default(cuid())
  empresaId     String
  usuarioId     String
  cargoId       String?  // copia del cargo al momento de escribir
  semanaInicio  DateTime // lunes 00:00 Bogotá de la semana que reporta
  pendientes    String
  fallas        String
  oportunidades String
  createdAt     DateTime @default(now())
  actualizadoEn DateTime @updatedAt
  // @@unique([empresaId, usuarioId, semanaInicio])
}
```

**Tres campos de texto, no uno solo.** Son las tres cosas que el cliente
nombró, y separados se pueden comparar semana a semana; en un solo bloque
libre se vuelven un párrafo que nadie relee.

**`cargoId` se copia, no se consulta por relación.** Si a alguien le cambian
el cargo en marzo, su reporte de enero tiene que seguir diciendo el cargo
que tenía cuando lo escribió. Es el mismo principio de copia inmutable que
ya usan `Venta.nombreItem` y `VentaDetalle.nombrePlataforma` (R3). Déjalo
comentado así.

**`semanaInicio` es el lunes a medianoche en Bogotá**, y sale de
`inicioSemanaBogota` de `lib/periodos.ts`, que ya existe y ya está probado.
No escribas aritmética de semanas nueva. El `@@unique` garantiza un reporte
por persona por semana.

## Parte 2 — Reglas

- Se puede crear o editar el reporte de **la semana actual y la
  inmediatamente anterior**. Más atrás, solo lectura.

  El motivo: la gente escribe el lunes sobre la semana que terminó, y eso
  tiene que funcionar. Pero dejar editar cualquier semana convierte el
  historial en algo que se rellena a última hora y deja de valer. Rechaza
  con 409 `SEMANA_CERRADA`.

- Cada quien escribe **el suyo**. El `usuarioId` del body no puede apuntar a
  otro, ni siquiera mandándolo explícito. Un ADMIN **tampoco** escribe
  reportes ajenos: un reporte es el testimonio de quien lo firma, y si el
  ADMIN pudiera escribir por otro, el dato deja de significar lo que dice.
  Esto es a propósito, no una omisión.

- Los tres campos admiten texto vacío (una semana sin fallas es una
  respuesta válida), pero **no los tres a la vez**: un reporte
  completamente vacío es no haber reportado. 400 `REPORTE_VACIO`.

- **EMPLEADO en adelante.** Un VENDEDOR es un revendedor externo y no
  reporta — mismo criterio que F6.3.

## Parte 3 — Rutas

Prefijo `/reportes`, EMPLEADO en adelante.

- `GET /reportes/mio?semana=` — el propio de esa semana, o vacío si no
  existe. `semana` es una fecha cualquiera dentro de la semana; el servidor
  la normaliza al lunes.
- `PUT /reportes/mio` — crea o actualiza el propio (upsert lógico: busca y
  crea o actualiza, **no uses `upsert` de Prisma**, que está bloqueado por
  la extensión multi-tenant).
- `GET /reportes?semana=&cargoId=` — **solo ADMIN**. Los reportes de la
  empresa en esa semana, filtrables por cargo, cada uno con el nombre del
  autor y su cargo.
- `GET /reportes/faltantes?semana=` — **solo ADMIN**. Los usuarios
  `EMPLEADO`+ **activos** que no entregaron el reporte de esa semana, con su
  cargo. Esto es lo que alimenta el "reportes pendientes" del punto 6.

## Parte 4 — Frontend

Página `panel/reportes`, entrada en el sidebar en OPERACIÓN con
`rolMinimo: "EMPLEADO"`.

- **Empleado**: el formulario de la semana actual con los tres campos, un
  selector para moverse a la semana anterior, y su historial en solo
  lectura. Que se vea con claridad si ya entregó o no.
- **ADMIN**: la semana elegida, con los reportes agrupados por cargo, y
  arriba la lista de **quién falta**. Esa lista es el valor real de la
  pantalla: los reportes entregados los lee cuando quiera, pero los que
  faltan los tiene que perseguir.
- Al intentar editar una semana cerrada, el mensaje dice que ya cerró, no un
  error genérico.

## Parte 5 — Pruebas

- Un segundo `PUT` de la misma persona y semana **actualiza**, no crea otro
  (el `@@unique` no se viola).
- Semana actual y anterior: editables. Dos semanas atrás: 409
  `SEMANA_CERRADA`.
- Un reporte escrito a las 23:00 hora Bogotá del domingo pertenece a **esa**
  semana, no a la siguiente (mismo tipo de prueba de zona horaria que ya
  existe en `estadisticas-ventas.test.ts`).
- `usuarioId` en el body apuntando a otro: ignorado o rechazado, nunca
  escribe por otro. Un ADMIN tampoco puede.
- Los tres campos vacíos: 400 `REPORTE_VACIO`. Dos vacíos y uno con texto:
  válido.
- `cargoId` queda copiado: cambiarle el cargo al usuario después **no**
  cambia el cargo del reporte ya escrito.
- `/reportes/faltantes` no incluye usuarios inactivos ni VENDEDOR, y sí
  incluye a un EMPLEADO activo sin reporte.
- Un EMPLEADO recibe 403 en `GET /reportes` y en `/faltantes`.
- Un VENDEDOR recibe 403 en todas.
- R1: nada cruza empresas.

## Lo que NO entra

Metas, comisiones, estadísticas por empleado, instrucciones con video. El
panel individual del punto 6 consumirá `/reportes/faltantes`, pero se
construye después.

## Al terminar

Reporta la lista de archivos tocados **verificada contra `git status`** y
pruebas antes y después.
