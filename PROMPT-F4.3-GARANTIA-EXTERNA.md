# F4.3 — Garantía de una venta hecha fuera del sistema

**Alcance:** poder registrar una garantía cuya venta original **no existe en el sistema**, porque se hizo por fuera. Entrega una pantalla del inventario, la deja ocupada, y registra la pérdida.

**Fuera de alcance, no lo construyas:** registrar las ventas viejas, la venta multi-producto, las estadísticas, el conteo de pantallas por vencer.

---

## Por qué esta entrega existe

El sistema entró a operar a mitad de quincena. Las ventas de la primera mitad se hicieron por fuera, y a esos compradores también se les cae la cuenta. Hoy el cliente no puede registrar esos reemplazos: `Garantia.ventaDetalleOriginalId` es obligatorio y único, y cuelga de un renglón de venta que no existe.

Lo que está pasando mientras esto no exista es peor que no poder registrarlo: **él ya está entregando esas pantallas de todos modos**, por WhatsApp, a mano. El sistema sigue creyéndolas libres y las va a vender otra vez. Cada día que pasa hay más inventario fantasma y más pérdida sin registrar.

---

## La decisión de diseño, y por qué no la otra

Para que una pantalla quede ocupada hace falta un `VentaDetalle` — es la única fuente de verdad de disponibilidad (R5). Y `VentaDetalle.ventaId` es obligatorio. Entonces hay dos caminos y **no** son equivalentes:

**El que vamos a tomar:** la garantía externa crea por debajo una `Venta` mínima marcada `esExterna`, con `precioVenta`, `costo` y `utilidad` en **cero**.

**El que NO vamos a tomar:** volver `VentaDetalle.ventaId` opcional. Eso obliga a cambiar el `where` de `estadoDePantallas()`, que es la única consulta del proyecto que implementa R5. Hoy filtra `venta: { anulada: false }`, y contra una relación nula ese filtro **excluye la fila** — la pantalla se vería libre y se revendería. Es arreglable, pero el precio de equivocarse ahí es sobreventa, y R5 no se toca por una funcionalidad de borde.

La razón por la que el camino elegido es seguro: con precio, costo y utilidad en cero, si alguien olvida excluir estas ventas de un agregado, el error cuesta **un conteo**, no pesos. Un "ventas de hoy: 5" cuando fueron 4 es visible y se arregla. Plata mal sumada no se nota y es justo el problema que F4.1 vino a corregir.

La pérdida no va en la venta: va donde ya va, en `Garantia.costoAsumido`. `totalesDesde()` en `routes/ventas.ts:195` ya suma `garantia.costoAsumido` y lo resta de la utilidad, así que la contabilidad de la garantía externa **sale bien sin tocar esa función**. Verifícalo, no lo asumas.

---

## Parte 1 — Esquema y migración

En `Venta`:

```prisma
/// Venta creada únicamente para sostener una garantía de una venta hecha
/// fuera del sistema (F4.3). precioVenta/costo/utilidad son cero: no es
/// un ingreso. Se excluye de listados y totales.
esExterna     Boolean @default(false)
tipoClienteId String?   // pasa a opcional: una venta externa no tiene tipo de cliente
```

En `Garantia`:

```prisma
ventaDetalleOriginalId String? @unique   // pasa a opcional

/// Datos de la venta original cuando ocurrió fuera del sistema (F4.3).
/// Nulos en una garantía normal, donde esa información vive en el
/// VentaDetalle original.
esExterna          Boolean  @default(false)
plataformaExternaId String?
celularExterno     String?
```

Sobre el `@unique` de `ventaDetalleOriginalId`: en Postgres un índice único **permite varios NULL**. Eso es exactamente lo que queremos — muchas garantías externas conviven sin chocar entre sí, y la protección contra dos garantías sobre el mismo renglón real sigue intacta. No lo "arregles" con un índice parcial ni con un valor centinela.

`tipoClienteId` pasa a opcional para no inventar un tipo de cliente que el cliente no eligió; si le asignáramos el primero activo, contaminaría las estadísticas por tipo de cliente de F4.5. `nombreTipoCliente` —que es una copia de texto, no una FK— se escribe como `"Venta externa"`.

**Una sola migración.** Todo es `ADD COLUMN` o `DROP NOT NULL`: no hay pérdida de datos ni backfill. Verifica que la migración generada no traiga ningún `DROP COLUMN` ni `SET NOT NULL`; si Prisma genera algo así, para y revisa el schema antes de aplicar.

No se agrega ningún valor de enum, así que no aplica la trampa de las migraciones separadas.

---

## Parte 2 — La operación

`POST /garantias/externa`, en el router `garantias.ts` que ya existe, con la misma guarda `requiereRol(Rol.EMPLEADO)` que la garantía normal: quien atiende la llamada del comprador es el mismo, venga la venta de donde venga.

Cuerpo:

```ts
{
  plataformaId: string;      // qué plataforma hay que reemplazar
  duracionId: string;        // la duración que se está cubriendo — define el costo
  fechaVencimiento: string;  // hasta cuándo le queda al comprador (fecha real, no días)
  celularCliente?: string;   // opcional, para encontrarla después
  motivo?: string;           // opcional, igual que en la garantía normal
}
```

`fechaVencimiento` es una fecha, no un número de días. El cliente sabe hasta cuándo pagó el comprador; hacerle calcular días es pedirle que haga una resta que el sistema puede hacer mal. Rechaza una fecha en el pasado: una garantía que vence ayer no ocupa nada y no tiene sentido registrarla.

Todo dentro de **una** transacción, reutilizando el camino que ya existe — no escribas un mecanismo nuevo:

1. `tomarPantallasDisponibles(tx, empresaId, plataformaId, 1)`. Si devuelve vacío → `SIN_PANTALLAS_DISPONIBLES`, mismo código que la garantía normal.
2. Crear la `Venta` mínima: `esExterna: true`, `vendedorId` = quien la registra, `codigoCompra` generado con el mismo generador de siempre, `tipoVenta: "UNIDAD"`, `plataformaId`, `duracionId`, `tipoClienteId: null`, `nombreItem` = nombre de la plataforma, `nombreDuracion` / `cantidadDuracion` / `unidadDuracion` copiados de la duración, `nombreTipoCliente: "Venta externa"`, `precioVenta`/`costo`/`utilidad` en `0`, `celularCliente`, `fechaVencimientoMax` = la fecha recibida.
3. Crear el `VentaDetalle` de reemplazo colgado de esa venta, con las copias inmutables de R3 exactamente como las hace `realizarGarantia()` — incluidos los cuatro campos de acceso de F4.2 (`correoCuenta`, `usuarioCuenta`, `codigoCuenta`, `enlaceCuenta`), cifrados tal cual están en la cuenta. `fechaVencimiento` = la fecha recibida.
4. `costoAsumido` = `CostoPlataforma` de `(plataformaId, duracionId)`, o cero si falta — **el mismo criterio que la garantía normal**: una garantía no se bloquea por un dato de configuración faltante.
5. Crear la `Garantia` con `ventaDetalleOriginalId: null`, `esExterna: true`, `plataformaExternaId`, `celularExterno`, `ventaDetalleReemplazoId` apuntando al renglón nuevo.

**Lo que NO pasa:** no se desactiva ninguna pantalla. En una garantía normal, `Pantalla.activa = false` saca del inventario la pantalla que falló. Aquí la pantalla que falló **nunca estuvo en el inventario** — era de una cuenta que el cliente manejaba por fuera. Si desactivas algo, estarás desactivando una pantalla que no tiene nada que ver. Esta es la diferencia más fácil de pasar por alto al copiar `realizarGarantia()`.

---

## Parte 3 — Que no contamine lo que ya funciona

Esto es la mitad del trabajo, no un detalle de limpieza.

- **`GET /ventas`** (y la variante del vendedor): excluir `esExterna: true`. El cliente no vendió eso y no tiene por qué verlo entre sus ventas.
- **`totalesDesde()` en `routes/ventas.ts:195`**: agregar `esExterna: false` al `where` del `venta.aggregate`. Los montos ya salen bien porque son cero; lo que se corrige es `numeroVentas`.
- **Anular**: una venta externa no se puede anular desde `/ventas/:id/anular`. Si se pudiera, liberaría la pantalla del comprador sin que nadie se enterara. Rechaza con un error propio.
- **`GET /ventas/codigos`**: excluir también. Esos códigos no corresponden a ninguna compra real.
- **"Pantallas vendidas"**: aquí **sí** aparece, marcada como externa. Es el punto del sistema donde el vendedor busca una pantalla para atender una llamada, y si la garantía externa se vuelve a caer tiene que poder reemplazarla — y esa segunda vez es una garantía normal, porque ya tiene su `VentaDetalle`. Funciona gratis; compruébalo con una prueba.
- **`GET /garantias`**: aparece en el listado, distinguible. Donde hoy muestra el código de compra del original, una garantía externa muestra el celular y la plataforma.

**Una prueba que vigile la exclusión**, no solo que la ruta ande: crea una venta normal y una externa en la misma ventana de tiempo y verifica que `numeroVentas` es 1, que el listado trae una sola fila, y que `perdidaGarantias` **sí** incluye el `costoAsumido` de la externa. Sin esa prueba, la cuarta persona que agregue un agregado de dinero va a volver a sumar la venta fantasma.

---

## Parte 4 — El mensaje

Se genera igual que en la garantía normal, con `renderizarMensajeDeVenta()` y la plantilla de `UNIDAD` de la empresa (o `PLANTILLA_RESPALDO_UNIDAD` si no tiene). Mismo aviso de reemplazo antepuesto fuera de la plantilla que ya usa `renderizarMensajeGarantia()`.

Dos datos que no existen y hay que resolver sin inventar:

- **`nombreTipoCliente`**: `"Venta externa"`. Si la plantilla de la empresa usa `{{tipoCliente}}`, eso es lo que va a salir. Es correcto: es verdad.
- **`precioVenta`**: cero. Si la plantilla usa `{{precio}}`, el comprador vería `$0`. **Eso no puede salir.** Quita el bloque de `{{precio}}` en el mensaje de una garantía externa, con el mismo mecanismo de bloques que F4.2 dejó en `quitarBloquesDeCamposNoUsados()` — no con un reemplazo por cadena vacía, que deja la etiqueta huérfana. Ese bug ya se entregó a compradores una vez.

El mensaje respeta las banderas de campos de acceso de F4.2 igual que cualquier otro.

---

## Parte 5 — Front

En **Pantallas vendidas**, junto al botón de Reemplazar, un botón secundario: **"Registrar garantía externa"**. Abre un diálogo con los cinco campos. No va en Ventas: el sitio donde se atiende una llamada de un comprador es Pantallas vendidas, y ahí es donde el cliente lo va a buscar.

El diálogo tiene que decir en una línea, antes de confirmar, qué va a pasar: *"Se va a entregar una pantalla de [plataforma] del inventario, ocupada hasta [fecha], y se va a registrar una pérdida de [costo]."* Esta operación saca inventario y registra plata; no puede ser un formulario que se envía a ciegas.

Al terminar, muestra el mensaje generado con el botón de copiar, igual que una venta o una garantía normal.

Usa el componente `Dialogo` existente, y recuerda que su `descripcion` va dentro de un `asChild` sobre un `div` — no metas campos de formulario ahí, usa el slot de `children`.

---

## Pruebas

- **`app-compuesta.test.ts`** — la ruta nueva se agrega ahí, montando la app como `index.ts`, con el caso **sin sesión** y el caso de cada rol (VENDEDOR → 403, EMPLEADO → pasa).
- **La prueba de exclusión** de la Parte 3, que es la que de verdad protege la plata.
- **Que no se desactive ninguna pantalla**: cuenta las pantallas activas antes y después. Debe ser el mismo número. Es el error más probable al copiar `realizarGarantia()`.
- **Sin inventario**: si no hay pantalla libre de esa plataforma, la transacción se revierte completa y no queda ni la `Venta` ni el `VentaDetalle` huérfanos. Verifica contando filas después del error, no solo el código de respuesta.
- **Concurrencia**: dos garantías externas simultáneas de la misma plataforma con una sola pantalla libre — una gana, la otra recibe `SIN_PANTALLAS_DISPONIBLES`, y nunca se entrega la misma pantalla dos veces (R2, `FOR UPDATE SKIP LOCKED` dentro de `tomarPantallasDisponibles`).
- **La garantía de la garantía**: reemplazar la pantalla entregada por una garantía externa funciona por el camino normal de `realizarGarantia()`.
- **Fecha en el pasado** → rechazada.
- **R1**: la venta externa y su garantía quedan con el `empresaId` del usuario; una empresa no ve las de otra.

## Terminado cuando

1. `npx tsc --noEmit` limpio en las dos apps. **Córrelo y pega la salida real.**
2. `bun test` pasa, ejecutado **desde `apps/api`** (Bun lee el `.env` del directorio actual y vive ahí; desde la raíz fallan todas por `DATABASE_URL` vacío).
3. Desde la interfaz: registrar una garantía externa, ver el mensaje, y comprobar que la pantalla entregada aparece ocupada en Pantallas vendidas y **no** aparece como disponible para vender.
4. El dashboard muestra la pérdida en "Pérdida por garantías" y **no** cuenta la venta externa en "Ventas de hoy".
5. No quedan `TODO`, datos quemados ni credenciales en el código.

## Al entregar

Un registro corto: archivos tocados, salida real de `tsc` y `bun test`, qué decidiste distinto de este prompt y por qué, qué quedó sin hacer. Si algo de aquí está mal planteado, dilo — corregir el plan es más barato que corregir el código.
