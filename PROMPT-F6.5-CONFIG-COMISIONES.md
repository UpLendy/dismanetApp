# F6.5 — Configuración de comisiones y simulador

Quinta entrega del bloque de empleados. Cubre la política de comisiones
(puntos 2 y 3 del cliente) **sin calcular ni liquidar nada todavía**: eso es
F6.6.

El objetivo real de esta entrega es que el dueño pueda **decidir viendo**.
Hoy no sabe qué número poner de umbral, y nosotros tampoco deberíamos
decidirlo por él: con el simulador mueve el número y ve al instante qué
habría pasado con sus ventas reales.

## Parte 1 — Modelo

```prisma
enum ModoComision      { PORCENTAJE_VENTA  FIJO_POR_PANTALLA }
enum AmbitoUmbral      { TOTAL             POR_PLATAFORMA }
enum PeriodoUmbral     { DIA               MES }

model ConfiguracionComision {
  id             String   @id @default(cuid())
  empresaId      String
  modo           ModoComision
  valor          Decimal          // el % (0-100) o el monto fijo por pantalla
  umbralCantidad Int              // pantallas que NO comisionan en cada periodo
  umbralAmbito   AmbitoUmbral
  umbralPeriodo  PeriodoUmbral
  vigenteDesde   DateTime
  creadaPorId    String
  createdAt      DateTime @default(now())
}
```

**Es un registro por versión, no una fila que se edita.** Guardar una
política nueva **crea otra fila**; la configuración vigente es la de
`vigenteDesde` más reciente que ya empezó.

El motivo es que esto va a pagar gente: si alguien cambia el porcentaje a
mitad de mes y después se liquida, hay que poder saber qué regla estaba
vigente cuando se vendió. Una fila mutable borra esa respuesta para siempre.

**No existe la comisión por porcentaje de utilidad.** El cliente la descartó
cuando le expliqué que un empleado que ve su comisión y conoce la tasa puede
despejar la utilidad, y toda la R4 del sistema existe para que eso no pase.
No la agregues aunque parezca que falta.

Los tres enums son nuevos completos, así que van en la misma migración que la
tabla (la regla de separar archivos aplica a agregar valores a un enum que ya
existe, no a crear uno).

### Validación al guardar

- `PORCENTAJE_VENTA`: `valor` entre 0 y 100, exclusivo de 0.
- `FIJO_POR_PANTALLA`: `valor` mayor a 0.
- `umbralCantidad` mayor o igual a 0 (0 significa que todo comisiona).

## Parte 2 — Cómo se cuenta (esto es el corazón)

**La unidad es la pantalla vendida**, o sea una fila de `VentaDetalle` —
igual que lo dijo el cliente: *"las primeras 10 pantallas vendidas son para
Dismanet"*.

**Quedan fuera del conteo**, nunca cuentan ni para el umbral ni para el pozo:

- renglones de ventas anuladas,
- renglones de ventas `esExterna` (las garantías no son ventas).

**El umbral absorbe las primeras `umbralCantidad` pantallas de cada
contador**, y de ahí en adelante comisionan. Los contadores dependen de la
configuración:

| `umbralAmbito` | `umbralPeriodo` | hay un contador por... |
|---|---|---|
| TOTAL | DIA | cada día |
| TOTAL | MES | cada mes |
| POR_PLATAFORMA | DIA | cada plataforma y cada día |
| POR_PLATAFORMA | MES | cada plataforma y cada mes |

Los días y meses son **de Bogotá**, con los helpers de `lib/periodos.ts` que
ya existen y ya están probados. No escribas aritmética de fechas nueva.

### El orden importa, y no es un detalle

Dentro de cada contador, las pantallas se ordenan por `Venta.fechaVenta`
ascendente y, a igualdad, por `VentaDetalle.id`.

No es cosmético: con `PORCENTAJE_VENTA`, **cuáles** pantallas absorbe el
umbral cambia el tamaño del pozo, porque no todas valen lo mismo. Sin un
orden determinista, dos corridas sobre los mismos datos dan plata distinta.
Déjalo comentado así.

### Cuánto aporta cada pantalla que comisiona

- `FIJO_POR_PANTALLA`: `valor`, una vez por pantalla.
- `PORCENTAJE_VENTA`: `valor%` del **precio prorrateado** de esa pantalla, o
  sea `Venta.precioVenta / número de renglones de esa venta`.

**Usa `Venta.precioVenta` prorrateado, no `VentaDetalle.precioSugerido`**,
por dos razones: `precioSugerido` es nulo en las ventas de paquete (no se
puede atribuir el precio de un combo a cada plataforma, ver la nota de
"costo atribuible" en estadísticas), y además ignora los descuentos
manuales, así que la suma no daría lo que el cliente realmente pagó. Con el
prorrateo no hay nulos y la suma de los renglones es exactamente el ingreso
de la venta.

## Parte 3 — Rutas

Prefijo `/comisiones`, **solo ADMIN**.

- `GET /comisiones/configuracion` — la vigente, o `null` si nunca se
  configuró.
- `PUT /comisiones/configuracion` — guarda una versión nueva (fila nueva,
  `vigenteDesde` = ahora, `creadaPorId` = quien la guardó). Nunca
  `UPDATE` sobre la anterior.
- `GET /comisiones/configuracion/historial` — las versiones anteriores con
  quién y cuándo.
- `GET /comisiones/simulacion?desde=&hasta=&modo=&valor=&umbralCantidad=&umbralAmbito=&umbralPeriodo=`
  — **simula con los parámetros que lleguen por query, NO con la
  configuración guardada**. Es lo que permite mover el número y ver el
  efecto antes de guardar nada. Solo lectura, no escribe.

  Devuelve, para el rango pedido:

  - `pantallasVendidas`
  - `pantallasAbsorbidas` (las que se comió el umbral)
  - `pantallasComisionadas`
  - `porcentajeComisionado`
  - `pozoTotal`
  - `porPeriodo`: una fila por día o por mes (según `umbralPeriodo`) con esas
    mismas cifras, para que se vea la variación y no solo el promedio.

### Rendimiento

La simulación de un mes recorre ~10.000 renglones. Trae un `select` mínimo
—`id`, `plataformaId`, `fechaVenta` de la venta y `precioVenta` con el
conteo de renglones— y agrupa en memoria. **Sin `include` anidados y sin una
consulta por plataforma**: acabamos de arreglar ese patrón en F4.12, no lo
reintroduzcas.

## Parte 4 — Frontend

Página `panel/comisiones`, sidebar en CONFIGURACIÓN, `rolMinimo: "ADMIN"`.

Arriba los controles: modo, valor, cantidad del umbral, ámbito (total o por
plataforma) y período (día o mes).

Debajo, **el simulador, que es el punto de la pantalla**. Por defecto sobre
los últimos 30 días, recalculando al cambiar cualquier control, con el
titular en grande:

> **10.050 de 10.350 pantallas comisionan (97%)** · pozo del período: **$X**

y abajo la tabla por período.

Tiene que quedar clarísimo que **lo que se ve es una simulación y no está
guardado** hasta que se pulse guardar. Y que guardar **no liquida nada
todavía** — eso llega en la entrega siguiente.

Muestra también la versión vigente actual y desde cuándo.

## Parte 5 — Pruebas

- Umbral exacto: con `umbralCantidad` = 10 y exactamente 10 pantallas en el
  período, comisionan 0; con 11, comisiona 1.
- `TOTAL` contra `POR_PLATAFORMA` sobre los mismos datos dan resultados
  distintos y ambos correctos (fixture calculado a mano).
- `DIA` contra `MES`, igual.
- Frontera Bogotá: una venta a las 23:00 del último día del mes cuenta en ese
  mes y no en el siguiente.
- Ventas anuladas y `esExterna` no cuentan ni para el umbral ni para el pozo.
- Orden determinista: la misma simulación corrida dos veces da exactamente el
  mismo `pozoTotal`, con precios distintos entre renglones y `fechaVenta`
  empatada.
- `PORCENTAJE_VENTA`: una venta de paquete de 3 renglones con precio 30.000
  aporta 10.000 por renglón, y un descuento manual se refleja (no se usa
  `precioSugerido`).
- `FIJO_POR_PANTALLA`: pozo = pantallas que comisionan × valor.
- Guardar dos veces crea **dos filas**; la vigente es la última y la anterior
  sigue consultable en el historial.
- Validación: porcentaje fuera de 0–100, valor 0 o negativo, umbral negativo.
- Un EMPLEADO recibe 403 en todas las rutas de `/comisiones`.
- R1: la simulación de la empresa A nunca cuenta ventas de la B.

## Lo que NO entra

El cálculo real por empleado, el reparto por horas de turno, el día cerrado
contra el turno provisional, la vista del empleado, y cualquier escritura de
comisiones liquidadas. Todo eso es F6.6.

Tampoco las horas adicionales: **no entran en el denominador del pozo**,
como quedó escrito en F6.3.

## Al terminar

Reporta la lista de archivos tocados **verificada contra `git status`**,
pruebas antes y después, y cuántas consultas hace la simulación de un mes.
