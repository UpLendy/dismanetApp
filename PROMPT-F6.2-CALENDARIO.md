# F6.2 — Calendario laboral, turnos y festivos

Segunda entrega del bloque de empleados. Depende de F6.1 (cargos) y es la
base de todo lo que sigue: **las comisiones se reparten proporcionalmente a
las horas de este calendario**, así que un error de horas aquí es un error
de plata después.

No incluye comisiones, metas, registro de horas extras por el empleado,
reportes semanales, estadísticas ni videos.

## Parte 1 — Turnos

### 1.1 Modelo `Turno`

```prisma
model Turno {
  id        String   @id @default(cuid())
  empresaId String
  usuarioId String
  inicio    DateTime
  fin       DateTime
  notas     String?
  createdAt DateTime @default(now())
  // relaciones a Empresa y Usuario, índices por (empresaId, usuarioId) y
  // por (empresaId, inicio) — este último para traer una semana completa.
}
```

**`inicio` y `fin` son instantes absolutos, no una fecha más una hora.** Un
turno de 22:00 a 06:00 cruza la medianoche; si se guardara como "fecha +
hora inicio + hora fin" habría que inventar reglas para saber si el fin es
del mismo día o del siguiente, y las horas saldrían mal. Con dos instantes,
la duración es una resta y el caso nocturno no tiene nada especial.

El **día** al que pertenece un turno es la fecha en Bogotá de su `inicio`.
Usa los helpers que ya existen en `lib/periodos.ts` (`inicioDiaBogota`,
`finDiaBogota`, etc.) — no escribas aritmética de zona horaria nueva.

### 1.2 Reglas de validación

- `fin > inicio`, siempre.
- Duración máxima 24 horas. Un turno más largo es un error de digitación,
  no un turno.
- **Sin solapamiento para el mismo usuario.** Dos turnos de la misma
  persona que se pisan contarían sus horas dos veces, y esas horas son el
  denominador del reparto de comisiones. Rechaza con 409 `TURNO_SOLAPADO`
  nombrando el turno con el que choca. Que esto quede con prueba propia.
- Dos usuarios distintos sí pueden tener turnos simultáneos: eso es
  justamente un equipo trabajando a la vez.

### 1.3 Rutas

Prefijo `/turnos`. **ADMIN** crea, edita y borra turnos de cualquiera.
Un **EMPLEADO o VENDEDOR ve los suyos**, en solo lectura.

- `GET /turnos?desde=&hasta=` — turnos del rango. Para ADMIN, de toda la
  empresa; para los demás roles, **solo los propios, sin que el parámetro
  pueda ampliar eso**. Esto no se resuelve en el frontend.
- `POST /turnos` — ADMIN.
- `PATCH /turnos/:id` — ADMIN.
- `DELETE /turnos/:id` — ADMIN. Aquí sí se borra de verdad: un turno mal
  digitado es un error de captura, no historia del negocio (a diferencia de
  ventas y cuentas, que nunca se borran). Cuando existan comisiones
  liquidadas sobre un turno habrá que revisar esta decisión; déjalo
  comentado.
- `GET /turnos/horas?desde=&hasta=` — horas totales por usuario en el
  rango, que es lo que van a consumir las comisiones. Devuelve una fila por
  usuario con sus horas en decimal.

Las horas se calculan **recortadas al rango consultado**: un turno de 22:00
a 06:00 aporta 2 horas al día que termina y 6 al que empieza, no 8 a uno
solo. Prueba obligatoria.

## Parte 2 — Festivos

### 2.1 Modelo `Festivo`

```prisma
model Festivo {
  id        String   @id @default(cuid())
  empresaId String
  fecha     DateTime // medianoche Bogotá del día festivo
  nombre    String
  generado  Boolean  @default(true) // false = lo agregó el ADMIN a mano
  // @@unique([empresaId, fecha])
}
```

Por empresa, como todo lo demás (R1), aunque los festivos sean nacionales:
son ~18 filas por año, y así cada empresa puede corregir los suyos sin
tocar a las otras.

### 2.2 Generación

Una función pura que, dado un año, devuelva los festivos colombianos. Tres
familias:

1. **Fijos**, que no se mueven: 1 de enero, 1 de mayo, 20 de julio, 7 de
   agosto, 8 de diciembre, 25 de diciembre.
2. **Trasladables (Ley Emiliani)**: si no caen lunes, se corren al lunes
   siguiente — Reyes, San José, San Pedro y San Pablo, Asunción, Día de la
   Raza, Todos los Santos, Independencia de Cartagena.
3. **Derivados de la Pascua**: Jueves Santo y Viernes Santo (no se
   trasladan), y Ascensión, Corpus Christi y Sagrado Corazón (sí se
   trasladan al lunes).

**No tomes mi lista como verdad revelada.** Contrástala con una fuente
oficial antes de implementarla, y escribe pruebas que afirmen las fechas
exactas de **dos años concretos** verificados contra esa fuente, no contra
tu propia implementación. Si encuentras una diferencia con lo que escribí
arriba, dímelo en vez de acomodar el código a mi lista.

Por eso también la tabla es **editable**: si un año sale una discrepancia,
el ADMIN la corrige sin esperar un despliegue.

### 2.3 Rutas

- `GET /festivos?anio=` — cualquier rol autenticado (el calendario los
  pinta para todos).
- `POST /festivos/generar` (ADMIN) — genera los de un año. **Idempotente**:
  no duplica los que ya estén, y **nunca pisa** uno que el ADMIN haya
  editado o creado a mano (`generado: false`).
- `POST /festivos` y `DELETE /festivos/:id` (ADMIN) — agregar y quitar a
  mano.

## Parte 3 — "Está de turno ahora" (punto 8 del cliente)

`Usuario.activo` ya existe y significa "habilitado". Lo que falta es lo
otro: si **está de turno en este momento**.

Eso **no se guarda**: se deriva. Un usuario está de turno si existe un
turno suyo con `inicio <= now() < fin`. Agrega ese booleano derivado a
`GET /usuarios` y muéstralo en el listado, al lado de la pastilla de
activo/inactivo que ya está. Son dos cosas distintas y se tienen que ver
distintas: alguien puede estar habilitado y fuera de turno.

No inventes un campo `enTurno` en la base. Si llega a aparecer uno, es un
dato que se puede desincronizar de la realidad.

## Parte 4 — Frontend

Página nueva `panel/calendario`, entrada en el sidebar en el grupo
OPERACIÓN.

- **Vista semanal**: empleados en las filas, los siete días en las
  columnas, con navegación a la semana anterior y siguiente.
- Los **festivos** se marcan visiblemente en su columna, con el nombre.
- El ADMIN hace clic en una celda para crear un turno, y sobre un turno
  para editarlo o borrarlo. El error de solapamiento se muestra con el
  turno que choca, no como un error genérico.
- Al final de cada fila, **el total de horas de esa persona en la semana**.
- Un EMPLEADO o VENDEDOR abre la misma página y ve **solo su fila**, sin
  botones de edición.

No hace falta vista mensual ni arrastrar turnos. Semana y formulario.

## Parte 5 — Pruebas

- Solapamiento del mismo usuario: 409; dos usuarios a la vez: válido.
- `fin <= inicio`: rechazado. Duración mayor a 24h: rechazada.
- Turno nocturno 22:00–06:00: las horas se reparten entre los dos días
  según el recorte del rango, y el turno pertenece al día Bogotá de su
  inicio.
- Un turno que empieza 23:00 hora Bogotá del último día del mes no se
  cuenta en el mes siguiente (mismo tipo de prueba que ya existe en
  `estadisticas-ventas.test.ts`).
- `GET /turnos` como EMPLEADO devuelve solo los propios **aunque mande
  parámetros pidiendo los de otro**.
- R1: los turnos y festivos de la empresa A nunca salen en la B; crear un
  turno con un `usuarioId` de otra empresa falla.
- `POST /festivos/generar` dos veces no duplica, y no pisa un festivo con
  `generado: false`.
- Festivos de dos años concretos, verificados contra fuente oficial.
- Un usuario con un turno en curso sale con el derivado en true; con el
  turno terminado, en false.

Las pruebas corren desde `apps/api`; `mock.module` en Bun es global al
proceso.

## Lo que NO entra

Comisiones, metas diarias, registro de horas extras por el empleado,
reportes semanales por cargo, estadísticas por empleado, instrucciones con
video. Nada de eso en esta entrega.

## Al terminar

Reporta la lista de archivos tocados **verificada contra `git status`**, no
de memoria, y pruebas antes y después. Si la verificación de los festivos
contra la fuente oficial no coincide con la lista de este documento, dilo
explícitamente.
