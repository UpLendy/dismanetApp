# F4.11 — Retención de pantallas vencidas y reinicio manual de cuentas

## Contexto del negocio

Hoy, cuando pasa `fechaVencimiento` de un `VentaDetalle`, la pantalla vuelve
sola al inventario disponible y se puede revender. Eso está mal para cómo
opera el cliente: él **rota las cuentas** — cuando una cuenta se vence, le
cambia la contraseña en el proveedor y solo entonces las pantallas se pueden
volver a vender. Si el software las revende antes de la rotación, el comprador
nuevo recibe credenciales de una cuenta a la que el comprador viejo todavía
tiene acceso.

Lo único que cambia al reiniciar una cuenta es **la contraseña**. Perfiles y
PINes se quedan igual.

## Medición hecha en producción (29-oct-2026) — no la repitas, es el punto de partida

| dato | valor |
|---|---|
| pantallas activas | 7107 |
| con venta vigente | 6920 |
| vencidas sin liberar (pasan a retenidas) | **45** |
| nunca vendidas (siguen libres) | 142 |
| cuentas a reiniciar en la primera pasada | **8** |
| de esas, con ventas vigentes adentro ("mixtas") | **2** |

Consecuencias de esos números, ya decididas:

- **No hay backfill.** El campo nuevo nace en `NULL` y eso ya produce el
  estado deseado. La migración es solo DDL.
- **No hay reinicio en lote.** Con 8 cuentas y una contraseña distinta por
  cuenta no ahorra nada.

---

## Parte 1 — Esquema

### 1.1 `Pantalla.liberadaEn`

```prisma
liberadaEn DateTime?
```

Nullable, sin default, **sin sentencia de backfill en la migración**.
Significa: "la última vez que un operador devolvió esta pantalla al
inventario cambiando la contraseña de su cuenta".

### 1.2 Modelo `ReinicioCuenta` (auditoría)

El reinicio le quita el acceso a quien tenga una venta vigente en esa cuenta.
Cuando un cliente reclame "me quedé sin Netflix", este es el rastro.

```prisma
model ReinicioCuenta {
  id                       String   @id @default(cuid())
  empresaId                String
  cuentaId                 String
  usuarioId                String   // quién reinició
  pantallasLiberadas       Int
  pantallasConVentaVigente Int
  codigosCompraAfectados   String[] // códigos de las ventas vigentes que se quemaron
  createdAt                DateTime @default(now())
  // relaciones + índices siguiendo exactamente el patrón de los demás modelos
}
```

Multi-tenant como todo lo demás (R1): `empresaId` + relación a `Empresa`,
para que la extensión de aislamiento lo cubra.

Una sola migración: no se agregan valores a ningún enum, así que no aplica la
regla de separar archivos.

---

## Parte 2 — La regla de retención (el centro de la entrega)

### 2.1 La regla

```
retenida ⟺ existe un VentaDetalle de esa pantalla, con venta no anulada,
            cuya fechaVencimiento > COALESCE(liberadaEn, -infinity)
```

Esa única expresión cubre los dos casos sin ramas:

- Venta **vigente**: su vencimiento es futuro, siempre mayor que cualquier
  `liberadaEn` pasado ⇒ retiene. (También cuando el cliente sobrevende: varias
  ventas vigentes a la vez sobre la misma pantalla.)
- Venta **vencida**: retiene hasta que alguien reinicie la cuenta y
  `liberadaEn` quede por encima de su fecha.

Estado de tres valores, derivado:

- `OCUPADA` — tiene al menos un `VentaDetalle` vigente.
- `POR_REINICIAR` — retenida pero sin ninguna vigente.
- `LIBRE` — no retenida.

No se guarda en la base: se calcula. No agregues enum de Postgres.

### 2.2 Dónde está hoy esa regla — son CUATRO sitios, no uno

`CLAUDE.md` dice que `estadoDePantallas` es "la ÚNICA consulta del proyecto
que implementa esa regla". **Es falso.** Verifícalo y corrige esa frase en
`CLAUDE.md` como parte de esta entrega.

| archivo | línea aprox. | qué hacer |
|---|---|---|
| `apps/api/src/lib/pantallas.ts` | 92 | aplicar la regla nueva |
| `apps/api/src/lib/bloqueo-pantallas.ts` | 68 | aplicar la regla nueva (SQL crudo) |
| `apps/api/src/lib/diagnostico-empresa.ts` | 163 | **borrar el `count` gemelo** y usar el helper compartido |
| `apps/api/src/routes/garantias.ts` | 88 | **no tocar** |

Sobre `garantias.ts:88`: ese `soloVigentes` significa otra cosa — si la
cobertura del cliente está vigente para pedir garantía. No es disponibilidad
de inventario. Déjalo igual y escribe un comentario de una línea explicando
por qué no cambia, para que la próxima lectura no lo "arregle".

Si los tres primeros no quedan de acuerdo, aparece el bug de siempre en este
proyecto: la pantalla se ve retenida en la interfaz y la venta la asigna
igual. Es el punto más importante de la revisión.

### 2.3 `estadoDePantallas`

Prisma no puede comparar un campo de una fila relacionada contra uno de la
fila padre, así que la regla no se puede expresar en el `where` del `include`.
Hazlo así:

1. `findMany` de pantallas, agregando `liberadaEn` al `select`.
2. Deja **igual** el `include` de `ventaDetalles` filtrado a vigentes — de ahí
   siguen saliendo `ocupadaHasta`, `ventaId` y `codigosCompraAfectados` (F4.7:
   todos los compradores, no solo el último).
3. Una consulta extra: `ventaDetalle.groupBy` por `pantallaId` con
   `_max: { fechaVencimiento: true }` y `where: { pantallaId: { in: ids },
   venta: { anulada: false } }`. La extensión multi-tenant ya cubre `groupBy`.
4. En TypeScript: `retenida = maxVenc !== null && (liberadaEn === null ||
   maxVenc > liberadaEn)`.

No traigas los `ventaDetalles` sin filtro de fecha para calcularlo en
memoria: con 7107 pantallas y ~2500 ventas eso es una lectura sin límite.

En `EstadoPantalla` agrega `estado: "LIBRE" | "OCUPADA" | "POR_REINICIAR"` y
`liberadaEn: Date | null`. Conserva `libre` como campo derivado
(`estado === "LIBRE"`) para no reescribir los ~15 sitios que lo usan.

### 2.4 `tomarPantallasDisponibles` (SQL crudo, R2)

En el `NOT EXISTS`, cambia

```sql
AND vd."fechaVencimiento" > now()
```

por

```sql
AND vd."fechaVencimiento" > COALESCE(p."liberadaEn", '-infinity'::timestamptz)
```

Sigue dentro de la lista blanca de `prisma-raw-lista-blanca.test.ts` — no
agregues consultas crudas nuevas en ningún otro archivo.

### 2.5 Helper nuevo para el diagnóstico

En `pantallas.ts`, exporta un contador global que use `estadoDePantallas` con
`{ activa: true, cuenta: { activa: true } }` y devuelva
`{ libres, porReiniciar, ocupadas }`. `diagnostico-empresa.ts` lo consume y
borra su `count` propio. Agrega `pantallasPorReiniciar` a la respuesta del
diagnóstico.

---

## Parte 3 — Reinicio de cuenta

### 3.1 `GET /cuentas/por-reiniciar`

Rol: **ADMIN** (expone el listado de cuentas, igual que `GET /cuentas` y
`/credenciales`, por D6 del PRD).

Devuelve las cuentas activas con al menos una pantalla en `POR_REINICIAR`. Por
cuenta:

- `id`, `plataformaNombre`, identificador visible (`correo` o `usuario`, lo
  que tenga la plataforma)
- `pantallasPorReiniciar` (cuántas)
- `pantallasConVentaVigente` (cuántas siguen vendidas)
- `codigosCompraAfectados` — los códigos de esas ventas vigentes
- `vencioEl` — el mayor `fechaVencimiento` entre las `POR_REINICIAR`
- `esMixta: boolean` — `pantallasConVentaVigente > 0`

Orden: `vencioEl` ascendente (lo más viejo primero = más urgente).

**Nunca** devuelvas la contraseña en esta ruta. Solo `/credenciales` lo hace.

### 3.2 `POST /cuentas/:id/reiniciar`

Rol: **ADMIN**. Body:

```ts
{
  password: string,            // minLength 1
  confirmarVentasVigentes?: boolean
}
```

Todo dentro de **una sola transacción** — si falla la liberación, la
contraseña nueva no queda guardada:

1. Bloquea las pantallas de la cuenta con `FOR UPDATE`, **ordenadas por
   `numero` ascendente**. Mismo orden interno que usa la venta
   (`ORDER BY p."cuentaId", p.numero`), para no abrir un deadlock entre una
   venta en curso y un reinicio. No se toca la fila de usuario, así que no
   aplica el orden usuario→pantallas de R2.
2. Si `descifrar(cuenta.password) === body.password` ⇒ **409
   `PASSWORD_SIN_CAMBIO`**. Un reinicio que no cambia la contraseña libera
   inventario sin haber rotado nada en el proveedor: es exactamente el bug
   que esta entrega existe para evitar.
3. Calcula el estado. Si hay pantallas con venta vigente y
   `confirmarVentasVigentes` no es `true` ⇒ **409
   `CUENTA_CON_VENTAS_VIGENTES`**, con `codigosCompraAfectados` en la
   respuesta y un mensaje que diga que esos clientes pierden el acceso.
   Mismo patrón que `PANTALLA_VENDIDA` de F4.2: nunca una casilla escondida,
   el frontend la manda solo después de un diálogo explícito.
4. `Cuenta.password = cifrar(body.password)`.
5. `liberadaEn = now()` en **todas** las pantallas de la cuenta, no solo las
   `POR_REINICIAR`. Es correcto y es intencional: una pantalla con venta
   vigente tiene vencimiento futuro, así que `fechaVencimiento > liberadaEn`
   sigue siendo cierto y queda `OCUPADA` — y cuando esa venta venza, volverá
   a pedir reinicio. Escribe ese razonamiento como comentario.
6. Crea la fila de `ReinicioCuenta`.
7. Devuelve el estado nuevo de la cuenta (libres / por reiniciar / totales).

### 3.3 Nada de reinicio en lote

No lo implementes. Con 8 cuentas medidas y una contraseña distinta por cuenta
no aporta, y abre una ruta que puede liberar inventario masivamente.

---

## Parte 4 — Frontend

### 4.1 Página "Cuentas por reiniciar"

Ruta nueva bajo el panel de ADMIN, con enlace desde el listado de cuentas y
**un contador en el enlace** (si hay 8, que diga 8).

Cada fila: plataforma, identificador de la cuenta, "N pantallas por
reiniciar", "venció hace X días". Las mixtas, con un aviso visible en color de
alerta y los códigos de compra listados — se tienen que distinguir de un
vistazo de las limpias.

### 4.2 Diálogo de reinicio

- Campo de contraseña nueva **y campo de confirmación**. Un error de digitación
  acá no es recuperable: DISMANET quedaría con una contraseña que el proveedor
  no tiene, y los mensajes de venta saldrían con el dato malo.
- Recordatorio en el diálogo de que la contraseña se debe cambiar primero en el
  proveedor.
- Si la cuenta es mixta: segundo paso de confirmación que nombre los códigos
  de compra afectados y diga explícitamente que esos clientes pierden el
  acceso. Ese paso manda `confirmarVentasVigentes: true`.
- Maneja `PASSWORD_SIN_CAMBIO` con un mensaje claro, no con el error genérico.

### 4.3 Estado de tres valores en el detalle de cuenta

`apps/web/app/(protegido)/(admin)/panel/cuentas/[id]/page.tsx:307` devuelve
hoy `"libre" | "ocupada"`. Pasa a tres: `libre` / `ocupada` / `por reiniciar`,
con color propio para el tercero.

### 4.4 Disponibilidad para el vendedor

`/disponibilidad` agrega `porReiniciar` por plataforma, y el tablero del
vendedor muestra dos cifras: "X libres · Y por reiniciar". Sin esto el
vendedor ve cero pantallas y no sabe por qué. (Con 97% de ocupación medida,
esto importa — es lo último que cortaría si hay que cortar algo.)

---

## Parte 5 — Pruebas

La prueba crítica es de **acuerdo entre los tres sitios**. Arma pantallas en
cada estado posible y verifica que `estadoDePantallas`,
`tomarPantallasDisponibles` y el contador del diagnóstico digan lo mismo:

1. nunca vendida ⇒ LIBRE
2. venta vigente ⇒ OCUPADA
3. vencida, `liberadaEn = null` ⇒ POR_REINICIAR
4. vencida, `liberadaEn` posterior al vencimiento ⇒ LIBRE
5. vencida, `liberadaEn` **anterior** al vencimiento ⇒ POR_REINICIAR
   (se liberó, se revendió, y esa reventa también venció)
6. sobreventa: dos ventas vigentes a la vez ⇒ OCUPADA, con ambos códigos
7. venta anulada y vencida ⇒ LIBRE (la anulación manda)
8. mixta: misma cuenta con una pantalla vigente y otra vencida sin liberar

Además:

- El reinicio es atómico: si falla el paso de liberación, la contraseña queda
  como estaba.
- `PASSWORD_SIN_CAMBIO` cuando la contraseña es la misma.
- `CUENTA_CON_VENTAS_VIGENTES` sin confirmación; y con confirmación, que la
  fila de `ReinicioCuenta` quede con los códigos correctos.
- Una venta no puede tomar una pantalla `POR_REINICIAR`
  (`SIN_PANTALLAS_DISPONIBLES`).
- Un reemplazo de garantía tampoco puede tomarla.
- R1: el reinicio de una empresa no ve ni toca pantallas de otra.

Recuerda que `mock.module` en Bun es global al proceso, y que las pruebas se
corren desde `apps/api`.

---

## Qué NO entra

- Cambiar perfiles o PINes al reiniciar. El cliente confirmó que lo único que
  cambia es la contraseña.
- Reinicio automático o job programado. Todo se calcula al leer.
- Tocar `garantias.ts:88`.
- Backfill de datos en la migración.

## Al terminar

Reporta: archivos tocados, número de pruebas antes y después, y
explícitamente **las tres implementaciones de la regla de retención con su
línea**, para poder revisar que digan lo mismo. Si encuentras un quinto sitio
que implemente la regla y que no esté en la tabla de la parte 2.2, dilo en vez
de arreglarlo callado.
