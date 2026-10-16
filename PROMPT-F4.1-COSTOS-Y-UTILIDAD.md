# Prompt F4.1 — Costos reales y utilidad verdadera

> **Estado:** listo para ejecutar.
> **Peso:** ~20 h. Es el camino del dinero: el bloque más delicado desde el saldo.
> **Verificable al terminar:** el cliente carga cada costo **una sola vez**, los paquetes calculan el suyo solos, y la utilidad del panel descuenta las garantías del día.

---

## De dónde sale esto

El cliente vio $906.400 de ingresos contra $686.459 de utilidad en dos horas reales de venta — 75,7% de margen, cuando el costo registrado fue apenas el 24% del ingreso. Faltaba cerca de la mitad del costo.

La causa es estructural, no un error de digitación: **hoy la matriz pide el costo una vez por cada columna de tipo de cliente.** Si se llena en una columna y se vende por otra, la venta registra costo cero y la utilidad queda igual al precio completo.

## Lo que respondió el cliente

| Pregunta | Respuesta |
|---|---|
| ¿El costo es por pantalla o por cuenta? | **Por pantalla.** El modelo actual es correcto. |
| ¿El costo cambia según el tipo de cliente? | **No.** El costo es uno solo; lo que cambia es el precio de venta. |
| ¿El precio del paquete sigue siendo manual? | **Sí.** Solo el costo se calcula. |
| ¿Se prorratea el costo por duración? | **No.** Compra pines de corta duración; cada duración tiene su costo propio. |
| ¿Las garantías descuentan de la ganancia? | **Sí**, por el costo de la pantalla, no por su precio. Y mostrada aparte además del neto. |
| ¿De qué día es la pérdida de una garantía? | **Del día de la garantía**, no del día de la venta. |
| ¿Paquetes de más de una pantalla de la misma plataforma? | Hoy ninguno, pero quiere la opción abierta y bien hecha. |

---

## El prompt

```
Lee CLAUDE.md, DISENO.md, PRD-MVP-Ventas.md y GUIA-DE-PRUEBA.md antes de
empezar. Las credenciales de desarrollo están en GUIA-DE-PRUEBA.md.

Antes de escribir código lee lib/ventas.ts completa, lib/paquetes.ts
(resolverComposicionDePaquete y costoComponentesPaquete), lib/garantias.ts y
routes/precios.ts. Este bloque reordena de dónde sale el costo en todos ellos.

Esto es el camino del dinero y corrige números que el cliente ya está mirando
mal. Si algo no te cuadra, para y dilo antes de construir.

## 1. El costo deja de depender del tipo de cliente

Hoy `Precio` guarda `precioVenta` y `costo` por (plataforma|paquete, duración,
tipoCliente). El costo repetido por columna es la causa del bug: se llenó una
columna y no la otra.

Modelo nuevo, con `empresaId` como todos (R1):

    CostoPlataforma
      id, empresaId, plataformaId, duracionId
      costo  Decimal(14,2)
      @@unique([empresaId, plataformaId, duracionId])

- `Precio.costo` **deja de leerse en todo el código.** No borres la columna en
  esta entrega: una prueba vigila que ningún archivo de `src/` la lea, y se
  elimina más adelante.
- `Precio` conserva `precioVenta`, que sí varía por tipo de cliente.

**Migración de datos:** por cada par (plataformaId, duracionId) que hoy tenga
al menos un `Precio` con `costo > 0`, crear su `CostoPlataforma` con el
**mayor** de esos valores. Reportar cuántos pares quedaron sin ningún costo —
esos los completa el cliente a mano.

## 2. El costo del paquete se calcula, no se escribe

Un paquete son N pantallas de M plataformas: su costo es lo que cuestan esas
pantallas. Pedirlo a mano es pedirle al admin que mantenga sincronizado algo
que el sistema ya sabe.

`costoComponentesPaquete` pasa a leer de `CostoPlataforma` y **deja de recibir
`tipoClienteId`** — el costo ya no depende de eso.

**Y corrige el bug que tiene hoy:** la suma recorre los componentes pero nunca
multiplica por `cantidadPantallas`, así que un paquete con dos pantallas de
Netflix cuenta Netflix una sola vez.

    suma = suma.plus(costo.times(componente.cantidadPantallas))

Hoy el cliente no tiene paquetes de más de una pantalla por plataforma, así
que no cambia ningún número todavía. Lo quiere bien hecho para cuando los
tenga, y **sin esto el cambio de arriba empeoraría las cosas**: pasaríamos de
un costo escrito a mano a un costo calculado que subestima.

## 3. Qué guarda la venta

- **UNIDAD:** `costo` = `CostoPlataforma(plataformaId, duracionId)`.
- **PAQUETE y PROMOCIÓN:** `costo` = la suma de componentes de arriba.
- `utilidad = precioVenta − costo`, como siempre.
- Todo sigue siendo **copia inmutable** al momento de vender (R3).

**Si falta algún costo, la venta NO se bloquea.** Se guarda lo que se pueda
—cero para una unidad sin costo, la suma parcial para un paquete— porque nadie
puede quedarse sin vender por un dato de configuración. Lo que sí tiene que
pasar es que el aviso lo denuncie (punto 5).

## 4. Las garantías descuentan de la utilidad del periodo

`Garantia.costoAsumido` ya guarda lo que se pide: el costo de la pantalla, no
su precio. **Pero hoy lo toma de `Precio.costo`** — pásalo a `CostoPlataforma`,
o seguirá guardando ceros.

En los totales:

    utilidad del periodo = Σ Venta.utilidad (no anuladas, del periodo)
                         − Σ Garantia.costoAsumido (creadas en el periodo)

- **La pérdida es del día de la garantía, no del día de la venta.** Decisión
  del cliente: es cuando sale el costo, y así los días ya cerrados no se mueven
  solos cada vez que alguien reclama.
- La venta original **no se toca** (R3). El descuento vive en el total, no en
  la fila.
- La respuesta devuelve **las dos cifras**: la utilidad neta y la pérdida por
  garantías por separado.

**En pantalla:** la utilidad se muestra ya neta, y debajo, como línea
secundaria del mismo tile, "Pérdida por garantías: $X". No un quinto recuadro
en el panel — ya hay cuatro y en el teléfono, que es donde el cliente lo mira,
agregar uno los achica todos. Igual en los tres recuadros de `/ventas`.

Si en un periodo no hubo garantías, la línea no aparece.

## 5. El aviso cambia de forma

Deja de contar "celdas de precio sin costo". Ahora cuenta:

- combinaciones de plataforma y duración **sin costo registrado**;
- paquetes cuyos componentes **no tienen el costo completo**.

Con el enlace a dónde arreglarlo. Va en el panel y en `/ventas`, con la misma
redacción en los dos.

## 6. La matriz de precios cambia de forma

- **Unidades:** las columnas de tipo de cliente quedan solo con el precio. El
  costo se pide **una vez por fila de duración**, fuera de las columnas.
- **Paquetes:** desaparece el campo de costo. En su lugar, el costo calculado
  en modo lectura, con el detalle de qué componente aporta cuánto.
- El chivato `costoNoCoincide` de paquetes **se elimina**: ya no hay dos
  números que comparar, el costo *es* la suma.
- La advertencia de precio por debajo del costo se queda, comparando contra el
  costo calculado.

Dilo en la pantalla: que el costo es uno solo para todos los tipos de cliente.
El admin viene de una matriz donde lo escribía tres veces.

## 7. Script de reparación — una sola corrida, a mano

`apps/api/prisma/reparar-costos-historicos.ts`. **No es una migración y no es
un endpoint.** Se corre con el CLI de Railway, una vez, después de que el
cliente cargue los costos.

- Solo toca `Venta` con `costo = 0`. **Nunca una que ya tenga un costo real.**
- **UNIDAD:** `CostoPlataforma(venta.plataformaId, venta.duracionId)`.
- **PAQUETE y PROMOCIÓN:** recalcula desde sus `VentaDetalle`, no desde la
  composición actual del paquete. Cada `VentaDetalle` ya guarda su
  `plataformaId` y su `duracionId` reales — es lo que de verdad se entregó, y
  el paquete pudo cambiar desde entonces. Eso además da gratis la cuenta por
  pantalla: hay una fila por pantalla entregada.
- Recalcula también `utilidad`.
- Si el costo sigue sin poderse determinar, **deja la venta como está** y la
  reporta.
- **Modo simulación por defecto.** Imprime la tabla —id, código, fecha, costo
  antes y después, utilidad antes y después— y no escribe nada. Solo escribe
  con `--aplicar`.

### Esto es una excepción a R3, y queda anotada como tal

`Venta.costo` es copia inmutable por diseño. Esto la reescribe.

Se justifica porque no estamos editando la historia sino **corrigiendo un error
de registro**: esas ventas no guardaron cero porque el costo fuera cero, sino
porque el dato no existía. Pero no puede volverse costumbre.

Agrega a `CLAUDE.md`, bajo R3, una nota fechada: qué se corrigió, por qué, con
qué script, y que **cualquier otra reescritura del histórico se discute antes
de construirse**.

Y que quede claro en el reporte: como los costos nunca se cargaron, no existe
un costo histórico que recuperar. El script usa los de hoy. Para una venta de
la semana pasada eso es una aproximación.

## 8. Lo que viaja en el mismo despliegue

Dos pendientes que ya llevan esperando y tocan archivos de este bloque:

- **`POST /plataformas` sigue exigiendo `capacidadPantallas >= 1`** y
  escribiéndolo sin crear filas de plantilla, y **el seed sigue sin crear
  plantilla**. Es el caso de la convención de `CLAUDE.md` sobre arreglar la
  fuente y no solo el dato; va por la cuarta vez. `POST` deja de recibir ese
  campo y lo crea en 0 — el número ya es derivado, el `PUT` de la plantilla lo
  escribe desde `pantallas.length`. Y el seed crea sus filas.
- **`--secundario-suave` volvió a quedar claro en modo oscuro** al revertirse
  el rediseño. Los valores correctos están en el registro de F3.3: panel
  `#23214A`, y `--secundario-texto` nuevo (`#4F46E5` claro / `#C7D2FE`
  oscuro), con `pastilla.tsx` usando `text-secundario-texto`.

## 9. Verificación

- Las pruebas existentes pasan sin modificarse. `tsc --noEmit` limpio en ambas
  apps, cero errores incluidos los de archivos de prueba.
- `app-compuesta.test.ts` para toda ruta nueva o guarda tocada, con el caso sin
  sesión.
- **R1:** `CostoPlataforma` entra en la cobertura derivada del esquema (el
  conteo de modelos con `empresaId` sube).
- **R4:** ninguna respuesta a VENDEDOR ni a EMPLEADO contiene "costo",
  "utilidad", "margen" ni la pérdida por garantías.
- **R3:** una venta hecha hoy conserva su `costo` y su `utilidad` aunque
  después se cambie el `CostoPlataforma`.
- Costo de paquete = suma de componentes **multiplicada por sus pantallas**:
  prueba con un paquete de dos pantallas de la misma plataforma.
- Venta con un costo faltante: se registra, no se bloquea, y el aviso la
  cuenta.
- Totales: una garantía creada hoy sobre una venta de ayer **descuenta de hoy**
  y deja el total de ayer intacto.
- Las dos cifras vuelven por separado: utilidad neta y pérdida.
- Migración de datos: corre dos veces sin cambiar nada la segunda, y toma el
  mayor costo cuando las columnas difieren.
- **Script de reparación:** en simulación no escribe nada; solo toca ventas con
  costo en cero; corrido dos veces con `--aplicar` no cambia nada la segunda;
  una venta de paquete se repara desde sus `VentaDetalle`.
- Recorre en claro y en oscuro lo que toques.

## 10. Entregable

Reporta:
- Cuántos pares plataforma+duración quedaron con costo y cuántos sin.
- Cuántas ventas quedarían reparadas y cuántas no se pueden determinar
  (corriendo el script en simulación contra la base de desarrollo).
- Si encontraste algún otro lugar que siga leyendo `Precio.costo`.
```

---

## El orden de ejecución en producción, que importa

1. Desplegar este bloque.
2. **El cliente carga los costos que falten**, ahora una sola vez por plataforma y duración. El aviso le dice cuáles.
3. Snapshot de la base.
4. Correr el script **en simulación** y revisar la tabla.
5. Correr con `--aplicar`.
6. Guardar la salida: es el rastro de qué se cambió.

Si se corre el script antes del paso 2, las combinaciones sin costo se quedan en cero igual y hay que correrlo otra vez.

## Lo que hay que decirle al cliente antes

- **Los números de días pasados van a cambiar** cuando se corra la reparación. Es el punto, pero mejor que lo sepa antes de verlo.
- Esas cifras reparadas son **aproximaciones**: se calculan con los costos de hoy porque nunca hubo otros.
- De ahora en adelante **el costo se escribe una sola vez** por plataforma y duración, no una por tipo de cliente. Es el cambio que evita que esto se repita.
