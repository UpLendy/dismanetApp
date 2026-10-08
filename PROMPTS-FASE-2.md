# Prompts — Fase 2

Trabajo posterior al MVP. Mismas reglas: `CLAUDE.md` y `PRD-MVP-Ventas.md` siguen vigentes, un prompt por sesión, una rama y un PR por bloque.

---

## Orden y razón

| # | Bloque | Peso | Riesgo | Depende de | Estado |
|---|---|---|---|---|---|
| 1 | Códigos para sorteos · celular opcional · tema claro y oscuro | ~14 h | Bajo | Nada | **Entregado**, con dos correcciones |
| 2 | Promociones | ~6 h | Bajo | Bloque 1 | **Entregado**, con una corrección |
| 3 | Saldo de revendedores y rol de empleado | ~22 h | **Alto** | Bloque 2 | Falta definir |
| 4 | Módulo de garantías | ~28 h | Medio | La especificación del cliente | Bloqueado |
| — | Logo | ~1 h | Nulo | Que llegue el archivo | Bloqueado |
| — | Rediseño de la pantalla de ventas | ~8 h | Bajo | Saber qué no le gusta | Bloqueado |

**Por qué este orden.** El bloque 1 no depende de nada, no toca el camino del dinero y es lo que el cliente ve primero: su sistema en claro, con sus colores, y la lista de códigos que necesita para sus sorteos. El bloque 2 bajó de ~16 h a ~6 h al cambiar el modelado (ver abajo): dejó de ser un tipo de ítem nuevo y pasó a ser una bandera sobre uno que ya funciona. El bloque 3 va de último entre los grandes porque **toca los roles de usuarios que ya están en producción y el camino de la venta**: es el único que puede dejar al cliente sin poder vender si sale mal.

---

## Decisiones tomadas y riesgos registrados

### Promoción = un paquete marcado como promoción, no una entidad nueva

**Decisión revisada.** La versión anterior de este documento modelaba `Promocion` como entidad propia, copiando entera la máquina de `Paquete`. Al escribir el prompt quedó claro que el costo no se justifica.

Una promoción y un paquete son la misma cosa estructuralmente: **un ítem con nombre que entrega varias pantallas, con precio propio por duración y tipo de cliente, y que se entrega con la plantilla de PAQUETE.** Lo único que las distingue es comercial: la promoción se agrupa aparte para que el vendedor la encuentre, y probablemente es temporal.

Entonces: `Paquete` suma el campo `esPromocion`. Nada más.

Qué se evita con eso:

| Con entidad propia | Con la bandera |
|---|---|
| 3 modelos nuevos (`Promocion`, `PromocionPlataforma`, `PromocionDuracionPlataforma`) | ninguno |
| `Precio` gana una tercera clave foránea y el CHECK pasa a "exactamente uno de tres" | `Precio` no se toca |
| Segunda matriz de excepciones de duración en el panel | la que ya existe |
| `resolverComposicionDePaquete` duplicado para promociones | una sola función en el camino del dinero |
| Tercer brazo en cada bifurcación por `tipoVenta` | ninguna bifurcación cambia |

Y además resuelve gratis un caso que la entidad propia también habría tenido que resolver: **una promoción de una sola plataforma** ("Netflix 1 mes a $8.000") es un paquete de un componente. Funciona sin código nuevo.

Consecuencias que sí quedan:

- **`tipoVenta` se queda en `PAQUETE` para las promociones.** La separación en los reportes se hace con una copia inmutable `Venta.esPromocion`, escrita al vender (R3). Agregar un tercer valor al enum obligaría a revisar cada `switch` sobre `tipoVenta` —incluida la resolución de plantilla— y eso es riesgo sin beneficio.
- La copia en `Venta` es obligatoria, no opcional: si el admin desmarca la promoción el mes que viene, las ventas viejas tienen que seguir contando como promociones. Leer la bandera del paquete al reportar violaría R3.
- **El tipo de cliente "Promoción" queda obsoleto.** No se borra —hay ventas históricas que lo referencian (R3)— pero se desactiva, o el vendedor va a ver "Promoción" en dos lugares distintos con significados distintos.

> **Si el cliente quiere promociones como entidad completamente aparte** —con vigencia desde/hasta, con su propia plantilla de mensaje, con reglas que un paquete no tiene— el camino es el de la entidad propia y son ~16 h. Decirlo antes de ejecutar este bloque, no después.

### Saldo con bloqueo duro

El saldo baja solo al vender y la venta se rechaza si no alcanza. Eso lo convierte en **parte del camino del dinero**, con las mismas exigencias que la asignación de pantallas:

- La verificación y el descuento van **dentro de la transacción de venta**, con bloqueo de la fila del usuario. Dos ventas simultáneas del mismo revendedor no pueden gastar el mismo saldo.
- Toda variación del saldo deja un **movimiento registrado**: quién, cuánto, cuándo, por qué. El saldo guardado es el valor vigente; los movimientos son la historia. Nunca se edita un movimiento pasado.
- Anular una venta **devuelve el saldo con un movimiento nuevo**, no editando el original.

### ⚠️ El cambio de roles puede dejar sin vender a quien ya trabaja

Hoy en producción todos los vendedores tienen rol `VENDEDOR`. Si `VENDEDOR` pasa a significar "revendedor con saldo", **los empleados actuales del cliente quedan como revendedores con saldo en cero y no pueden vender**.

La migración tiene que convertir los `VENDEDOR` existentes a `EMPLEADO` en el mismo despliegue que introduce el rol. Es el punto más delicado de toda la fase 2.

---

## Registro de entregas

### F2.1 — Códigos, celular y tema claro · **aprobada con dos correcciones**

Revisado el 7 de octubre. Lo verificado contra el código, no contra el reporte:

| Qué | Resultado |
|---|---|
| `/ventas/codigos` monta **después** de `requiereRol(Rol.ADMIN)` | Correcto. Un VENDEDOR no puede llevarse los códigos de la empresa entera. |
| Reutiliza `whereDesdeFiltros()` de `/listado` | Correcto. Los filtros no pueden desincronizarse. |
| `anulada: false` forzado sobre el filtro recibido | Correcto. No depende de lo que mande el cliente. |
| Un código por venta, no por pantalla | Correcto — el campo vive en `Venta`. |
| `celularCliente` solo al autor de la venta | Correcto. `/mias` filtra por `vendedorId` propio; `/listado` y `/codigos` son de ADMIN. |
| Tema claro antes de la primera pintura | Correcto. Script en línea en `<head>`, con try/catch, y `prefers-color-scheme` eliminado de `globals.css`. |

**Corrección 1 — `tsc --noEmit` no estaba limpio.** El reporte decía "limpio" y aparte mencionaba 2 errores preexistentes en `app-compuesta.test.ts`. Las dos cosas no pueden ser verdad a la vez: la definición de terminado de `CLAUDE.md` pide `tsc` limpio en ambas apps. Eran dos `Object is of type 'unknown'` por leer `.json()` sin tipar. Arreglados con un tipo `RespuestaError` local. Que estuvieran de antes no los hace ajenos: están justo en el archivo que es la defensa del proyecto contra la fuga de hooks entre routers, y un archivo que no compila es un archivo que nadie va a querer tocar.

**Corrección 2 — ruta nueva sin caso en `app-compuesta.test.ts`.** La convención es explícita: *"Una entrega que agrega rutas sin tocar ese archivo está incompleta."* Se agregó el caso de la Entrega 10, que verifica tres cosas sobre la app montada completa: 403 para VENDEDOR, el código de una venta recién hecha aparece para ADMIN, y desaparece al anularla. Es exactamente la prueba que un router aislado no puede dar.

**Lo que sigue sin verificarse de verdad: el tema en claro.** Se auditó por código —cero colores quemados en `app/(protegido)`— y la auditoría salió bien. Pero nadie ha visto las nueve pantallas en claro. En este proyecto, cada verificación visual pendiente terminó encontrando algo. Vale más mirarlas que confiar en los tokens.

**Pendiente de respuesta:** los códigos quedaron **uno por compra**. Si para el sorteo el cliente quiere una entrada por pantalla entregada —un paquete de tres pantallas, tres oportunidades— hay que cambiarlo, y conviene hacerlo antes de que corra el primer sorteo.

**Operativo:** el trabajo de F2.1 quedó sin commitear sobre `feat/perfil-mensajes-diagnostico`, que es la rama del bloque anterior. Va en su propia rama.

### F2.2 — Promociones · **aprobada con una corrección**

Revisado el 8 de octubre. El modelado por bandera funcionó como se esperaba: **cero bifurcaciones nuevas en el backend.** Las únicas líneas con `esPromocion` fuera de la interfaz son el campo copiado al vender, los `select`, y una cláusula en `whereDesdeFiltros()`. Ningún `if` de negocio distingue promoción de paquete, así que el camino del dinero sigue siendo uno solo.

Verificado contra el código:

| Qué | Resultado |
|---|---|
| Dos campos aditivos con default, migración de esquema aparte de la de datos | Correcto. Son dos migraciones, no una — y así está mejor. |
| `Venta.esPromocion` copiado desde `Paquete.esPromocion` al vender, nunca actualizado | Correcto, y `false` fijo para UNIDAD. |
| `whereDesdeFiltros()` filtra por `Venta.esPromocion`, no por el paquete relacionado | Correcto, con el comentario de R3 en el sitio. |
| Migración de datos idempotente y segura en empresa nueva | Correcta. `UPDATE … WHERE nombre = 'Promoción' AND activo = true` no empareja nada la segunda vez. |
| `tipoVenta` sigue en UNIDAD \| PAQUETE | Correcto. |

**Corrección — la migración limpió el pasado, no la fuente.**

`TIPOS_CLIENTE_POR_DEFECTO` seguía siendo `["Cliente normal", "Revendedor", "Promoción"]`, y ese arreglo lo consumen **tres** lugares: el alta de empresa desde la API, el seed, y `backfill-catalogo-base.ts`. Es decir:

- toda empresa nueva nacía con un TipoCliente "Promoción" activo, recreando exactamente el problema de los dos significados — y esto es una plataforma multi-empresa cuyo valor es poder dar de alta más empresas;
- y una corrida del backfill —que existe justamente para reparar empresas a las que les falta el catálogo base— lo habría vuelto a crear **en la empresa de producción**, deshaciendo la migración sin que nadie se enterara.

Se quitó `"Promoción"` de la constante, con el por qué escrito ahí mismo para que nadie lo agregue de vuelta. Una línea arregla los tres consumidores, que era el punto de tener la constante compartida.

Es otra vez la misma forma de bug del proyecto: **la prueba de idempotencia pasó, y pasaba de verdad — pero nadie ejercitó "una empresa creada mañana".** La migración era correcta; lo que faltaba era apagar la fuente.

**Lo del aviso de precios inservibles: respuesta aceptada, y no hay que construirlo.** Al desactivar el TipoCliente, su columna y sus `Precio` desaparecen de la matriz en silencio, porque la API solo pide los tipos activos. No es un bug: esos precios quedan inalcanzables pero intactos, y el vendedor nunca puede seleccionar un tipo inactivo. El único efecto real es que si el cliente pregunta "¿dónde quedaron mis precios de promoción?", la interfaz no se lo puede contestar. Si lo pregunta, se le responde de palabra.

**Lo visual sigue sin verificarse, y esta vez fue culpa del prompt.** Las credenciales de desarrollo están documentadas desde la Entrega 8 en `GUIA-DE-PRUEBA.md` (`admin@dismanet.local`), pero el prompt solo mandaba a leer `CLAUDE.md`, `DISENO.md` y el PRD. **Todo prompt que pida verificación visual tiene que incluir `GUIA-DE-PRUEBA.md` en la lista de lectura.** Queda como regla del template, no como pendiente.

---

## Prompt F2.1 — Códigos para sorteos, celular opcional y tema claro

> **Estado:** entregado y aprobado con correcciones. Se conserva como referencia.

```
Lee CLAUDE.md, DISENO.md y PRD-MVP-Ventas.md antes de empezar.

Tres cambios independientes, sin relación entre sí. Ninguno toca la lógica de
venta ni los permisos.

## 1. Copiar los códigos de compra — para los sorteos

El cliente hace sorteos entre sus compradores y necesita la lista de códigos de
un periodo.

En la pantalla de ventas del ADMIN, un botón **"Copiar códigos"** que copia al
portapapeles los códigos de compra de las ventas **que estén pasando los filtros
activos** en ese momento — rango de fechas, vendedor, tipo, plataforma. Ese es
el punto: el cliente filtra el periodo del sorteo y copia esa lista, no todas
las ventas de la historia.

Reglas:
- Un código por línea, sin encabezados ni comas: va a pegarlo en una herramienta
  de sorteos.
- **Las ventas anuladas no entran.**
- Una venta de paquete aporta UN código, aunque haya entregado tres pantallas.
  El código identifica la compra, no la pantalla.
- Confirmación visible al copiar, con el número: "42 códigos copiados". No un
  aviso que desaparezca antes de que lo lea.
- Si el filtro no devuelve ninguna venta, el botón se deshabilita.

El endpoint debe devolver los códigos del conjunto filtrado completo, no solo
los de la página visible. Si el listado está paginado y el cliente copia desde
la página 1, tiene que llevarse los 300 códigos del mes, no los 20 de pantalla.

## 2. Celular del cliente final, opcional

Campo nuevo `celularCliente` en `Venta`, nullable. Migración aditiva.

- Input opcional en la pantalla de vender, **que no estorbe el flujo**: la venta
  se completa sin llenarlo y el botón VENDER nunca se bloquea por él.
- Validación suave: solo dígitos, espacios y el signo +, entre 7 y 15
  caracteres. Si no cumple, se avisa pero no se impide vender sin llenarlo.
- Disponible como marcador {{celular}} en las dos plantillas de mensaje.
  Si la venta no trae celular, el marcador se resuelve como vacío, nunca como
  "undefined" ni dejando el marcador literal en el texto que ve el cliente
  final.
- Visible en el listado de ventas y buscable, igual que el código de compra.
- Es copia histórica como todo lo demás (R3).

Nota: es el primer dato personal del comprador que guarda el sistema. No lo
expongas en ninguna respuesta dirigida a un VENDEDOR que no sea el autor de esa
venta.

## 3. Tema claro y oscuro, claro por defecto

Los tokens de ambos modos ya están definidos en la sección 2 de DISENO.md. Hoy
el sistema sigue la preferencia del sistema operativo, por eso se ve oscuro. El
cliente lo quiere **claro por defecto**.

- data-theme="light" como valor inicial cuando el usuario no ha elegido nada.
  La preferencia del sistema operativo deja de mandar.
- Selector de tema en el menú de usuario de la barra superior: Claro / Oscuro.
  Se guarda en localStorage y sobrevive a recargar.
- **Sin parpadeo al cargar.** Un script en línea en el <head>, antes de
  pintar, que lea la preferencia y ponga el atributo. Si el tema se aplica
  después de la primera pintura, el usuario ve un destello oscuro en cada carga
  y se ve roto.
- Envuelve el toggle en try/catch: localStorage puede fallar en ventana
  privada, y eso no puede tumbar la aplicación.

Recorre las nueve pantallas en modo claro y corrige lo que se vea mal: contraste
de texto secundario, bordes que desaparecen sobre blanco, estados de las
pastillas, y el gráfico del panel, cuyo color índigo se eligió para fondo claro
pero no se ha visto en él.

## 4. Verificación

- Las 295 pruebas pasan sin modificarse.
- tsc --noEmit limpio en ambas apps.
- Prueba del copiado: con filtros aplicados, el endpoint devuelve exactamente
  los códigos de ese conjunto, sin anuladas, sin paginar.
- Prueba del marcador con venta sin celular: el mensaje no contiene ni
  "undefined" ni el marcador literal.
- Recorre las nueve pantallas en claro y en oscuro, y reporta cuáles tocaste.
```

---

## Prompt F2.2 — Promociones

> **Estado:** listo para ejecutar.
> **Verificable al terminar:** el admin marca un paquete como promoción, aparece en una tercera pestaña de la pantalla de vender, se vende igual que un paquete, y el listado permite ver cuánto movieron las promociones.

```
Lee CLAUDE.md, DISENO.md y PRD-MVP-Ventas.md antes de empezar.

Antes de escribir código, lee también el modelo de Paquete, PaquetePlataforma,
PaqueteDuracionPlataforma y Precio, y la función que resuelve la composición de
un paquete al vender. Este bloque se apoya entero en eso.

## Lo que NO vamos a hacer, y por qué

No se crea una entidad `Promocion`. Una promoción es estructuralmente idéntica
a un paquete: un ítem con nombre que entrega varias pantallas, con su precio
propio en la matriz, que se entrega con la plantilla de PAQUETE. Crear una
entidad paralela significaría duplicar la resolución de composición —que está
en el camino del dinero— y agregarle una tercera clave foránea a `Precio`. No
lo hagas. Si durante el trabajo te parece que hace falta, para y dilo en vez de
construirlo.

`tipoVenta` tampoco gana un valor nuevo. Se queda en UNIDAD | PAQUETE.

## 1. Esquema

Dos campos. Los dos aditivos, con valor por defecto, en una sola migración.

- `Paquete.esPromocion Boolean @default(false)` — qué es hoy este ítem.
- `Venta.esPromocion Boolean @default(false)` — qué era al momento de vender.

El segundo no es redundante: **es copia inmutable (R3)**. Si el admin desmarca
la promoción el mes entrante, las ventas de este mes tienen que seguir contando
como promociones. Reportar leyendo la bandera del paquete rompería R3, igual
que leer el precio actual rompería el histórico.

Se escribe una sola vez, al crear la venta, desde el paquete que se está
vendiendo. Nunca se actualiza.

## 2. Panel del admin — marcar un paquete como promoción

En la pantalla de paquetes que ya existe:

- Un switch "Es promoción" en el panel de alta y de edición.
- Una pastilla "Promoción" en la fila de la tabla, para distinguirlas de un
  golpe. Fondo `--secundario-suave`, no rojo: no es un estado de peligro.
- Un filtro en la fila de filtros: Todos / Paquetes / Promociones.

No hay pantalla nueva. No hay segunda matriz de excepciones: una promoción usa
la misma matriz de excepciones de duración que cualquier paquete, porque es un
paquete.

## 3. Pantalla de vender — tercera pestaña

El selector de modo pasa de dos pestañas a tres: **Unidad · Paquete · Promoción**.

- La pestaña Promoción lista los paquetes con `esPromocion = true`; la pestaña
  Paquete lista los que la tienen en false. Un paquete aparece en una sola.
- **Un solo endpoint, una sola petición.** El endpoint de paquetes de la
  pantalla de vender devuelve el campo `esPromocion` y el frontend reparte en
  las dos pestañas. No agregues un endpoint de promociones.
- Lo demás del flujo es idéntico al de paquete: mismos selectores, misma
  tarjeta de resumen, mismo botón VENDER, misma plantilla de mensaje, misma
  asignación de pantallas. Si te encuentras escribiendo una segunda ruta de
  venta, te desviaste.
- Si no hay promociones activas con precio, la pestaña se muestra deshabilitada
  con el texto de por qué, no vacía y clicable.

En móvil tres pestañas no caben con el tamaño actual. Resuélvelo sin encoger
el texto por debajo de 14px: o se apilan, o se vuelven un selector segmentado
de ancho completo. Reporta qué elegiste.

## 4. El tipo de cliente "Promoción" queda obsoleto

Hoy existe un TipoCliente llamado "Promoción", que es como el cliente expresaba
los precios promocionales antes. Si queda activo, el vendedor va a ver
"Promoción" en dos lugares con dos significados distintos y va a equivocarse.

- **No lo borres.** Hay ventas históricas que lo referencian (R3).
- Desactívalo (`activo = false`) en una migración de datos, solo si existe.
- La migración tiene que ser idempotente y no fallar si no existe: la empresa
  del cliente lo tiene, una empresa nueva no.
- Los precios que cuelgan de ese tipo de cliente quedan inservibles pero no se
  borran. Si la pantalla de precios muestra un `Aviso` cuando hay precios
  inservibles, verifica que este caso lo dispare.

## 5. Listado y totales

- El listado de ventas del ADMIN gana la pastilla "Promoción" en las ventas que
  la llevan, y el filtro por tipo gana la opción.
- El filtro lee `Venta.esPromocion`, nunca el paquete relacionado.
- Los totales de hoy/semana/mes **no cambian de forma**. Si quieres mostrar
  cuánto movieron las promociones, es un dato aparte, no una segunda serie en
  el gráfico ni un segundo eje (DISENO.md §5).

## 6. Verificación

Lo de siempre más lo específico de este bloque:

- Las pruebas existentes pasan sin modificarse.
- `tsc --noEmit` limpio en ambas apps. **Limpio significa cero errores**,
  incluidos los de archivos de prueba y los que ya estuvieran antes. Si
  encuentras uno preexistente, arréglalo o explica por qué no se puede.
- **`app-compuesta.test.ts`**: toda ruta nueva o guarda tocada se agrega ahí,
  con el caso sin sesión además del autenticado. Si este bloque no agrega
  rutas, dilo explícitamente en el reporte en vez de dejarlo en silencio.
- Prueba de R3: vender una promoción, desmarcar `esPromocion` en el paquete, y
  verificar que la venta sigue marcada como promoción.
- Prueba de que la asignación de pantallas de una promoción de varios
  componentes sigue siendo todo-o-nada (R2): si a un componente le falta cupo,
  no queda ninguna pantalla tomada.
- Prueba de la migración de datos: corre dos veces sin fallar, y no falla en
  una base donde no existe el TipoCliente "Promoción".
- Recorre en claro y en oscuro lo que toques.

## 7. Entregable

Reporta:
- Qué elegiste para las tres pestañas en móvil.
- Si el `Aviso` de precios inservibles se dispara con los precios del tipo de
  cliente desactivado, o si no existe ese aviso.
- Cualquier lugar donde hayas tenido que bifurcar por promoción fuera del
  frontend. Idealmente son cero: toda la diferencia debería vivir en la
  interfaz y en una bandera.
```

---

## Qué falta definir para los bloques siguientes

| Bloque | Pendiente |
|---|---|
| 2 — Promociones | Entregado. Queda una pregunta que solo importa si el cliente la trae: si una promoción necesita **vigencia desde/hasta**, eso sí pide campos nuevos (~3 h sobre lo ya hecho, no las 16 h de la entidad aparte). |
| 3 — Saldo | **Bloquea el arranque del bloque.** ¿El saldo se expresa en pesos, o en una unidad propia? ¿Un revendedor ve su propio saldo y sus movimientos? ¿Quién puede cargar saldo: solo el ADMIN, o también el SUPER_ADMIN desde fuera? |
| 4 — Garantías | La especificación completa del cliente |
| Logo | El archivo, en SVG si es posible |
| Rediseño de ventas | Qué no le gusta de la pantalla actual |
| Sorteos | ¿Un código por compra (como quedó) o uno por pantalla entregada? |
