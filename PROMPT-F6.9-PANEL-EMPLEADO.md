# F6.9 — Panel individual del empleado

Cierra el bloque de empleados. Cubre el punto 6 del cliente: *"panel
individual para cada empleado que muestre: ventas realizadas, comisiones
generadas, metas cumplidas o incumplidas, tareas y reportes pendientes"*.

Depende de F6.4 (reportes), F6.6 (comisiones) y F6.7/F6.8 (instrucciones).

## Parte 0 — Esta entrega COMPONE, no recalcula

Las cuatro cifras ya existen en el sistema. Esta entrega las junta en una
pantalla; **no vuelve a implementar ninguna**.

Llama a lo que ya está — `calcularComisiones` de `lib/comisiones.ts`, la
consulta de reportes de `routes/reportes.ts`, la de instrucciones de
`routes/instrucciones.ts`. Si alguna no está en una función reutilizable,
**extráela** antes de usarla. Lo que no se vale es una segunda consulta que
calcule lo mismo de otra forma: ya sabemos cómo termina eso en este
proyecto.

## Parte 1 — "Metas cumplidas o incumplidas": aviso de interpretación

El cliente pide metas por empleado, pero su punto 3 las definió como **metas
de equipo**: *"las primeras 10 pantallas vendidas son para Dismanet; desde
la venta 11 se generan comisiones compartidas"*. No existe ninguna meta
individual en el sistema, y no la inventes.

Interpretación para esta entrega: **para cada día en que el empleado tuvo
turno, si el equipo superó el umbral ese día** (o sea, si ese día generó
pozo) la meta se muestra cumplida; si no lo superó, incumplida. Los días sin
turno no cuentan ni a favor ni en contra.

Eso sale directo de lo que ya calcula F6.6: un día con pozo mayor a cero es
un día en que se superó el umbral.

Si el cliente quería metas individuales, es otra entrega y hay que
diseñarla con él. Déjalo escrito como comentario.

## Parte 2 — Qué muestra

Para un usuario y un rango (por defecto el mes en curso):

1. **Ventas realizadas** — cuántas ventas y cuántas pantallas vendió él
   (`Venta.vendedorId`), y el total vendido.
2. **Comisiones generadas** — de `calcularComisiones`: el total **cerrado** y
   el **provisional de hoy**, separados y rotulados como en F6.6.
3. **Metas** — por día con turno: cumplida o incumplida, según la Parte 1,
   con el conteo de cada una en el rango.
4. **Pendientes** — dos cosas:
   - si debe el **reporte semanal** de la semana en curso (F6.4),
   - qué **instrucciones** publicadas que le aplican no ha completado
     (F6.7/F6.8), con su avance de video si lo tiene.

### R4: qué NO puede mostrar

Ni `costo`, ni `utilidad`, ni margen, ni el **pozo total** del día, ni cuánto
le tocó a otro. Un empleado que vea su tajada y el pozo puede despejar las
horas de los demás; si además ve el modo porcentaje, puede despejar cifras
de venta que no le corresponden. Solo lo suyo.

## Parte 3 — Rutas

- `GET /panel-empleado?desde=&hasta=` — **EMPLEADO en adelante**, siempre el
  propio.
- `GET /panel-empleado/:usuarioId?desde=&hasta=` — **solo ADMIN**, el de
  cualquier empleado de su empresa. Es como el dueño revisa a su gente sin
  entrar cuenta por cuenta.

Un `VENDEDOR` recibe 403 en las dos: es revendedor externo, no tiene panel
de empleado.

### Rendimiento

El panel junta cuatro fuentes. **Que no se vuelva un N+1**: nada de una
consulta por día ni por instrucción. Si hace falta, agrupa en memoria como
se hizo en F4.12. Reporta cuántas consultas hace el endpoint.

## Parte 4 — Frontend

Página `panel/mi-panel` (o el nombre que encaje con el resto), sidebar en
OPERACIÓN, `rolMinimo: "EMPLEADO"`.

- **Empleado**: su panel, con las cuatro secciones. Lo primero que tiene que
  ver al abrirlo es **cuánto lleva de comisión** y **qué le falta por hacer**
  — eso es lo que le importa; las ventas y las metas son contexto.
- **ADMIN**: un selector de empleado arriba para ver el panel de cualquiera,
  reutilizando el mismo componente.
- Las instrucciones pendientes enlazan a la página de instrucciones; el
  reporte pendiente enlaza al formulario de reportes. Un pendiente que no se
  puede resolver con un clic es un pendiente que nadie resuelve.

## Parte 5 — Pruebas

- Las cuatro secciones traen lo que corresponde a ese usuario y a ese rango,
  y nada de otro usuario.
- Un día con turno y con pozo cuenta como meta cumplida; con turno y sin
  pozo, incumplida; **sin turno, no cuenta en ninguna**.
- El JSON crudo del empleado **no contiene** `costo`, `utilidad`, `margen`
  ni el pozo total (misma forma de prueba que ya existe para `/ventas/mias`).
- `GET /panel-empleado` ignora cualquier intento de pedir el de otro por
  query.
- `GET /panel-empleado/:usuarioId` como EMPLEADO: 403.
- Un VENDEDOR: 403 en las dos.
- Un empleado sin ventas, sin turnos y sin pendientes recibe un panel vacío
  válido, no un error ni divisiones por cero.
- R1: un ADMIN de la empresa A no puede pedir el panel de un usuario de B
  (404).

## Lo que NO entra

Metas individuales por empleado, rankings entre empleados, exportaciones, y
cualquier recálculo propio de comisiones o disponibilidad.

## Al terminar

Reporta la lista de archivos tocados **verificada contra `git status`**,
pruebas antes y después **con el número real de la corrida, no estimado**, y
cuántas consultas hace `GET /panel-empleado`.
