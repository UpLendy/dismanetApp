# F4.4 — Venta de varios productos con precio final editable

**Alcance:** una venta por unidad puede llevar **varios servicios**, entregarse en **un solo mensaje**, y su precio final lo puede ajustar a mano un EMPLEADO o un ADMIN.

**Fuera de alcance, no lo construyas:** las estadísticas segmentadas (F4.5), el conteo de pantallas por vencer, los paquetes (siguen exactamente como están).

---

## Por qué esta entrega existe

Hoy, si un comprador quiere Netflix y Disney+ sueltos, el vendedor tiene que hacer **dos ventas** y mandar **dos mensajes**. Y cuando el cliente compra varios servicios fuera de paquete, le hace un descuento a ojo que el sistema no puede registrar: no hay dónde ponerlo.

El cuerpo de `POST /ventas` recibe hoy **un** `plataformaId`, y `Venta` guarda **un** `nombreItem`, **un** `nombreDuracion` y **un** `precioVenta`. Esto no es un botón: es un cambio en la forma de la venta.

---

## Las seis decisiones ya tomadas

No las rediseñes. Si alguna te parece equivocada, dilo en el registro de entrega antes de cambiarla.

**1. El núcleo se reutiliza.** `realizarVentaConComposicion()` ya recibe una `composicion: ComponentePaquete[]` y totales de `precioVenta`/`costo`, y ya bloquea pantallas en orden, hace todo-o-nada, reintenta el código de compra y escribe un `VentaDetalle` por componente. Eso **no se toca**. Lo único que cambia es quién construye la `composicion` para una venta por unidad y de dónde sale el precio. Si terminas reescribiendo esa función, te desviaste.

**2. Un solo precio editable para toda la venta, no por renglón.** El cliente dijo: *"solo que se pueda cambiar el precio final"*, sin porcentajes. Un campo, el total.

**3. El descuento NO se reparte entre renglones.** Repartir proporcionalmente sería inventar un dato que nadie decidió, y la utilidad por plataforma saldría de una cuenta que el cliente no hizo. En vez de eso:

- `Venta.precioSugerido` = suma de los precios de catálogo de cada renglón.
- `Venta.precioVenta` = lo que de verdad se cobró.
- El descuento es la diferencia, **derivada, no almacenada**.
- `Venta.utilidad` = `precioVenta - costo`, así que el descuento **sí** reduce la utilidad real. Eso es lo correcto.
- Por renglón se guardan `precioSugerido` y `costo`, nunca una utilidad repartida.

F4.5 va a reportar ingreso a precio de lista y costo por plataforma, y el descuento como una cifra a nivel de venta. Eso es honesto; un reparto no lo sería.

**4. Dos o más renglones usan la plantilla de PAQUETE.** La plantilla de `UNIDAD` tiene un solo bloque de `{{plataforma}}`/`{{perfil}}`/`{{correo}}`: no cabe un segundo servicio. `{{listaCuentas}}` ya renderiza N bloques, con la duración real de cada componente y las banderas de campos de acceso de F4.2, y ya está probado. Entonces:

- Venta de **un** renglón → plantilla `UNIDAD`, igual que hoy, **byte por byte igual que hoy**.
- Venta de **dos o más** renglones → plantilla `PAQUETE`, con `{{paquete}}` recibiendo el `nombreItem` de la venta.

**No agregues un valor nuevo al enum `TipoPlantilla`.** Haría falta configurar y sembrar una tercera plantilla, escribir un tercer respaldo, y entraríamos en la trampa de "Postgres no permite usar un valor de enum nuevo en la misma transacción que lo agrega" — dos migraciones separadas por algo que `{{listaCuentas}}` ya resuelve. Como no se toca ningún enum, esta entrega lleva **una sola migración**.

**5. Una sola duración y un solo tipo de cliente para toda la venta.** Es el flujo que el cliente describió: elige los servicios, y los días y el tipo de usuario una vez. `VentaDetalle.duracionId` sigue existiendo por renglón —lo usa la matriz de excepciones de los paquetes— pero en una venta por unidad todos los renglones comparten la duración vendida.

**6. `Venta.plataformaId` queda en `null` cuando hay dos o más renglones**, y eso **rompe el filtro por plataforma** si no se arregla en la misma entrega.

Esto es exactamente la misma clase de error que usar `Venta.fechaVencimientoMax` para calcular disponibilidad (R5): un campo desnormalizado que era cómodo mientras una venta tenía una sola plataforma, y que se vuelve mentira en cuanto tiene dos. `whereDesdeFiltros()` en `routes/ventas.ts` filtra hoy con `plataformaId` sobre `Venta`; tiene que pasar a `detalles: { some: { plataformaId } }`. Si no, cada venta multi-producto desaparece al filtrar por plataforma, y las estadísticas de F4.5 nacen con un hueco silencioso.

---

## Parte 1 — Esquema y migración

En `Venta`:

```prisma
/// Suma de los precios de catálogo de los renglones, antes del ajuste
/// manual (F4.4). El descuento otorgado es precioSugerido - precioVenta.
precioSugerido Decimal @db.Decimal(14, 2)
```

**Backfill: `precioSugerido = precioVenta` para todas las ventas existentes.** Eso no es inventar un dato: antes de F4.4 no existía forma de descontar, así que el precio sugerido de toda venta histórica *era* el cobrado. Por eso la columna puede quedar `NOT NULL`. Hazlo en la misma migración, con un `UPDATE` plano.

En `VentaDetalle`:

```prisma
/// Copias inmutables por renglón (R3, F4.4). Nulas en las ventas
/// anteriores a F4.4: el precio de un paquete no se puede atribuir por
/// plataforma sin inventarlo. Null significa "sin desglose", y F4.5
/// tiene que tratarlo así, no como cero.
precioSugerido Decimal? @db.Decimal(14, 2)
costo          Decimal? @db.Decimal(14, 2)
```

**Estas dos NO se rellenan hacia atrás.** Derivar el costo histórico por renglón significaría correr la tabla de costos de hoy contra ventas de antes, que es precisamente el error que F4.1 vino a corregir. Se quedan nulas y se llenan de aquí en adelante.

Una prueba tiene que afirmar que **toda venta nueva** —unidad de un renglón, unidad de varios, y paquete— escribe `precioSugerido` y `costo` en cada `VentaDetalle`. La regla no es "el dato quedó bien", es "una venta hecha mañana nace completa".

Verifica que la migración generada no traiga ningún `DROP COLUMN`. No se agrega ningún valor de enum.

---

## Parte 2 — El cuerpo de la venta

`cuerpoVenta` en `routes/ventas.ts` cambia de forma:

```ts
{
  tipoVenta: "UNIDAD" | "PAQUETE",
  plataformas?: string[],   // UNIDAD: 1..N. Reemplaza a plataformaId
  paqueteId?: string,       // PAQUETE: sin cambio
  duracionId: string,
  tipoClienteId: string,
  precioFinal?: string,     // ajuste manual, ver Parte 3
  celularCliente?: string,
}
```

`plataformaId` singular **se elimina**, no se deja como alternativa. Dos formas de decir lo mismo es una de ellas sin probar. El cliente de Eden Treaty está tipado de punta a punta, así que el front se rompe en `tsc` donde falte cambiarlo — eso es la señal, no un problema.

**Repetir una plataforma está permitido:** `["netflix", "netflix"]` son dos pantallas de Netflix en la misma venta. Agrupa por `plataformaId` y pide la cantidad sumada en una sola llamada a `tomarPantallasDisponibles`; no la llames dos veces para la misma plataforma.

**El orden de bloqueo importa ahora donde antes no.** Hasta hoy una venta por unidad tomaba una sola plataforma y la regla 1 de R2 era trivial. Ya no: la `composicion` de una venta por unidad tiene que venir **ordenada por `plataformaId` ascendente**, igual que la de un paquete. Sin ese orden, dos ventas simultáneas que comparten plataformas se bloquean mutuamente. Y el orden global sigue siendo el mismo: **primero la fila del usuario, después las pantallas.**

**Precio sugerido:** por cada renglón, el `Precio` activo de `(plataformaId, duracionId, tipoClienteId)`. Si a algún renglón le falta precio activo, la venta se rechaza con un mensaje que **nombra la plataforma** — no se cobra cero por un dato faltante. (El **costo** faltante sí se asume cero y la venta sigue, igual que hoy: esa asimetría es deliberada y está en `lib/ventas.ts`.)

`nombreItem` de una venta de varios renglones: los nombres de las plataformas unidos con `" + "`, en el mismo orden que se muestran. Es una copia inmutable (R3).

---

## Parte 3 — El precio final editable

**Quién:** EMPLEADO, ADMIN y SUPER_ADMIN. **Nunca VENDEDOR.**

**Validación en el servidor, no en el formulario** (R4 — esconder el campo no es control de acceso):

- `precioFinal` presente y el rol es VENDEDOR → `403 DESCUENTO_NO_PERMITIDO`.
- `precioFinal` presente y la venta tiene **un solo** renglón → `409 DESCUENTO_SOLO_MULTIPRODUCTO`. Es lo que el cliente pidió. Abrirlo a ventas de un solo producto después es borrar esta validación, nada más.
- `precioFinal` ausente → `precioVenta = precioSugerido`. Sin descuento.
- `precioFinal` menor o igual a cero → rechazado.
- `precioFinal` **mayor** que `precioSugerido` → se acepta y queda registrado. El cliente ajusta "a gusto personal" y un recargo es tan legítimo como un descuento; el descuento derivado simplemente sale negativo. No lo bloquees ni lo trates como un error.

**Saldo:** un revendedor consume **el precio final**, no el sugerido. Como un VENDEDOR no puede descontar, para él los dos coinciden siempre; pero un EMPLEADO con saldo sí puede, y el movimiento tiene que cobrar lo que de verdad se cobró. La verificación de saldo suficiente se hace contra el precio final, dentro del bloqueo de la fila del usuario que ya existe.

---

## Parte 4 — Lo que no se puede romper

- **La venta de un solo producto tiene que seguir dando el mismo mensaje que hoy.** Una prueba de regresión que compare el texto renderizado contra el de antes de esta entrega. Si cambia una sola línea, algo se desvió.
- **Los paquetes no cambian.** Ni su precio, ni su composición, ni su mensaje, ni la matriz de excepciones de duración.
- **El filtro por plataforma** pasa por `detalles: { some: { plataformaId } }` (decisión 6). Prueba: una venta de Netflix + Disney+ aparece al filtrar por Netflix **y** al filtrar por Disney+.
- **`esExterna`** de F4.3 sigue excluido de listados y totales. No lo pierdas al tocar `whereDesdeFiltros()`.
- **Anular** libera **todos** los renglones y devuelve el saldo consumido —el precio final, que es lo que se cobró— apoyándose en el `MovimientoSaldo` de tipo `CONSUMO` que ya existe, nunca recalculando el precio.
- **R4:** ningún endpoint devuelve `costo`, `utilidad`, `precioSugerido` por renglón ni el descuento a un VENDEDOR. La exclusión va en el `select` de Prisma, no filtrando el objeto después.

---

## Parte 5 — Front

En **Vender**, modo Unidad:

- La plataforma elegida pasa a ser una **lista de renglones**. Debajo, un botón **"Agregar otro servicio"**. Cada renglón se puede quitar; con un solo renglón no se muestra el botón de quitar.
- Duración, tipo de cliente y celular quedan **una sola vez**, al nivel que ya tienen.
- Debajo de la lista, el **total sugerido**. Si el rol puede descontar y hay dos o más renglones, aparece un campo de **precio final** precargado con el sugerido y editable, con el descuento calculado al lado en texto (*"Descuento: $2.000"*). Si el rol no puede descontar, el campo no existe —no deshabilitado, ausente— y solo se ve el total.
- El mensaje resultante se muestra con el botón de copiar, como hoy.

Un detalle que ya mordió: en la pantalla de vender, `cargarOpciones()` llamaba a `setError(null)` y se comía el error de la venta en el mismo tick. Al agregar y quitar renglones vas a disparar recargas de opciones; **no limpies el error en esas recargas**, solo cuando el usuario cambia un selector.

Si el diálogo usa el componente `Dialogo`, recuerda que su `descripcion` va dentro de un `asChild` sobre un `div`: los campos de formulario van en el slot de `children`.

---

## Pruebas

- **`app-compuesta.test.ts`** — el cuerpo de `POST /ventas` cambió de forma: el caso **sin sesión** y el de cada rol se revisan ahí, montando la app como `index.ts`.
- **Regresión del mensaje de un solo producto**, comparando el texto exacto.
- **Venta de dos plataformas**: un `Venta`, dos `VentaDetalle`, un mensaje con los dos bloques, cada uno con sus campos de acceso según las banderas de F4.2.
- **Plataforma repetida**: `["netflix","netflix"]` toma dos pantallas distintas de Netflix y el mensaje trae dos bloques.
- **Inventario insuficiente en el segundo renglón** → todo o nada: no queda ninguna pantalla ocupada ni ninguna fila escrita. Verifica contando filas, no solo el código de respuesta.
- **Concurrencia con dos plataformas compartidas**: dos ventas simultáneas de `[A, B]` y `[B, A]` no se bloquean mutuamente — es la prueba de que la `composicion` sale ordenada. Y nunca se entrega la misma pantalla dos veces (R2).
- **Descuento**: VENDEDOR → 403; un solo renglón → 409; ausente → `precioVenta == precioSugerido`; mayor que el sugerido → aceptado con descuento negativo.
- **Saldo**: un revendedor con saldo justo para el precio final vende; con saldo entre el final y el sugerido **también** vende (se cobra el final). Y el error de saldo insuficiente llega a la pantalla — no se pierde en silencio, que ya pasó una vez.
- **Toda venta nueva llena `precioSugerido` y `costo` en cada `VentaDetalle`** (Parte 1).
- **Filtro por plataforma** alcanza la venta multi-producto por cualquiera de sus plataformas.
- **R1**: nada de esto cruza empresas.

## Terminado cuando

1. `npx tsc --noEmit` limpio en las dos apps. **Córrelo y pega la salida real.**
2. `bun test` pasa, ejecutado **desde `apps/api`** (Bun lee el `.env` del directorio actual y vive ahí; desde la raíz fallan todas por `DATABASE_URL` vacío).
3. Desde la interfaz: vender Netflix + Disney+ en una sola venta, con un precio final ajustado, y recibir **un** mensaje con los dos servicios.
4. Entrando como VENDEDOR, el campo de precio final no aparece, y una petición hecha a mano con `precioFinal` recibe 403.
5. Una venta de un solo producto sigue viéndose y leyéndose exactamente igual que antes.
6. No quedan `TODO`, datos quemados ni credenciales en el código.

## Al entregar

Un registro corto: archivos tocados, salida real de `tsc` y `bun test`, qué decidiste distinto de este prompt y por qué, qué quedó sin hacer. Si alguna de las seis decisiones de arriba resultó equivocada, dilo — corregir el plan es más barato que corregir el código.
