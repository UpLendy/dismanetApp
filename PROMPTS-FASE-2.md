# Prompts — Fase 2

Trabajo posterior al MVP. Mismas reglas: `CLAUDE.md` y `PRD-MVP-Ventas.md` siguen vigentes, un prompt por sesión, una rama y un PR por bloque.

---

## Orden y razón

| # | Bloque | Peso | Riesgo | Depende de | Estado |
|---|---|---|---|---|---|
| 1 | Códigos para sorteos · celular opcional · tema claro y oscuro | ~14 h | Bajo | Nada | **Entregado**, con dos correcciones |
| 2 | Promociones | ~6 h | Bajo | Bloque 1 | **Entregado**, con una corrección |
| 3 | Saldo de revendedores | ~14 h | Medio | Bloque 2 | **Entregado**, con un pendiente menor |
| 3.5 | Pulido antes de hacer merge a main | ~7 h | Bajo | Nada | **Listo para ejecutar** |
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

### Decisiones del cliente

Saldo **en pesos (COP)**, `Decimal(14,2)` igual que `precioVenta`. El revendedor **ve su propio saldo y sus movimientos**. **Solo el ADMIN de la empresa carga saldo** — el SUPER_ADMIN lo hace entrando a la empresa, como ya hace con todo lo demás, sin ruta propia.

### Saldo con bloqueo duro

El saldo baja solo al vender y la venta se rechaza si no alcanza. Eso lo convierte en **parte del camino del dinero**, con las mismas exigencias que la asignación de pantallas:

- La verificación y el descuento van **dentro de la transacción de venta**, con bloqueo de la fila del usuario. Dos ventas simultáneas del mismo revendedor no pueden gastar el mismo saldo.
- Toda variación del saldo deja un **movimiento registrado**: quién, cuánto, cuándo, por qué. El saldo guardado es el valor vigente; los movimientos son la historia. Nunca se edita un movimiento pasado.
- Anular una venta **devuelve el saldo con un movimiento nuevo**, no editando el original.

### El rol no cambia: el saldo es una bandera, no un rol nuevo

**Decisión revisada, y es la que le quita el riesgo a este bloque.** La versión anterior de este documento introducía un rol `EMPLEADO` y redefinía `VENDEDOR` como "revendedor con saldo". Eso obligaba a una migración que convirtiera a todos los `VENDEDOR` de producción en el mismo despliegue, y si fallaba **el cliente se quedaba sin poder vender**. Era el punto más delicado de toda la fase 2.

Pero el cliente dijo que lo único que distingue a un empleado de un revendedor es el saldo. Si eso es cierto, el rol no tiene nada que hacer aquí: `Usuario` suma `usaSaldo Boolean @default(false)`.

Con eso, **el despliegue no cambia el comportamiento de nadie.** Todos los usuarios de producción siguen siendo `VENDEDOR` con `usaSaldo = false`, que es exactamente lo que son hoy: empleados que venden sin tope. El cliente marca después, con calma y de uno en uno, quiénes son revendedores. No hay migración de datos que pueda dejar a nadie sin vender, porque no hay migración de datos.

Es el mismo movimiento que funcionó en el bloque 2: una bandera en vez de una clase nueva. Y el enum `Rol` no se toca. Si algún día empleado y revendedor difieren en **permisos** —no en saldo— ahí sí se justifica un rol.

**Sin copia en `Venta`.** A diferencia de `esPromocion`, acá no hace falta: el movimiento de consumo apunta a la venta, así que "qué ventas gastaron saldo" se responde por el ledger, que es inmutable por construcción y mejor dato que una bandera copiada.

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

### F2.3 — Saldo de revendedores · **aprobada, con un pendiente menor**

Revisado el 8 de octubre. Es la entrega mejor hecha del proyecto, y lo digo habiendo buscado específicamente dónde iba a estar roto.

**Lo que más me preocupaba resultó correcto, y por la razón correcta.** El escenario que no estaba en el prompt y que rompe este tipo de implementación: un revendedor vende, el ADMIN lo pasa a empleado (`usaSaldo = false`), y después se anula esa venta. Si la devolución se decidiera leyendo `usuario.usaSaldo`, el revendedor perdería ese dinero en silencio — y el cuadre del ledger **no lo detectaría**, porque el saldo y la suma de movimientos seguirían coincidiendo. Dinero perdido sin rastro.

La implementación decide con `movimientoSaldo.findFirst({ ventaId, tipo: "CONSUMO" })`: el hecho histórico, no la bandera vigente. Devuelve bien. Y el caso inverso —empleado que pasa a revendedor y se le anula una venta vieja que nunca cobró saldo— tampoco inventa un crédito, porque no hay CONSUMO que encontrar. Las dos direcciones correctas.

Verificado contra el código:

| Qué | Resultado |
|---|---|
| Orden de bloqueos | Correcto. `bloquearUsuarioParaVenta` en la línea 219 de `lib/ventas.ts`, `tomarPantallasDisponibles` en la 248. |
| El bloqueo del usuario **sin** `SKIP LOCKED` | Correcto, y con el por qué escrito en el archivo para que nadie lo "optimice" después. |
| SQL crudo en la lista blanca | Correcto. `src/lib/bloqueo-usuario.ts` está en `LISTA_BLANCA_RAW_SQL`. |
| El `WHERE` lleva `id` **Y** `empresaId` | Correcto, con la nota de que `Usuario` es el único modelo con `empresaId` nullable. |
| `@@unique([empresaId, ventaId, tipo])` | Presente. Y `ventaId` nullable no estorba: en Postgres los NULL son distintos entre sí, así que no limita las cargas ni los ajustes. |
| Doble anulación | Bloqueada por dos vías: relectura tras el lock, y la restricción única como respaldo con `restriccionViolada()`. |
| Rutas de saldo en `app-compuesta.test.ts` | Correcto, con los 403 del VENDEDOR sobre las rutas de administración de saldo. |
| `DISENO.md` actualizado antes de usar el componente nuevo | Correcto, sin que el prompt lo pidiera. Agregó `Interruptor` y afinó `Dialogo` para separar "destructiva" de "irreversible pero no destructiva" — cargar saldo va en `principal`, no en rojo. Es exactamente la regla de la §2. |

**El SUPER_ADMIN vendiendo dentro de una empresa** no toma bloqueo de usuario (su fila tiene `empresaId` nulo, así que el lock devuelve null). Revisado: no reintroduce riesgo de deadlock, porque una transacción que no sostiene ninguna fila de `Usuario` no puede cerrar un ciclo con otra que sí.

**Pendiente menor, pero es el único que puede dejar a alguien sin vender.** El interruptor "Vende contra saldo" se aplica de inmediato y sin aviso. Si el ADMIN lo activa sobre un vendedor que está trabajando, con saldo en cero, **esa persona queda sin poder vender en ese instante y nada en pantalla se lo dice al ADMIN.** Es reversible y no corrompe datos, así que no bloquea nada — pero el objetivo declarado de este bloque era que nadie se quedara sin vender, y este es el último camino que queda abierto hacia eso.

Arreglo: al activar sobre un usuario con saldo en cero, confirmar con `Dialogo` en variante `principal` diciéndolo con esas palabras. Va de primero en el próximo bloque.

**Nota sobre la verificación visual.** Esta vez se hizo de verdad, y el agente encontró su propio error en el camino: `colorScheme: "dark"` de Playwright no hace nada en esta app, porque el tema se lee solo de `localStorage` antes del primer render. Lo detectó al notar que las capturas "oscuras" se veían idénticas a las claras, y lo corrigió con `addInitScript`. Eso es exactamente lo que no pasó en F2.1 y F2.2. Queda una limitación: Playwright se usó fuera del repositorio, así que las capturas no son reproducibles. No lo convertimos en infraestructura todavía — cuando llegue el rediseño de ventas, que es trabajo puramente visual, ahí se evalúa.

### Higiene de ramas — F2.1 y F2.2 quedaron en un solo commit

`0cf7b1f` en `feat/promociones` trae los dos bloques: el tema claro, el celular y los códigos de F2.1 viajan bajo el mensaje "feat: promociones", con tres migraciones en un commit. No se perdió nada y todo va al mismo PR, pero F2.1 ya no se puede revertir sin revertir promociones.

Lo que importa de aquí en adelante: **F2.3 no se commitea sobre `feat/promociones`.** Es el bloque que toca el dinero; tiene que poder revisarse y revertirse solo.

### F2.4 — Pulido · **aprobada con un pendiente**

Revisado el 9 de octubre. Ocho arreglos, no siete: el reporte se contó de menos. El más importante —`PERFIL`/`PIN` en blanco en las ventas de unidad, el único que veía el comprador final— **quedó cerrado bien**: `renderizarMensajeUnidad` recibe `usaPerfilPin` y quita la línea completa con `quitarBloquesPerfilPin`, con la prueba espejo de la de paquetes, en los dos sentidos.

Dos hallazgos propios de esa pasada, los dos reales y bien resueltos:

- **El aviso de "plantilla no configurada" se descartaba en silencio.** El API lo devolvía en una venta exitosa y la pantalla nunca leía `data.aviso`. Es exactamente la clase del hallazgo 8 —servidor correcto, pantalla muda— encontrada por iniciativa propia.
- **Infraestructura de pruebas en `apps/web`**, con cuatro pruebas que montan la pantalla de vender real, fuerzan cada error del servidor y verifican que el texto sigue visible *después* del refresco posterior. Eso convierte la regla del hallazgo 8 en algo que la suite vigila, que era el punto.

### ⚠️ Pendiente — `--secundario-suave` quedó claro en modo oscuro

El valor oscuro elegido fue `#E4E2FA`. El claro es `#EEF2FF`. Es el mismo lavanda casi blanco: no se eligió un valor oscuro, se movió un pelo.

Comparar con el que sí se hizo bien: `--primario-suave` pasó de `#FEF3F2` a `#3A1412`.

El reporte justifica el valor con "5.0:1 contra `--secundario`", y el dato es cierto pero mide lo que no era el problema. La queja nunca fue la legibilidad del texto sobre el chip: es que **un bloque casi blanco sobre una página `#0D0D0D` es un parche que grita**, igual que el ítem activo de la barra lateral que originó el hallazgo 5. `DISENO.md` §7: el modo oscuro es un conjunto de valores elegidos, no una inversión automática.

**El alcance es mayor de lo que parece.** No son solo las celdas de excepción:

| Dónde | Qué se ve mal en oscuro |
|---|---|
| `components/ui/aviso.tsx` | **Todo `Aviso` variante info** |
| `components/ui/pastilla.tsx` | La pastilla secundaria, incluida "Promoción" |
| `components/ui/tarjeta-acceso.tsx` | Las tarjetas de acceso directo del panel |
| `navegacion/selector-empresa.tsx` | La pastilla de empresa del SUPER_ADMIN |
| `panel/precios` · `panel/catalogo/paquetes` · `panel/mensajes` | Celdas modificadas, excepciones, filtro de promociones, marcadores |

Es el mobiliario visual del panel, no un caso de esquina.

**Y el síntoma se parchó en el componente, no en el token.** El hallazgo 1 de esa pasada —el select ilegible en las celdas de excepción— se arregló quitándole `bg-transparent` al select, o sea tapando la celda clara con una superficie opaca. La celda sigue clara debajo, y todo lo demás de la tabla de arriba también.

**Por qué se esquivó, que es lo interesante:** el par de marca rojo tiene *dos* tokens, `--primario-suave` y `--primario-texto`, así que oscurecer el fondo y aclarar el texto fue directo. El par índigo solo tiene `--secundario`, que hace de color de gráfico **y** de texto sobre el chip. Con un fondo índigo oscuro, `#4F46E5` como texto tampoco contrasta. La asimetría del sistema de tokens es la que empujó al parche.

El arreglo es cerrar esa asimetría: un `--secundario-texto` nuevo, declarado en `DISENO.md` §2 con sus dos valores, y `--secundario-suave` con un índigo oscuro de verdad. Media hora, y cierra el hallazgo 5 completo en vez de a medias.

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

## Prompt F2.3 — Saldo de revendedores

> **Estado:** listo para ejecutar.
> **Verificable al terminar:** el ADMIN marca a un vendedor como revendedor y le carga $100.000; ese revendedor vende hasta agotarlo y la siguiente venta se rechaza diciendo cuánto falta; al anular una venta le vuelve el saldo; y el ADMIN ve el historial de cada carga y cada consumo.

```
Lee CLAUDE.md, DISENO.md, PRD-MVP-Ventas.md y GUIA-DE-PRUEBA.md antes de empezar.

Antes de escribir código, lee la función de venta completa en lib/ventas.ts,
en particular la transacción y el bloqueo de pantallas con FOR UPDATE SKIP
LOCKED, y el handler de anulación. Este bloque mete dinero dentro de esa misma
transacción, y es el trabajo de más riesgo de la fase 2. Si algo de lo que
sigue no te cuadra con lo que ves en el código, para y dilo antes de construir.

## Lo que NO vamos a hacer, y por qué

**No se toca el enum `Rol`.** No se agrega EMPLEADO. No se redefine VENDEDOR.

Lo único que distingue a un empleado de un revendedor es el saldo, así que es
una bandera, no un rol: `Usuario.usaSaldo`, con default false. Así el
despliegue no cambia el comportamiento de ningún usuario que ya exista —
siguen siendo vendedores sin tope, que es lo que son hoy— y el cliente marca
después quiénes son revendedores. Si en cambio migráramos roles, un error
dejaría a los empleados del cliente sin poder vender el mismo día del
despliegue.

Tampoco se copia nada a `Venta`. El movimiento de consumo apunta a la venta;
eso ya responde "qué ventas gastaron saldo", y es inmutable por construcción.

## 1. Esquema

En `Usuario`, dos campos aditivos con default:

- `usaSaldo Boolean @default(false)` — si este usuario vende contra saldo.
- `saldo Decimal @db.Decimal(14,2) @default(0)` — pesos. El valor vigente.

Y un modelo nuevo, con `empresaId` como todos (R1):

    MovimientoSaldo
      id, empresaId, usuarioId,
      tipo (CARGA | CONSUMO | DEVOLUCION | AJUSTE),
      monto      Decimal(14,2)   -- positivo suma, negativo resta
      saldoResultante Decimal(14,2)  -- el saldo que quedó tras este movimiento
      ventaId?   -- presente en CONSUMO y DEVOLUCION, nulo en CARGA y AJUSTE
      nota?      -- obligatoria en AJUSTE
      creadoPorId, createdAt

`saldoResultante` es redundante a propósito: es lo que permite auditar el
ledger sin recalcular toda la historia, y es lo que hace evidente un descuadre.

**Restricción única: `(empresaId, ventaId, tipo)`.** Es lo que hace
estructuralmente imposible cobrar dos veces la misma venta o devolverle el
saldo dos veces. Manéjala con `restriccionViolada()` además de validar antes
(CLAUDE.md): validar y luego insertar es una condición de carrera.

El saldo guardado es el valor vigente; los movimientos son la historia. Un
movimiento pasado NUNCA se edita ni se borra. Un error se corrige con un
AJUSTE nuevo.

## 2. El orden de los bloqueos — lo más importante de este bloque

La transacción de venta ya toma bloqueos: pantallas, con FOR UPDATE SKIP
LOCKED, recorriendo plataformas ordenadas por plataformaId ascendente (R2).
Ahora va a tomar un segundo tipo de bloqueo: la fila del usuario. **Dos tipos
de bloqueo en una transacción sin un orden global fijo es un deadlock
esperando a pasar.**

Orden obligatorio, siempre el mismo:

1. **Primero** la fila del usuario, con `SELECT ... FOR UPDATE` — **sin SKIP
   LOCKED**, que espere.
2. Leer el saldo y comparar contra el precio de venta.
3. Si no alcanza, abortar con 409 antes de tocar inventario.
4. **Después** las pantallas, con SKIP LOCKED y en orden de plataformaId, tal
   como está hoy.
5. Insertar la venta, insertar el movimiento de CONSUMO, actualizar el saldo.

Por qué el usuario va primero: es la fila más específica —una por vendedor— así
que dos ventas simultáneas del mismo revendedor se serializan ahí, que es
justo lo que queremos, y dos ventas de revendedores distintos nunca compiten
por ella.

**Por qué el bloqueo del usuario NO lleva SKIP LOCKED:** con SKIP LOCKED, dos
ventas simultáneas del mismo revendedor se saltarían la fila bloqueada y las
dos leerían el saldo viejo. Las dos pasarían la verificación y el revendedor
gastaría de más. Es exactamente el bug que este bloque existe para evitar, y
se escribe igual que la versión correcta salvo dos palabras.

Ese `SELECT ... FOR UPDATE` es SQL crudo: va en la lista blanca de archivos,
parametrizado, y **su WHERE lleva `id` Y `empresaId`** — `Usuario` es el único
modelo donde `empresaId` puede ser NULL (el SUPER_ADMIN), así que un WHERE solo
por id es una fuga entre empresas esperando a pasar.

## 3. El rechazo

Si el saldo no alcanza, 409 con un mensaje que sirva: cuánto cuesta, cuánto
tiene, cuánto le falta. "Saldo insuficiente" a secas obliga al revendedor a
escribirle al admin para enterarse de lo que el sistema ya sabe.

Un usuario con `usaSaldo = false` no pasa por nada de esto: ni se bloquea su
fila, ni se verifica, ni se registra movimiento. Su camino de venta debe
quedar byte por byte igual al de hoy.

Precio cero con saldo cero: se permite. No hay nada que cobrar.

## 4. Anulación

Anular una venta que consumió saldo inserta un movimiento de DEVOLUCION y
suma el saldo. Nunca edita el movimiento de CONSUMO.

- El monto devuelto sale **del movimiento de CONSUMO original**, no del precio
  actual de nada.
- Anular una venta de un usuario sin saldo no genera movimiento. No inventes
  un crédito donde nunca hubo un cobro.
- **Anular dos veces no puede devolver dos veces.** La restricción única
  `(empresaId, ventaId, tipo)` lo bloquea en la base; aun así, pruébalo
  explícitamente. Antes, una doble anulación era un no-op; ahora sería dinero
  regalado.
- La devolución va dentro de la misma transacción que libera las pantallas, y
  con el mismo bloqueo de la fila del usuario.

## 5. Pantallas

**ADMIN — en la pantalla de usuarios que ya existe:**
- Switch "Vende contra saldo" en el panel de alta y edición.
- Columna de saldo en la tabla, solo para los que usan saldo.
- Acción "Cargar saldo": monto y nota opcional, con diálogo de confirmación
  que nombre el monto y a quién. Es dinero.
- Detalle del usuario con su historial de movimientos: fecha, tipo, monto,
  saldo resultante, quién lo hizo, y enlace a la venta cuando aplique.
- Un AJUSTE se puede registrar, exige nota, y queda en el historial como
  cualquier otro movimiento.

**REVENDEDOR — ve su propio saldo y sus propios movimientos:**
- Su saldo visible en la barra superior, siempre, y en la pantalla de vender
  antes de confirmar. Que se entere de que no alcanza antes de armar la venta,
  no al apretar VENDER.
- Su historial de movimientos, solo el suyo.
- Esto no choca con R4: es su propio saldo, no cifras financieras de la
  empresa. Sigue sin ver costo, utilidad ni margen, ni los movimientos de
  nadie más.

Un empleado (`usaSaldo = false`) no ve nada de saldo en ninguna parte. Ni en
cero, ni deshabilitado: no existe para él.

## 6. Verificación

Esto es el camino del dinero. Las pruebas son el entregable, no un anexo.

- Las pruebas existentes pasan sin modificarse. `tsc --noEmit` limpio en ambas
  apps — **cero errores, incluidos los de archivos de prueba.**
- `app-compuesta.test.ts`: toda ruta nueva, con el caso sin sesión además del
  autenticado. Un revendedor pidiendo el saldo o los movimientos de otro
  usuario recibe 403, y un empleado no alcanza las rutas de saldo.
- **Concurrencia:** dos ventas simultáneas del mismo revendedor con saldo para
  una sola. Una pasa, la otra se rechaza, el saldo final es correcto y hay
  exactamente un movimiento de CONSUMO. Esta prueba es la razón de ser del
  bloque; si no la puedes escribir de forma confiable, dilo en vez de
  reemplazarla por una secuencial.
- **Deadlock:** una venta de paquete de varias plataformas de un revendedor,
  concurrente con otra del mismo revendedor que comparte plataformas. Ninguna
  debe morir por deadlock.
- **Doble anulación** no devuelve dos veces.
- **Rollback:** si la asignación de pantallas falla por inventario (R2,
  todo-o-nada), el saldo queda intacto y no hay movimiento huérfano.
- **Cuadre del ledger:** para cada usuario con saldo, `saldo` es igual a la
  suma de los montos de sus movimientos, y el `saldoResultante` del último
  movimiento coincide con el saldo guardado. Esta prueba es la red que detecta
  un descuadre antes que el cliente.
- **No regresión del empleado:** un `usaSaldo = false` vende igual que antes y
  no genera ningún movimiento.
- Recorre en claro y en oscuro lo que toques (credenciales en
  GUIA-DE-PRUEBA.md, no las pidas por chat).

## 7. Entregable

Reporta:
- El orden de bloqueos tal como quedó en el código, citando las líneas.
- Si la prueba de concurrencia la pudiste escribir de verdad, y cómo fuerzas
  el solapamiento.
- Si el cuadre del ledger lo expusiste además como verificación en el
  diagnóstico de empresa, o solo como prueba.
- Cualquier lugar donde el camino de venta de un empleado haya cambiado.
  Idealmente son cero.
```

---

## Revisión en vivo antes del merge — 8 de octubre

Primera vez que alguien abre la aplicación corriendo y la mira, en vez de auditar el código. Recorrido como ADMIN sobre el servidor de desarrollo: login, panel, usuarios, vender, ventas, en claro y en oscuro.

**Lo que funciona y se ve bien:** el tema claro por defecto, el selector Claro/Oscuro del menú de usuario, el ítem activo de la barra lateral con el rojo pastel que pidió el cliente, las tres pestañas Unidad · Paquete · Promoción, el botón "Copiar códigos", los filtros de Promoción y de Celular, el aviso de costos en cero en el panel, el saldo del revendedor en la tabla de usuarios con "Cargar saldo" y "Historial", y la regla de una sola acción sólida por pantalla respetada en todas.

Siete hallazgos. El primero ya quedó arreglado.

### 1 — Desajuste de hidratación en cada carga · **arreglado**

El script en línea del tema pone `data-theme` en `<html>` antes de que React hidrate, así que el HTML del servidor nunca coincide con el del cliente. React lo reportaba en consola en **todas** las páginas, con el aviso de que "no lo va a parchar".

Se ve bien en pantalla, pasa todas las pruebas y ninguna auditoría de código lo encuentra: solo aparece abriendo la aplicación y leyendo la consola. Arreglado con `suppressHydrationWarning` en `<html>`, que es el patrón estándar para este caso.

### 2 — La pantalla de login está fuera del sistema de diseño

`apps/web/app/login/page.tsx` usa clases crudas de Tailwind: `bg-neutral-900` para el botón, `bg-red-50` y `text-red-700` para el error. Cero tokens.

Es la primera pantalla que ve el cliente y la única que no está en su marca: el botón principal sale **negro** en vez del rojo `--primario`. Y como es anterior al sistema de diseño, se quedó fuera por una razón concreta — la auditoría de F2.1 se limitó a `app/(protegido)`, y el login no está ahí.

### 3 — `/vender` abre sin ningún modo seleccionado

El vendedor entra y ve tres pestañas, ningún formulario y un botón VENDER muerto. Tiene que adivinar que debe hacer clic en "Unidad" para que aparezca algo.

Es un clic de más en cada venta, en la pantalla que `DISENO.md` define como "una sola pantalla, muchas veces al día, con prisa". Antes de F2.2 eran dos pestañas; al pasar a tres se perdió la selección por defecto.

### 4 — La pestaña "Promoción" está habilitada sin haber promociones

El prompt F2.2 lo pedía explícitamente: *"Si no hay promociones activas con precio, la pestaña se muestra deshabilitada con el texto de por qué, no vacía y clicable."* Quedó clicable. El vendedor elige tipo de cliente y duración para después descubrir que la lista de productos está vacía, sin explicación.

### 5 — En oscuro, los fondos de marca se quedan en claro

El ítem activo de la barra lateral es un bloque casi blanco sobre la barra negra. La causa no es un error de implementación sino un hueco del sistema de diseño: en `DISENO.md` §2, la tabla de "Superficies e ink" tiene columnas Claro y Oscuro, pero la tabla de "Color de marca" tiene **un solo valor**. `--primario-suave`, `--primario-texto` y `--secundario-suave` nunca tuvieron versión oscura.

Afecta a todo lo que usa esos tokens: el ítem activo del menú, la pestaña activa de vender, la pastilla "Promoción" y las celdas de excepción de la matriz de paquetes. Se arregla en `DISENO.md` primero y en `globals.css` después.

### 6 — La tabla de usuarios se desborda y la fila pierde su nombre

Con las columnas de saldo, a 1024px de ancho hay que desplazar la tabla a la derecha para alcanzar "Cargar saldo" — y al hacerlo desaparecen Nombre y Correo. Se termina cargando dinero a una fila sin ver de quién es.

La pantalla de precios ya resolvió esto con cabeceras fijas al hacer scroll; acá aplica lo mismo a la columna de nombre.

### 7 — La utilidad inflada se muestra en verde

En `/ventas`, los totales y la columna de utilidad van en `--bien` (verde). Hoy el costo es cero en todo, así que la utilidad es igual al ingreso: el cliente ve "$76.900" en verde de ganancia cuando en realidad el sistema no sabe cuánto ganó.

Dos cosas distintas, las dos ciertas: `DISENO.md` §2 dice que los colores de estado son reservados y no decorativos, y una cifra que no es real no debería ir pintada como buena noticia. El panel ya trae el aviso de costos en cero; `/ventas` no.

### 8 — Toda venta que falla, falla en silencio · **arreglado**

Encontrado por Felipe probando la vista del revendedor: al no alcanzar el saldo, la venta no se ejecuta y la pantalla no dice nada.

El backend está bien — devuelve 409 con el costo, el saldo y el faltante, y está probado. El frontend también pone el mensaje. Y acto seguido lo borra:

```
setError(mensajeDeError(errorRespuesta));   // mensaje del 409
await cargarOpciones();                     // y esto hace setError(null)
```

`cargarOpciones()` se agregó para refrescar los cupos tras un fallo —por si alguien agotó el inventario entre que se cargó la lista y el clic— y empieza limpiando el error. El mensaje se pone y se borra en el mismo tick.

**No es solo el saldo: se traga todos los errores del camino de venta**, incluido inventario insuficiente. El saldo fue lo que lo hizo visible porque es el error más fácil de provocar a propósito.

Arreglado moviendo el `setError(null)` de `cargarOpciones` al efecto que corre al cambiar de selección. Limpiar el error es consecuencia de que el usuario cambió algo, no de que refrescamos una lista.

**La lección, que es la sexta vez que aparece con la misma forma.** Las 318 pruebas pasan, el 409 está bien construido y bien probado, y el bug estaba ahí igual: ninguna prueba verifica que el mensaje *llegue a la pantalla*. Está probado que el servidor lo devuelve y está probado que el componente lo pinta — nadie probó el camino completo. Queda como regla en la definición de terminado.

### 9 — Las ventas de unidad mandan PERFIL y PIN en blanco · **en producción desde el lanzamiento**

Apareció en el mensaje de ejemplo del reporte de garantías, y **no lo causó garantías**: estaba desde el primer día.

`renderizarMensajePaquete` sabe omitir las líneas de PERFIL y PIN cuando la plataforma no usa perfiles — hay una prueba que lo verifica con Spotify. `renderizarMensajeUnidad` **no tiene ese concepto**: sustituye `{{perfil}}` y `{{pin}}` por cadena vacía y deja las etiquetas puestas.

Resultado: cada venta suelta de Spotify, Canva o YouTube le llega al comprador así:

```
*PERFIL:*

*PIN:*

*CORREO:*
...
```

Dos etiquetas vacías en el mensaje que el cliente reenvía a su comprador. Lleva en producción desde el lanzamiento.

**Es la misma forma de siempre:** el camino probado está bien, el camino gemelo que nadie probó está mal. La prueba de omisión existe para paquetes y no existe para unidades.

El arreglo no es sustituir por vacío: hay que **quitar la línea entera** de la plantilla cuando la plataforma no usa perfiles, porque la plantilla es texto que el admin edita.

---

## Prompt F2.4 — Pulido antes del merge

> **Estado:** listo para ejecutar.
> **Verificable al terminar:** el cliente entra, ve su marca desde el login, vende sin un clic de más, y nada se ve roto en oscuro.

```
Lee CLAUDE.md, DISENO.md, PRD-MVP-Ventas.md y GUIA-DE-PRUEBA.md antes de
empezar. Las credenciales de desarrollo están en GUIA-DE-PRUEBA.md: úsalas,
no las pidas.

Siete arreglos chicos e independientes, encontrados abriendo la aplicación.
Ninguno toca la lógica de venta, los permisos ni el saldo. El hallazgo 1 de la
lista original (desajuste de hidratación) ya está arreglado — no lo busques.

## 1. Aviso al activar "Vende contra saldo" con saldo en cero

Viene de F2.3 y es el único que puede dejar a alguien sin vender. Hoy el
interruptor se aplica de inmediato y sin aviso: si el ADMIN lo activa sobre
alguien que está trabajando, esa persona queda sin poder vender en ese
instante y nada se lo dice.

Al ACTIVAR sobre un usuario con saldo en cero, confirmar con `Dialogo` en
variante `principal` —no `destructivo`, no es destructivo— diciéndolo con
esas palabras: que esa persona no va a poder vender hasta que se le cargue
saldo. Desactivar no necesita confirmación: devuelve a la gente su capacidad
de vender, no se la quita.

## 2. La pantalla de login, al sistema de diseño

`apps/web/app/login/page.tsx` usa clases crudas: `bg-neutral-900`,
`bg-red-50`, `text-red-700`. Es la primera pantalla que ve el cliente y la
única fuera de su marca.

- Botón "Ingresar" con el componente `Boton` en variante `principal`.
- El bloque de error con el componente `Aviso` en variante `critico`.
- Que responda al tema, igual que el resto.
- Cero hex y cero colores de Tailwind: solo tokens.

Después de este arreglo, **ninguna pantalla de la aplicación debe tener
colores quemados.** La auditoría de F2.1 se limitó a `app/(protegido)` y por
eso el login se escapó. Repítela sobre `apps/web` completa y reporta si queda
algo.

## 3. `/vender` abre en modo UNIDAD

Hoy abre sin ningún modo seleccionado: tres pestañas, ningún formulario y un
botón muerto. UNIDAD queda seleccionado al cargar, como estaba antes de que
la tercera pestaña entrara.

## 4. La pestaña "Promoción" deshabilitada si no hay promociones

Lo pedía F2.2 y quedó pendiente. Si no hay promociones activas con precio, la
pestaña va deshabilitada y con el texto de por qué — no clicable hacia un
formulario que no puede completarse. Misma regla si algún día no hay paquetes.

## 5. Valores oscuros para los tokens de marca

`DISENO.md` §2: la tabla de "Superficies e ink" tiene columnas Claro y Oscuro,
pero la de "Color de marca" tiene un solo valor. `--primario-suave`,
`--primario-texto` y `--secundario-suave` nunca tuvieron versión oscura, y por
eso el ítem activo del menú es un bloque casi blanco sobre la barra negra.

- **Primero `DISENO.md`**, agregando la columna Oscuro a la tabla de marca,
  con valores elegidos —no invertidos— que cumplan 4.5:1 para el texto sobre
  su fondo. El modo oscuro es un conjunto de valores elegidos (§7).
- Después `globals.css`, bajo los mismos selectores que ya usan los otros
  tokens oscuros.
- Revisa en oscuro todo lo que consume esos tokens: ítem activo del menú,
  pestaña activa de vender, pastilla "Promoción", y las celdas de excepción
  de la matriz de paquetes.

## 6. La columna de nombre fija en la tabla de usuarios

Con las columnas de saldo, a 1024px hay que desplazar la tabla para alcanzar
"Cargar saldo", y al hacerlo desaparecen Nombre y Correo: se carga dinero a
una fila sin ver de quién es.

Columna de nombre fija al hacer scroll horizontal, como ya hace la matriz de
precios con sus cabeceras. Si resulta que la tabla cabe holgada quitando algo,
esa también es una solución válida — pero el nombre tiene que estar visible
en el momento de cargar saldo.

## 7. La utilidad deja de ir en verde mientras el costo sea cero

En `/ventas`, los totales y la columna de utilidad van en `--bien`. Con todos
los costos en cero, la utilidad es igual al ingreso: el cliente ve una cifra
en verde de ganancia que el sistema no sabe si es real.

- La utilidad va en `--ink`, como cualquier otra cifra. El verde es un color
  de estado y está reservado (§2).
- `/ventas` muestra el mismo `Aviso` de costos en cero que ya existe en el
  panel, con la misma redacción, cuando haya precios sin costo.

## 8. PERFIL y PIN en blanco en las ventas de unidad

El más viejo de todos y el único que ve el comprador final. Lleva en
producción desde el lanzamiento.

`renderizarMensajePaquete` omite las líneas de PERFIL y PIN cuando la
plataforma no usa perfiles — `bloqueListaCuentas` lo hace con `usaPerfilPin`, y
hay una prueba con Spotify que lo verifica. `renderizarMensajeUnidad` no:
sustituye los marcadores por cadena vacía y deja las etiquetas puestas.

Cada venta suelta de una plataforma sin perfiles (Spotify, Canva, YouTube) le
llega al comprador con `*PERFIL:*` y `*PIN:*` vacíos.

- `renderizarMensajeUnidad` recibe `usaPerfilPin` y, cuando es false, **quita
  la línea completa** de la plantilla que contiene `{{perfil}}` o `{{pin}}`.
  No basta con sustituir por vacío: la etiqueta vive en el texto de la
  plantilla, que el admin edita.
- Si los dos marcadores comparten una línea, se quita esa línea una sola vez.
- Actualiza los dos llamadores: `lib/ventas.ts` y `lib/garantias.ts`.
- **Prueba espejo de la que ya existe para paquetes**: una venta de unidad de
  una plataforma sin perfiles no contiene "PERFIL" ni "PIN" en el mensaje; una
  con perfiles sí, y con sus valores.

## 9. Verificación

- Las pruebas existentes pasan sin modificarse. `tsc --noEmit` limpio en ambas
  apps, cero errores incluidos los de archivos de prueba.
- **Abre la aplicación y léela con la consola abierta.** Cero errores y cero
  advertencias de React en login, panel, vender, ventas, usuarios y perfil.
  Esta entrega existe porque nadie había hecho eso todavía.
- **Pruebas de que el error llega a la pantalla, no solo de que el servidor lo
  devuelve.** Para cada error del camino de venta —saldo insuficiente,
  inventario insuficiente, plantilla no configurada— una prueba que haga
  fallar la venta y verifique que el texto queda visible después de que
  terminen los refrescos posteriores. Probar el 409 por un lado y el
  componente por el otro no cubre el hueco entre los dos: ahí vivía el
  hallazgo 8.
- Recorre las pantallas en claro y en oscuro, incluido el login.
- Si tomas capturas con Playwright, el tema se fija con
  `addInitScript(() => localStorage.setItem("tema", "dark"))`. La opción
  `colorScheme` de Playwright no hace nada en esta aplicación.

## 10. Entregable

Reporta qué encontró la auditoría de colores quemados sobre `apps/web`
completa, y qué valores oscuros elegiste para los tokens de marca con su
razón de contraste.
```

---

## Qué falta definir para los bloques siguientes

| Bloque | Pendiente |
|---|---|
| 2 — Promociones | Entregado. Queda una pregunta que solo importa si el cliente la trae: si una promoción necesita **vigencia desde/hasta**, eso sí pide campos nuevos (~3 h sobre lo ya hecho, no las 16 h de la entidad aparte). |
| 3 — Saldo | Resuelto: pesos, el revendedor ve lo suyo, solo el ADMIN carga. Nada bloqueante. |
| 4 — Garantías | La especificación completa del cliente |
| Logo | El archivo, en SVG si es posible |
| Rediseño de ventas | Qué no le gusta de la pantalla actual |
| Sorteos | ¿Un código por compra (como quedó) o uno por pantalla entregada? |
