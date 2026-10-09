# Prompts — Fase 3

Dos cambios que pidió el cliente después de probar. Mismas reglas: `CLAUDE.md` y `PRD-MVP-Ventas.md` siguen vigentes, un prompt por sesión.

| # | Bloque | Peso | Riesgo | Orden |
|---|---|---|---|---|
| F3.1 | Rol EMPLEADO | ~14 h | **Alto** — toca roles en producción | **Entregado**, sin pendientes |
| F3.2 | Perfiles, pines y capacidad por plataforma | ~12 h | Medio | Después |
| — | Rediseño de ventas · logos | — | — | Al final |

**Por qué F3.1 primero y solo:** es el único que puede dejar a alguien sin trabajar, y F3.2 cambia la pantalla de cuentas, que es justo donde F3.1 reparte permisos nuevos. Que F3.1 se despliegue y se vea funcionando antes de tocar nada más.

---

## Decisiones del cliente

| Pregunta | Respuesta |
|---|---|
| ¿Editar la plantilla de una plataforma afecta cuentas ya creadas? | **No. Solo aplica a cuentas nuevas.** |
| ¿El revendedor sigue viendo garantías y pantallas vendidas? | **No. Pasa a ser solo de empleados.** |
| ¿Hasta dónde llega el empleado sobre el inventario? | **Solo crear cuentas.** |

> Sobre la última: es literal lo que pidió. El roce esperable es el día que a una cuenta le cambien la contraseña — el empleado va a tener que pedirle al ADMIN que la actualice, porque editar no puede. Si eso molesta en la práctica, ampliar a "crear y editar" es media hora. Vale decírselo al cliente de una vez en vez de esperar la queja.

---

## Dos cosas del código que hacen esto menos arriesgado de lo que suena

**R4 está escrito como lista blanca.** `esAdmin = rol === ADMIN || rol === SUPER_ADMIN` — no es "si es VENDEDOR, oculta". Un rol nuevo cae por defecto del lado de **no ver dinero**, que es el lado seguro. Si estuviera escrito al revés, meter EMPLEADO habría filtrado costos y utilidades el día del despliegue sin que ninguna prueba lo notara.

**`Plataforma.capacidadPantallas` ya existe en el esquema y no lo lee nadie.** El campo donde el cliente quiere que viva la configuración ya está, muerto desde el principio. F3.2 lo revive en vez de inventar otro.

---

## Prompt F3.1 — Rol EMPLEADO

> **Estado:** listo para ejecutar.
> **Verificable al terminar:** el cliente entra, ve a su gente dividida en empleados y revendedores, y **nadie perdió la capacidad de vender** respecto al día anterior.

```
Lee CLAUDE.md, DISENO.md, PRD-MVP-Ventas.md y GUIA-DE-PRUEBA.md antes de
empezar. Las credenciales de desarrollo están en GUIA-DE-PRUEBA.md.

Antes de escribir código lee plugins/guardas.ts (RANGO_ROL y requiereRol),
plugins/contexto.ts, y cómo routes/ventas.ts escala de VENDEDOR a ADMIN a
mitad de la cadena. Este bloque se apoya entero en eso.

Este es el trabajo de más riesgo del proyecto: cambia los roles de usuarios
que están trabajando hoy en producción. Si algo no te cuadra, para y dilo
antes de construir.

## Qué pide el cliente

Hoy hay tres roles y "empleado" y "revendedor" son el mismo: VENDEDOR. Ya no
alcanza, porque hacen cosas distintas.

| | Vender | Garantías y pantallas vendidas | Crear cuentas | Saldo |
|---|---|---|---|---|
| VENDEDOR (revendedor) | sí | **no** | no | **sí** |
| EMPLEADO (nuevo) | sí | **sí** | **sí** | no |
| ADMIN | sí | sí | sí, y todo lo demás | no |

El revendedor **pierde** garantías y pantallas vendidas, que hoy sí ve. Es a
propósito: son las cuentas del negocio del cliente, no las suyas.

El empleado **solo crea** cuentas. No edita, no desactiva, no toca
plataformas ni precios.

## 1. El enum, y la trampa de Postgres

`Rol` suma `EMPLEADO`. Y acá hay una trampa concreta que revienta en el
despliegue, no en desarrollo:

**Postgres no deja usar un valor de enum nuevo en la misma transacción en que
se agrega.** Prisma envuelve cada archivo de migración en una transacción. Así
que `ALTER TYPE "Rol" ADD VALUE 'EMPLEADO'` y el `UPDATE` que lo usa **tienen
que ir en dos migraciones separadas**. Si van juntas, la primera corrida
contra producción falla con "unsafe use of new value of enum type".

Dos archivos, en orden:
1. Agregar el valor al enum.
2. La migración de datos.

## 2. La migración de datos, que es el corazón del bloque

```sql
UPDATE "Usuario" SET rol = 'EMPLEADO'
WHERE rol = 'VENDEDOR' AND "usaSaldo" = false;
```

**Por qué esto es seguro:** el cliente ya hizo esta separación a mano cuando
activó el interruptor "Vende contra saldo" a sus revendedores. Quien no lo
tiene activo es un empleado. No estamos adivinando: estamos leyendo una
decisión que él ya tomó en la interfaz.

Resultado: todo el que vende hoy sigue vendiendo mañana. Los empleados pasan a
EMPLEADO y ganan garantías y creación de cuentas; los revendedores se quedan
en VENDEDOR con su saldo intacto.

Idempotente y segura en una empresa sin usuarios: un UPDATE que no empareja
filas no falla.

## 3. El rol se lee de la base, no del token

`contexto.ts` saca el rol del payload del JWT. Si solo cambiamos la base, un
empleado con sesión abierta sigue siendo VENDEDOR hasta que vuelva a entrar —
y "le cambié el rol y no pasó nada" es un bug que va a volver cada vez que el
cliente mueva a alguien.

`contexto.ts` **ya consulta la fila del usuario en cada petición** para
comparar `versionSesion`. Agrega `rol: true` a ese `select` y usa el rol de la
base, no el del token. Cuesta cero consultas más y hace que todo cambio de rol
tenga efecto inmediato, para siempre.

El rol puede seguir viajando en el token; simplemente deja de ser la fuente de
verdad.

## 4. La jerarquía

`RANGO_ROL` pasa a: VENDEDOR 0, **EMPLEADO 1**, ADMIN 2, SUPER_ADMIN 3.

Con eso, `requiereRol(VENDEDOR)` admite también a EMPLEADO (correcto: todo lo
que puede un revendedor lo puede un empleado) y `requiereRol(ADMIN)` lo sigue
dejando fuera.

## 5. Permisos por ruta

- **Sin cambio:** `/ventas` (vender, selectores, `/mias`) sigue en VENDEDOR.
- **Suben a EMPLEADO:** todo `/garantias`, incluido `/pantallas-vendidas`.
- **Baja a EMPLEADO:** `POST /cuentas`, **solo ese**. El resto de `/cuentas`
  —editar, desactivar, listar pantallas— se queda en ADMIN.

Ese último es el delicado: hay que partir la cadena de `cuentas.ts` para que
la creación quede bajo EMPLEADO y lo demás bajo ADMIN. El patrón ya existe en
`ventas.ts`, que escala de VENDEDOR a ADMIN a mitad de la cadena: la guarda
aplica a lo que se monta **después**, así que el orden de declaración de las
rutas es el que manda. Una ruta declarada en el lugar equivocado queda con el
permiso equivocado y la prueba por router aislado no lo ve.

## 6. R4 — verificar, no asumir

`esAdmin` es una lista blanca de ADMIN y SUPER_ADMIN, así que EMPLEADO cae por
defecto del lado de no ver dinero. Eso está bien.

**Recórrelo igual y confírmalo**, porque basta un sitio escrito al revés
—`rol === Rol.VENDEDOR ? ocultar : mostrar`— para que un empleado vea costos y
utilidades el día del despliegue. Si encuentras uno, arréglalo a lista blanca.

## 7. El saldo deja de depender de `usaSaldo`

Ahora VENDEDOR significa revendedor con saldo. La verificación y el descuento
en la transacción de venta pasan a decidirse por **rol**, no por `usaSaldo`.

- No borres la columna `usaSaldo` en esta entrega. Deja de leerse, y una
  prueba vigila que ningún archivo de `src/` la lea. Se elimina más adelante,
  cuando haya pasado tiempo en producción.
- El interruptor "Vende contra saldo" desaparece de la pantalla de usuarios:
  mover a alguien entre empleado y revendedor ahora es cambiarle el rol.
- Las columnas de saldo y el botón de cargar saldo solo aparecen para
  VENDEDOR.

## 8. Frontend

- `lib/rol.ts` y `lib/nav.ts` suman EMPLEADO.
- "Pantallas vendidas" pasa a `rolMinimo: "EMPLEADO"`.
- "Cuentas" aparece para EMPLEADO, **pero la pantalla tiene que mostrarle solo
  lo que puede hacer**: el botón de crear, y nada de editar, desactivar ni ver
  el detalle de pantallas. Un botón que devuelve 403 al apretarlo es peor que
  no tenerlo.
- El selector de rol en la pantalla de usuarios suma EMPLEADO, con una línea
  que diga qué puede cada uno. El cliente va a usar ese selector para
  reclasificar a su gente y tiene que entenderlo sin preguntarte.

## 9. Verificación

- Las pruebas existentes pasan sin modificarse. `tsc --noEmit` limpio en ambas
  apps, cero errores incluidos los de archivos de prueba.
- **`app-compuesta.test.ts`**, con un EMPLEADO nuevo en las fixturas:
  - alcanza vender, `/ventas/mias`, `/garantias/pantallas-vendidas` y
    `POST /cuentas`
  - recibe 403 en `PATCH /cuentas/:id`, en desactivar, en `/ventas/listado`,
    `/ventas/totales`, `/precios`, `/usuarios` y `/empresas`
  - un VENDEDOR ahora recibe **403 en `/garantias/pantallas-vendidas`**, que
    antes alcanzaba
  - el caso sin sesión de cada ruta tocada
- **R4 sobre el JSON crudo:** la respuesta a un EMPLEADO no contiene "costo",
  "utilidad" ni "margen" en ninguna parte.
- **Prueba de la migración de datos:** un VENDEDOR con `usaSaldo=false` queda
  EMPLEADO; uno con `usaSaldo=true` se queda VENDEDOR con su saldo intacto; un
  ADMIN no se toca. Corre dos veces sin cambiar nada la segunda.
- **Prueba del rol desde la base:** cambiarle el rol a un usuario con sesión
  abierta cambia lo que puede hacer en la siguiente petición, sin reloguear.
- **Prueba de que nadie dejó de poder vender:** un usuario que era VENDEDOR sin
  saldo vende igual después de quedar EMPLEADO.
- El saldo sigue cobrándose a los VENDEDOR y sigue sin tocarse para EMPLEADO.
- Recorre en claro y en oscuro lo que toques.

## 10. Entregable

Reporta:
- Dónde quedó partida la cadena de guardas en `cuentas.ts`, citando líneas.
- Si encontraste algún sitio de R4 escrito al revés.
- Qué le aparece y qué no a un EMPLEADO en la pantalla de cuentas.
```

---

## Registro — F3.1 · **aprobada, sin pendientes**

Revisado el 9 de octubre. Es la entrega más limpia del proyecto: **las tres trampas que marqué están resueltas, y el reporte no menciona ninguna.** Se contó de menos otra vez.

| Trampa | Cómo quedó |
|---|---|
| Postgres prohíbe usar un valor de enum nuevo en la transacción que lo agrega | Dos migraciones separadas, `20261009164930` y `20261009164941`, **con la razón escrita dentro del SQL** para que nadie las junte después. |
| El rol viaja en el JWT y un cambio no tendría efecto hasta el próximo login | `contexto.ts` lee `rol` de la base, agregado al `select` que ya existía para `versionSesion`. Cero consultas nuevas, y documentado en el archivo. |
| La jerarquía numérica | `RANGO_ROL` renumerado: VENDEDOR 0, EMPLEADO 1, ADMIN 2, SUPER_ADMIN 3. |

Y una mejora sobre lo que pedí: **`usaSaldo` se deriva del rol en la respuesta del API** (`usaSaldo: usuario.rol === Rol.VENDEDOR`) en vez de leerse de la columna. La forma de la respuesta no cambia para el frontend, la columna queda muerta sin romper nada, y se puede borrar más adelante sin tocar contratos.

Verificado aparte:
- La cadena de `cuentas.ts` se parte en la 122 (EMPLEADO) y la 221 (ADMIN), con solo el `POST` en medio. Es el patrón de `ventas.ts`.
- R4 sigue siendo lista blanca en todos los puntos de exposición, y `/ventas/mias` excluye en el `select`, no después.
- El selector de plataformas del formulario del empleado se alimenta de `/disponibilidad`, que **lista todas las plataformas activas aunque tengan cero inventario** — así que se puede crear la primera cuenta de una plataforma nueva. Lo revisé porque un endpoint llamado "disponibilidad" fácilmente podría haber filtrado las vacías, y ahí el empleado no habría podido crear la cuenta que justamente falta.

**Este despliegue no tumba sesiones.** Como el rol se lee de la base, los empleados pasan a EMPLEADO en su siguiente petición sin volver a entrar. Distinto del despliegue del 8 de octubre.

### Nota menor

El recorrido de verificación creó un usuario de prueba en la base de desarrollo. En este sistema los usuarios no se borran, se desactivan (R3): desactívalo desde `/panel/usuarios` y listo. No toca producción.

---

## Prompt F3.2 — Perfiles, pines y capacidad por plataforma

> **Estado:** listo para ejecutar **después de que F3.1 esté desplegado y verificado**.
> **Verificable al terminar:** crear una cuenta pide solo correo y contraseña, y la cuenta nace con sus pantallas, perfiles y pines ya puestos.

```
Lee CLAUDE.md, DISENO.md, PRD-MVP-Ventas.md y GUIA-DE-PRUEBA.md antes de
empezar. Lee también routes/cuentas.ts completo: la generación de pantallas,
perfiles y pines vive ahí y es lo que se muda.

## Qué pide el cliente

Todas las cuentas de una plataforma tienen el mismo número de pantallas, los
mismos perfiles y los mismos pines. Lo único que cambia entre cuentas es el
correo y la contraseña.

Entonces eso deja de configurarse cuenta por cuenta y pasa a la plataforma.
**Pero cada cuenta sigue guardando sus propios perfiles y pines**: no cambia
dónde se almacenan, cambia dónde se definen.

## 1. Esquema

`Plataforma.capacidadPantallas` **ya existe y no lo usa nadie**. Se revive: es
cuántas pantallas tendrá cada cuenta nueva de esa plataforma.

Modelo nuevo, con `empresaId` como todos (R1):

    PlataformaPantalla          -- la plantilla, una fila por pantalla
      id, empresaId, plataformaId
      numero      Int
      perfil      String?
      pin         String?       -- cifrado, igual que Pantalla.pin
      @@unique([plataformaId, numero])

`Cuenta.capacidadPantallas` **no se borra**. Deja de recibirse del formulario y
se escribe desde la plataforma al crear. Sigue siendo el dato de esa cuenta.

## 2. Crear una cuenta

El cuerpo pasa a ser `{ plataformaId, correo, password, notas? }`. Nada más.

Las pantallas se generan copiando la plantilla de la plataforma: una `Pantalla`
por cada `PlataformaPantalla`, con su `numero`, su `perfil` y su `pin`.

- El pin se guarda cifrado en la `Pantalla`, como hoy.
- Si la plataforma no tiene plantilla configurada, la creación **falla con un
  error de negocio claro** que diga que hay que configurarla primero, con el
  nombre de la plataforma. Nunca crear una cuenta sin pantallas: es inventario
  fantasma que el vendedor va a ver disponible y no va a poder entregar.

## 3. Editar la plantilla no toca lo que ya existe

Decisión del cliente: **la plantilla solo aplica a cuentas nuevas.**

Las cuentas ya creadas conservan sus pantallas, perfiles y pines. No se
propaga, no se pregunta, no se ofrece.

La razón es dura: una pantalla vendida ya le entregó su PIN al comprador por
WhatsApp, y `VentaDetalle` guarda esa copia como histórico (R3). Cambiarle el
PIN a la pantalla dejaría al comprador con un dato que no sirve y sin forma de
saberlo.

**Dilo en la pantalla**, junto al editor de la plantilla: que los cambios
aplican solo a las cuentas que se creen de ahí en adelante. Si no, el admin va
a editar esperando que se propague.

## 4. Migración de datos — de dónde sale la plantilla inicial

En producción ya hay cuentas con sus pantallas. La plantilla no puede nacer
vacía o el cliente no podría crear cuentas hasta configurar las 16 plataformas
a mano.

Por cada plataforma que tenga al menos una cuenta:
- Tomar la cuenta con **más pantallas** como representativa.
- `Plataforma.capacidadPantallas` = ese número.
- Crear una `PlataformaPantalla` por cada pantalla de esa cuenta, copiando
  `numero`, `perfil` y `pin` tal cual (el pin ya está cifrado: se copia el
  valor cifrado, no se descifra ni se vuelve a cifrar).

Las plataformas sin cuentas quedan sin plantilla y pedirán configuración la
primera vez.

**Nunca borres ni modifiques pantallas existentes**, aunque alguna cuenta tenga
un número distinto al de la plantilla. Pueden tener ventas colgando (R3) y la
divergencia es histórica, no un error que haya que corregir.

Reporta cuántas plataformas quedaron con plantilla y cuántas sin ella.

## 5. Pantallas

**Plataformas** (`/panel/catalogo/plataformas`), solo ADMIN: al editar una
plataforma, una sección para la plantilla — cuántas pantallas, y por cada una
su perfil y su PIN. Para las plataformas con `usaPerfilPin = false`, perfil y
pin no se piden.

Subir el número agrega filas; bajarlo quita las de más **de la plantilla**, que
no es inventario y no afecta a ninguna cuenta.

**Cuentas** (`/panel/cuentas`): el formulario de alta queda en correo,
contraseña y notas. Desaparecen capacidad, perfiles y pines. Debajo, en texto,
cuántas pantallas va a generar según la plataforma elegida, para que quien crea
sepa qué va a pasar antes de darle guardar.

El detalle de una cuenta sigue mostrando sus pantallas con sus perfiles y pines
como hoy: eso no cambia.

## 6. Verificación

- Las pruebas existentes pasan sin modificarse. `tsc --noEmit` limpio en ambas
  apps, cero errores.
- `app-compuesta.test.ts` para toda ruta nueva o guarda tocada, con el caso sin
  sesión.
- Crear una cuenta genera exactamente las pantallas de la plantilla, con sus
  perfiles, y con los pines descifrables al valor correcto.
- Crear una cuenta en una plataforma sin plantilla da error de negocio, no 500,
  y **no deja la cuenta creada sin pantallas**.
- Editar la plantilla no cambia ninguna pantalla de ninguna cuenta existente.
- La migración de datos: corre dos veces sin fallar, no toca pantallas
  existentes, y deja la plantilla igual a la cuenta con más pantallas.
- R1: `PlataformaPantalla` entra en la cobertura derivada del esquema (el
  conteo de modelos con `empresaId` sube).
- Recorre en claro y en oscuro lo que toques.

## 7. Entregable

Reporta cuántas plataformas quedaron con plantilla y cuántas sin, y si alguna
cuenta de producción tiene un número de pantallas distinto al que quedó en su
plataforma — ese dato le interesa al cliente aunque no haya que arreglarlo.
```

---

## Registro — F3.2 · **aprobada, con un pendiente chico**

Revisado el 9 de octubre. La funcionalidad está bien: la plantilla vive en la plataforma, la cuenta nace con sus pantallas copiadas, editar la plantilla no toca lo existente, y crear una cuenta en una plataforma sin plantilla falla con error de negocio sin dejar la cuenta huérfana. El backfill dejó 18 de 20 plataformas configuradas y cero cuentas divergentes.

Y el hallazgo propio es bueno: notar que una plataforma recién creada decía "genera 1 pantalla" sin tener plantilla es exactamente el tipo de cosa que solo aparece usando la aplicación.

### El pendiente: el arreglo es del formulario, no de la fuente

El síntoma se resolvió haciendo que el formulario mande un `PUT .../pantallas` con `[]` justo después de crear. Pero `POST /plataformas` **sigue exigiendo `capacidadPantallas >= 1`** y sigue escribiéndolo sin crear ninguna fila de plantilla. Dos consecuencias:

- **No es atómico.** Si la segunda petición no llega —se cerró la pestaña, falló la red— queda exactamente el estado que el arreglo buscaba evitar.
- **El seed tampoco crea plantilla.** `apps/api/prisma/seed.ts` crea las plataformas con su `capacidadPantallas` y cero filas de plantilla. La empresa de producción está bien porque la arregló el backfill, pero **cualquier instalación nueva nace con el problema.**

El arreglo de verdad es más chico que el parche: `POST /plataformas` deja de recibir `capacidadPantallas` y lo crea en 0. El número ya es derivado — el `PUT` de la plantilla lo escribe desde `pantallas.length` (línea 308). Con eso el estado inconsistente deja de ser representable en vez de quedar tapado. Y el seed crea sus filas de plantilla.

### Esto ya va por la tercera vez, así que es regla

Misma forma en tres entregas seguidas:

| Entrega | Se arregló | Siguió produciéndolo |
|---|---|---|
| F2.2 | La migración desactivó el TipoCliente "Promoción" | `TIPOS_CLIENTE_POR_DEFECTO`, en cada empresa nueva y cada backfill |
| F2.4 | Se quitó `bg-transparent` al select ilegible | El token `--secundario-suave`, claro para todo lo demás |
| F3.2 | El formulario sincroniza plantilla vacía | `POST /plataformas` y el seed |

Quedó como convención permanente en `CLAUDE.md`: arreglar el dato no es arreglar la fuente, y la prueba que lo vigila no es "el dato quedó bien" sino **"una entidad creada mañana nace bien"**.

---

## Después: rediseño y logos

Los dos siguen bloqueados por lo mismo de siempre:

- **Rediseño de ventas:** falta saber qué no le gusta de la pantalla actual. Una captura con tres flechas resuelve más que una hora de conversación.
- **Logos:** falta el archivo, en SVG si se puede.

Y sigue abierto, sin ser código: **la tabla de costos.** Es la dificultad principal que el cliente describió en su documento original, lleva tres despliegues pendiente, y mientras siga en cero el panel le muestra una ganancia que es igual a la venta.
