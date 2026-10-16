# F4.2 — Campos de cuenta por plataforma y reglas de PIN

**Alcance:** dos cosas y nada más. (1) Que cada plataforma declare qué campos de acceso usa, y que las cuentas y el mensaje de WhatsApp se adapten a eso. (2) Las reglas de PIN: longitud 4 a 6, mismo perfil ⇒ mismo PIN, y no cambiar a ciegas el PIN de una pantalla ya vendida.

**Fuera de alcance, no lo construyas:** el conteo de pantallas por vencer, la venta multi-producto, las estadísticas, la garantía externa. Van en entregas aparte.

---

## Por qué esta entrega existe

El cliente vende plataformas que no se acceden con correo y contraseña. Unas piden usuario, otras un código, otras entran por un enlace propio. Hoy `Cuenta` solo tiene `correo` y `password`, los dos obligatorios, así que el empleado mete el usuario dentro del campo de correo o lo escribe en las notas, y el comprador recibe un mensaje que dice `CORREO:` seguido de algo que no es un correo.

Y el cliente reportó que la plataforma "no deja poner más de 4 pines". No era eso: `cuentas.ts:87` valida el PIN con `pattern: "^[0-9]{4}$"` — **exactamente** cuatro dígitos. Él tiene plataformas con PIN de 6 y no las puede cargar.

---

## Parte 1 — La plataforma declara qué campos usa

### 1.1 Esquema

Ya existe el precedente exacto de lo que hay que hacer: `Plataforma.usaPerfilPin`. Es un booleano en la plataforma que decide si el bloque PERFIL/PIN sale en el mensaje. Replica esa forma, no inventes otra.

En `Plataforma`, cuatro booleanos nuevos:

```prisma
usaCorreo  Boolean @default(true)
usaUsuario Boolean @default(false)
usaCodigo  Boolean @default(false)
usaEnlace  Boolean @default(false)
```

`usaCorreo` arranca en `true` porque hoy todas las cuentas tienen correo y era obligatorio: con ese default, ninguna plataforma existente cambia de comportamiento. Los otros tres en `false` por la misma razón.

No modeles esto como una tabla `CampoPlataforma` ni como un JSON de campos. El conjunto es cerrado y chico, `usaPerfilPin` ya fijó la forma, y los booleanos quedan tipados de punta a punta sin parsear nada en tiempo de ejecución.

En `Cuenta`:

```prisma
correo   String?   // deja de ser obligatorio
usuario  String?
codigo   String?   // cifrado, igual que password
enlace   String?
password String    // sigue obligatorio, sin cambio
```

`password` es el único que nunca es opcional. `codigo` se guarda **cifrado** con `lib/cifrado.ts`, igual que `password` y `pin`: es una credencial, y como el cifrado es reversible no se pierde nada por tratarlo así. `usuario` y `enlace` van en texto plano — el usuario no es secreto y el enlace es una URL pública.

En `VentaDetalle`, las copias inmutables de R3:

```prisma
correoCuenta   String?   // pasa a opcional
usuarioCuenta  String?
codigoCuenta   String?   // cifrado
enlaceCuenta   String?
```

### 1.2 La migración

Una sola migración. `String` → `String?` es un ensanchamiento: no hay pérdida de datos, no hay backfill, no hay nada que recalcular. No se agrega ningún valor de enum, así que no aplica la trampa de "no se puede usar un valor de enum nuevo en la misma transacción que lo crea".

Verifica que la migración generada **no** tenga un `DROP COLUMN` ni un `SET NOT NULL`. Si Prisma genera algo así, para y revisa el schema antes de aplicarla.

### 1.3 Que el dato nazca bien

Esta es la regla permanente del proyecto y ya mordió cuatro veces: **arreglar el dato no es arreglar la fuente.**

Si una plataforma declara `usaCorreo = true`, entonces crear o editar una cuenta de esa plataforma **exige** `correo` no vacío. Lo mismo para los otros tres. La validación no puede vivir en el esquema TypeBox porque depende de la plataforma, así que va en el handler, después de cargar la plataforma, con un error de negocio:

```
409 { error: { codigo: "CAMPO_REQUERIDO_POR_PLATAFORMA", mensaje: "Netflix necesita correo." } }
```

Y al revés: si la plataforma **no** declara un campo, ese campo se rechaza con el mismo código y un mensaje distinto. No se guarda en silencio un dato que la plataforma dice que no usa — ahí es donde nacen los campos fantasma.

La prueba que vigila esto no es "la cuenta quedó bien". Es **"una cuenta creada mañana para una plataforma con `usaUsuario = true` no se puede guardar sin usuario"**.

Como todas las plataformas existentes arrancan con `usaCorreo = true` y todas las cuentas existentes tienen correo (era obligatorio), ningún dato actual viola la regla nueva. No hace falta migración de datos. Confírmalo con una consulta antes de dar la entrega por terminada.

### 1.4 El formulario

`cuerpoCrearCuenta` y `cuerpoEditarCuenta` en `routes/cuentas.ts` reciben los cuatro campos como opcionales en TypeBox; la obligatoriedad real la decide el handler según la plataforma (1.3).

En el front, el formulario de cuenta nueva ya pide la plataforma primero. Al elegirla, muestra **solo** los campos que esa plataforma declara, con el obligatorio marcado. Un campo que la plataforma no usa no se muestra deshabilitado: no se muestra.

El listado de cuentas hoy muestra `correo` como identificador de la fila. Cuando una cuenta no tiene correo, muestra `usuario`; si tampoco, el nombre de la plataforma más los últimos 6 del id. Nunca una celda vacía — una fila sin identificador visible es una cuenta que nadie puede encontrar.

En la pantalla de configuración de la plataforma, los cuatro interruptores van junto al de perfil/PIN que ya existe, en el mismo bloque y con el mismo tratamiento visual.

### 1.5 El mensaje

Hoy `quitarBloquesPerfilPin()` en `lib/mensaje.ts` quita el bloque completo —separado por línea en blanco— que contiene `{{perfil}}` o `{{pin}}`, para que la etiqueta no quede huérfana. Esa función resolvió exactamente este problema una vez; generalízala, no la dupliques:

```ts
function quitarBloquesDeCamposNoUsados(plantilla: string, camposActivos: CamposPlataforma): string
```

Quita el bloque de cualquier marcador cuyo campo la plataforma no declare. Los marcadores nuevos son `{{usuario}}`, `{{codigo}}` y `{{enlace}}`, y `{{correo}}` pasa a ser removible igual que los demás.

Para paquetes, `bloqueListaCuentas()` arma las líneas a mano. Agrega las líneas nuevas condicionadas al flag de cada componente, con el mismo formato que las existentes:

```
*USUARIO:* ...
*CÓDIGO:* ...
*ENLACE:* ...
```

También hay que tocar:

- `lib/marcadores-mensaje.ts` — `MARCADORES_UNIDAD` suma `usuario`, `codigo`, `enlace`. Esto es lo que alimenta los botones del editor de plantillas y la validación de marcadores inválidos.
- `lib/plantillas-default.ts` — agrega los tres bloques nuevos a `PLANTILLA_UNIDAD_POR_DEFECTO` y a `PLANTILLA_RESPALDO_UNIDAD`. Como el bloque se quita cuando la plataforma no usa el campo, agregarlos al texto por defecto no rompe nada para las plataformas que solo usan correo.
- `lib/datos-ejemplo-mensaje.ts` — la vista previa necesita valores de ejemplo y los flags, o el editor va a mostrar los marcadores nuevos sin reemplazar.

**Lo que NO hay que hacer:** actualizar la plantilla que la empresa ya tiene guardada en `PlantillaMensaje`. Esa es suya y puede estar editada. Los bloques nuevos aparecen en el editor como botones para que el ADMIN los inserte donde quiera. Cambiarle la plantilla por debajo es editarle el texto que le manda a sus compradores.

---

## Parte 2 — Reglas de PIN

### 2.1 De 4 a 6 dígitos, arreglando la fuente

La regla "4 dígitos" está escrita a mano en **cinco** lugares:

| Archivo | Línea |
|---|---|
| `apps/api/src/routes/cuentas.ts` | 87 — `pattern: "^[0-9]{4}$"` |
| `apps/api/src/routes/plataformas.ts` | 81 — mismo patrón |
| `apps/web/app/(protegido)/(admin)/panel/cuentas/[id]/page.tsx` | 330–331 — `pattern` y `maxLength={4}` |
| `apps/web/app/(protegido)/(admin)/panel/catalogo/plataformas/page.tsx` | 465 — `maxLength={4}` |
| `apps/api/src/lib/pantallas.ts` | 16 — `pinAleatorio()` genera 4 dígitos |

Cambiar los cinco a mano es repetir el problema. La regla vive **una vez**, en `packages/shared`:

```ts
export const PIN_LONGITUD_MIN = 4;
export const PIN_LONGITUD_MAX = 6;
export const PIN_PATRON = `^[0-9]{${PIN_LONGITUD_MIN},${PIN_LONGITUD_MAX}}$`;
```

Los cinco sitios la importan. Y una prueba que lo vigila, en el mismo estilo que la que cuida la lista blanca de SQL crudo: lee los archivos fuente de `apps/api/src` y `apps/web` y falla si alguno contiene el literal `[0-9]{4}` o un `maxLength={4}` en un campo de PIN. Sin esa prueba, la sexta copia aparece sola.

Ya que estás en `lib/pantallas.ts`: `letraPerfil()` está duplicada en `apps/web/.../catalogo/plataformas/page.tsx:46`. Muévela también a `packages/shared` y que los dos lados la importen.

`pinAleatorio()` sigue generando 4 dígitos. Está bien: 4 es válido dentro del rango y es lo que el cliente usa por defecto. Solo tiene que dejar de ser un número suelto en el código.

### 2.2 Mismo perfil ⇒ mismo PIN

Dentro de una misma cuenta, dos pantallas con el mismo `perfil` (no nulo) deben tener el mismo `pin`. Misma regla dentro de la plantilla de pantallas de una plataforma (`PlataformaPantalla`).

Es la regla correcta y no "prohibir perfiles repetidos", porque el cliente **sobrevende a propósito**: dos compradores distintos en el mismo perfil es una decisión comercial suya, no un error. Lo que no puede pasar es que a esos dos compradores les lleguen PINes distintos para la misma puerta.

**`pinesDistintos()` hace hoy exactamente lo contrario.** Está escrita para que dos pantallas de la misma cuenta nunca compartan PIN. Reemplázala por:

```ts
export function pinesPorPerfil(perfiles: readonly (string | null)[]): (string | null)[]
```

Un PIN por perfil distinto, reutilizado en las repeticiones. Las pantallas con `perfil = null` siguen recibiendo cada una el suyo.

**Esta es la causa más probable del enredo del PIN que reportó el cliente**: en una cuenta de Netflix, las pantallas #2 y #7 tienen ambas perfil B pero PINes 2040 y 3060. Las de perfil A (#1 y #6) coinciden en 1020 porque alguien las igualó a mano y no se acordó de B. El generador produjo esa diferencia por diseño.

**Al escribir:** `PATCH /cuentas/:id/pantallas/:pantallaId` y la ruta de la plantilla de plataforma, cuando cambian un PIN, lo **propagan** a todas las pantallas hermanas con el mismo perfil, y devuelven la lista de las que tocaron. No rechaces con un error: rechazar deja el dato inconsistente para siempre, que es el estado en el que está hoy. El front avisa antes de guardar: *"Este PIN se va a aplicar a las 2 pantallas con perfil B."*

**Los datos que ya están mal** no se tocan desde una migración. No hay forma de saber si el PIN bueno de ese perfil B es 2040 o 3060 — esa respuesta la tiene el cliente, no la base. Agrega la detección a `lib/diagnostico-empresa.ts`, que ya existe: una lista de cuentas donde un mismo perfil tiene PINes distintos, visible para el ADMIN, para que él los iguale. Inventar el dato es peor que mostrarlo roto.

### 2.3 No cambiar a ciegas el PIN de una pantalla vendida

`PATCH /cuentas/:id/pantallas/:pantallaId` hoy cambia `perfil` y `pin` **sin verificar nada**. Si la pantalla está vendida y vigente, el comprador ya recibió el PIN viejo por WhatsApp y nadie se entera de que dejó de servir.

Regla: si la pantalla está ocupada según R5 —existe un `VentaDetalle` con venta no anulada y `fechaVencimiento > now()`— el cambio se rechaza con

```
409 { error: { codigo: "PANTALLA_VENDIDA", mensaje: "..." } }
```

salvo que el cuerpo traiga `confirmarPantallaVendida: true`. La respuesta del 409 incluye los **códigos de compra** afectados, para que quien confirma sepa a quién hay que avisarle. El front muestra ese mensaje con los códigos y un botón de confirmar explícito, no un checkbox escondido.

**Lo que NO cambia:** `VentaDetalle.pin`. Es historia (R3) y no se edita. El comprador recibió ese PIN y el registro tiene que seguir diciendo cuál recibió. La confirmación autoriza cambiar la pantalla, no reescribir lo que ya se entregó.

Usa `pantallasDeCuenta()` / la consulta de `lib/pantallas.ts` para saber si está ocupada. **No** uses `Venta.fechaVencimientoMax` (R5).

---

## Pruebas

Además de las de cada parte:

- **`app-compuesta.test.ts`** — toda ruta nueva o con guarda modificada se agrega ahí, montando la app como `index.ts`, con el caso **sin sesión** y el caso de cada rol. Una entrega que agrega rutas sin tocar ese archivo está incompleta.
- **Mensaje, los dos caminos.** El bug que más se repite en este proyecto es "el camino probado está bien y el gemelo que nadie probó está mal": el mensaje de unidad y el de paquete son rutas distintas. Prueba las dos para cada combinación de campos — con correo, sin correo, con usuario y código, solo enlace.
- **Que no quede etiqueta huérfana.** La prueba del mensaje verifica que no aparece `CORREO:` seguido de nada. Esa línea vacía ya se entregó a compradores una vez.
- **P2002.** Si alguna de las escrituras nuevas cae sobre una restricción única, manéjalo con `restriccionViolada()`. Validar antes no reemplaza manejar P2002 — dos peticiones simultáneas pasan ambas la validación.

## Terminado cuando

1. `npx tsc --noEmit` limpio en las dos apps. **Córrelo y pega la salida real**, no la des por buena.
2. `bun test` pasa, ejecutado **desde `apps/api`** (Bun lee el `.env` del directorio actual y vive ahí; desde la raíz fallan todas por `DATABASE_URL` vacío).
3. Se puede, desde la interfaz: configurar una plataforma con usuario + código + enlace sin correo, crear una cuenta suya, venderla, y que el mensaje salga con esos tres campos y **sin** la etiqueta de correo.
4. Un PIN de 6 dígitos se guarda. Uno de 3 y uno de 7 se rechazan, en el API y en el formulario.
5. Cambiar el PIN de una pantalla con perfil repetido actualiza las hermanas y lo dice.
6. Cambiar el PIN de una pantalla vendida pide confirmación y nombra los códigos de compra.
7. El diagnóstico lista las cuentas con perfiles de PIN inconsistente.
8. No quedan `TODO`, datos quemados ni credenciales en el código.

## Al entregar

Un registro corto con: qué archivos tocaste, la salida real de `tsc` y `bun test`, qué decidiste distinto de este prompt y por qué, y qué quedó sin hacer. Si algo de aquí resultó estar mal planteado, dilo — es más barato corregir el plan que el código.
