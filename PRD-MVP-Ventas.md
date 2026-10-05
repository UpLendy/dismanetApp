# PRD — MVP Módulo de Ventas

**Proyecto:** Sistema Interno de Gestión (base multi-empresa)
**Cliente inicial:** DISMANET
**Versión:** 3.0 — 28 de septiembre de 2026
**Estado:** alcance cerrado, listo para desarrollo

> Este documento es la fuente de verdad del MVP. Cualquier funcionalidad que no esté descrita aquí está fuera de alcance. Si durante el desarrollo aparece una duda que este documento no resuelve, se resuelve por escrito aquí antes de programar.

---

## Control de cambios

| Versión | Cambio |
|---|---|
| 1.0 | Versión inicial. Solo venta unitaria. Paquetes fuera de alcance. |
| 1.1 | Duración en días con nombre libre. Valores de siembra. Preguntas abiertas. |
| 2.0 | Duraciones en días y meses. Paquetes entran al MVP. Venta con detalle multi-pantalla. Mensaje de WhatsApp. |
| **3.0** | **Vencimiento por renglón, no por venta** (un combo puede tener Netflix a 28 días y Disney+ a 30). **Perfil y PIN por pantalla.** **Código de compra automático.** Condiciones por plataforma. Catálogo real de DISMANET incorporado como datos de siembra (anexo A). |

---

## 1. Objetivo

Construir la versión mínima funcional de una plataforma que permita a una empresa revendedora de cuentas de streaming **registrar ventas en segundos y controlar su inventario de pantallas automáticamente**.

El MVP cubre un solo módulo — **ventas** — más la base multi-empresa que permite que la misma instalación sirva a varias empresas sin que ninguna vea los datos de otra.

**Criterio de éxito:** un vendedor de DISMANET registra una venta en menos de 10 segundos, obtiene un mensaje listo para copiar y pegar en WhatsApp con el código de compra y las credenciales, y el administrador ve al instante cuánto se vendió, cuánto costó y cuánto se ganó.

---

## 2. Decisiones de producto tomadas

| # | Decisión | Razón |
|---|---|---|
| D1 | **Multi-empresa desde el día uno.** Toda entidad de negocio cuelga de una empresa. | Agregar tenancy después obliga a migrar todos los datos y reescribir todas las consultas. |
| D2 | **Un admin puede crear una empresa nueva, pero no conserva acceso a ella.** | Si DISMANET pudiera ver las ventas de la empresa de su amigo, el amigo no usaría la plataforma. |
| D3 | **"Promoción" no es una entidad aparte: es un tipo de cliente más.** | La matriz de precios ya resuelve el caso sin código adicional. |
| D4 | **La disponibilidad de una pantalla se calcula, no se almacena.** | Elimina las tareas programadas para liberar pantallas vencidas y cualquier estado que se pueda desincronizar. |
| D5 | **La venta guarda copia del precio, el costo y los nombres, no referencias vivas.** | Las ventas de ayer deben seguir mostrando lo que realmente se cobró. |
| D6 | **El vendedor ve credenciales solo de las cuentas que él vendió.** | Reduce el riesgo de fuga de inventario. |
| D7 | **Sin facturación de la plataforma en el MVP.** | Agrega pasarela de pagos, un módulo completo. |
| D8 | **La duración se expresa como cantidad + unidad (DIAS o MESES).** "1 año" se modela como 12 MESES. | El catálogo usa ambos esquemas. No hace falta una unidad AÑOS. |
| D9 | **Toda venta tiene una tabla de detalle con una fila por pantalla asignada.** | Un paquete consume varias pantallas. |
| D10 | **Los paquetes no tienen stock propio.** Un paquete es una definición; las cuentas se asignan al vender. | El inventario sigue siendo uno solo, por plataforma. |
| D11 | **El sistema asigna automáticamente las cuentas de un paquete.** | Mantiene el flujo de dos clics. |
| D12 | **El precio y el costo del paquete se digitan a mano en la matriz.** | Decisión del cliente. Mitigación en 5.6. |
| D13 | **El mensaje de WhatsApp se genera desde una plantilla configurable y se guarda como copia en la venta.** | La plantilla cambiará; el mensaje de una venta pasada debe reimprimirse igual. |
| D14 | **Cada renglón de la venta tiene su propia fecha de vencimiento.** | El catálogo real lo exige: en el combo "Básico 1 / 30 días" Netflix dura 28 días y Disney+ dura 30. Además la pantalla de Netflix se libera dos días antes y se puede revender. |
| D15 | **Cada pantalla tiene perfil y PIN.** El sistema los genera al crear la cuenta y el admin puede editarlos. | El mensaje al cliente final los incluye. Generarlos evita digitar siete pines por cuenta. |
| D16 | **Cada venta genera un código de compra automático y único**, con formato de tres letras configurables por empresa más seis dígitos (ej. `DIS995865`). | Es lo que da trazabilidad y lo que el cliente final referencia al pedir soporte. Se conserva el formato que DISMANET ya usa. |

---

## 3. Roles y permisos

Tres roles. Cada usuario tiene exactamente uno.

### SUPER_ADMIN
Rol de plataforma. Pertenece al proveedor del software, no a una empresa cliente.

- Ver, crear, activar y desactivar cualquier empresa
- Crear el primer administrador de cualquier empresa
- Seleccionar una empresa y operar dentro de ella con todos los permisos de ADMIN

### ADMIN
Dueño o encargado de una empresa. Ve todo lo de **su** empresa.

- Gestionar usuarios de su empresa
- Configurar plataformas, duraciones, tipos de cliente y paquetes
- Configurar la matriz de precios de unidades y de paquetes
- Editar las plantillas del mensaje de WhatsApp y el prefijo del código de compra
- Gestionar cuentas, sus pantallas, perfiles y pines
- Registrar ventas (todos los permisos de VENDEDOR)
- Ver todas las ventas de la empresa **con costo, utilidad y márgenes**
- Ver los totales del día, la semana y el mes
- Crear una empresa nueva sin obtener acceso posterior a ella (D2)

### VENDEDOR
Empleado que atiende clientes.

- Registrar ventas, unitarias y de paquete
- Obtener el mensaje de WhatsApp generado, con código de compra y credenciales
- Ver el listado de sus propias ventas **sin costo, sin utilidad y sin margen**, con opción de volver a copiar el mensaje
- Consultar disponibilidad: cuántas pantallas libres hay por plataforma

**No puede:** ver costos, utilidades, márgenes, ventas de otros vendedores, totales de la empresa, la base completa de cuentas y contraseñas, ni ninguna pantalla de configuración.

---

## 4. Modelo de datos

Catorce entidades. Todas excepto `Empresa` y `Usuario` (para el SUPER_ADMIN) cuelgan de una empresa.

```
Empresa
  id, nombre, nit?, prefijoCodigo (3 letras), activa,
  creadaPorUsuarioId?, createdAt

Usuario
  id, empresaId?, email (único global), passwordHash, nombre,
  rol (SUPER_ADMIN | ADMIN | VENDEDOR), activo, createdAt

Plataforma
  id, empresaId, nombre, nombreMensaje?, condiciones?,
  capacidadPantallas, usaPerfilPin (bool), activa
  -- nombreMensaje: nombre decorado para el mensaje, ej. "N.E.T.F.L.I.X"
  --   si es null se usa `nombre`
  -- condiciones: texto que se muestra al vendedor antes de vender
  -- usaPerfilPin: false para Spotify, Canva, YouTube y similares

Duracion
  id, empresaId, nombre, cantidad, unidad (DIAS | MESES), activa

TipoCliente
  id, empresaId, nombre, activo

Paquete
  id, empresaId, nombre, descripcion?, activo

PaquetePlataforma                -- composición del paquete
  id, empresaId, paqueteId, plataformaId, cantidadPantallas (default 1)
  -- único: (paqueteId, plataformaId)

PaqueteDuracionPlataforma        -- excepciones de duración (D14)
  id, empresaId, paqueteId, duracionVendidaId, plataformaId, duracionRealId
  -- único: (paqueteId, duracionVendidaId, plataformaId)
  -- solo existen filas donde la duración real DIFIERE de la vendida
  -- ej: Básico 1 vendido a "30 días" → Netflix usa "28 días"

Precio                           -- matriz de unidades y de paquetes
  id, empresaId, duracionId, tipoClienteId,
  plataformaId?, paqueteId?,     -- exactamente uno de los dos
  precioVenta, costo, activo
  -- único: (empresaId, plataformaId, duracionId, tipoClienteId)
  -- único: (empresaId, paqueteId, duracionId, tipoClienteId)
  -- check: (plataformaId IS NULL) <> (paqueteId IS NULL)

Cuenta
  id, empresaId, plataformaId, correo, password,
  capacidadPantallas, notas?, activa, createdAt

Pantalla                         -- unidad de inventario
  id, empresaId, cuentaId, numero, perfil?, pin?, activa
  -- único: (cuentaId, numero)
  -- perfil y pin son null cuando la plataforma no usa perfiles

Venta
  id, empresaId, vendedorId, codigoCompra,
  tipoVenta (UNIDAD | PAQUETE),
  plataformaId?, paqueteId?,
  duracionId, tipoClienteId,
  nombreItem, nombreDuracion, cantidadDuracion, unidadDuracion,
  nombreTipoCliente,
  precioVenta, costo, utilidad,
  fechaVenta, fechaVencimientoMax,
  mensajeGenerado,
  anulada, anuladaPorId?, anuladaEn?, createdAt
  -- único: (empresaId, codigoCompra)
  -- fechaVencimientoMax = mayor vencimiento de sus renglones. Es un valor
  --   derivado que se escribe al crear la venta, solo para filtrar y ordenar.
  --   La disponibilidad NUNCA se calcula con este campo.

VentaDetalle                     -- una fila por pantalla asignada
  id, empresaId, ventaId, pantallaId, cuentaId, plataformaId,
  nombrePlataforma, correoCuenta, passwordCuenta, perfil?, pin?,
  duracionId, cantidadDuracion, unidadDuracion, fechaVencimiento
  -- cada renglón tiene SU PROPIA duración y vencimiento (D14)

PlantillaMensaje
  id, empresaId, tipo (UNIDAD | PAQUETE), contenido, actualizadaEn
  -- único: (empresaId, tipo)
```

**Notas de diseño**

- **La disponibilidad se calcula por renglón.** Una pantalla está ocupada si existe un `VentaDetalle` cuya venta no esté anulada y cuyo `VentaDetalle.fechaVencimiento > now()`. Nunca se usa `Venta.fechaVencimientoMax` para esto.
- `fechaVencimiento` se calcula por renglón: si `unidad = DIAS`, se suman días; si `unidad = MESES`, se suman meses de calendario con recorte al último día del mes destino (31 de enero + 1 mes = 28 o 29 de febrero).
- `Cuenta.password`, `VentaDetalle.passwordCuenta`, `Pantalla.pin` y `VentaDetalle.pin` se guardan cifrados de forma reversible (AES-256-GCM, clave en variable de entorno). No son hash: hay que poder mostrarlos.
- `Venta` y `VentaDetalle` guardan IDs **y** copias, para que el histórico no cambie si se renombra una plataforma o se ajusta un precio.

---

## 5. Funcionalidades del MVP

### 5.1 Autenticación
Login con email y contraseña (Argon2id), sesión por JWT en cookie httpOnly SameSite=Lax de 7 días, logout, y middleware que resuelve usuario, rol y empresa activa en cada petición.

**Fuera:** recuperación de contraseña por correo, 2FA, registro público, refresh tokens.

### 5.2 Gestión de empresas
- SUPER_ADMIN: listado, crear empresa + su primer admin, activar/desactivar, entrar a una empresa
- ADMIN: crear una empresa nueva y su primer admin (D2)
- Al crear la empresa se define su `prefijoCodigo` de tres letras
- Una empresa desactivada bloquea el login de todos sus usuarios

### 5.3 Gestión de usuarios
- ADMIN: listado, crear usuario (nombre, email, contraseña inicial, rol), desactivar y reactivar
- Un usuario no puede desactivarse a sí mismo
- Una empresa no puede quedarse sin ningún ADMIN activo

### 5.4 Configuración del catálogo
CRUD completo para ADMIN dentro de su empresa:

- **Plataformas:** nombre, nombre para el mensaje, condiciones, capacidad de pantallas por cuenta, y si usa perfil y PIN
- **Duraciones:** nombre, cantidad y unidad (DIAS o MESES)
- **Tipos de cliente:** nombre

Todo se desactiva, nunca se borra.

### 5.5 Paquetes
- Crear paquete con nombre y descripción
- Definir su composición: qué plataformas lo integran y cuántas pantallas de cada una
- **Excepciones de duración:** para cada duración en la que el paquete se vende, el admin puede fijar una duración distinta a una plataforma específica. Por defecto todas heredan la duración vendida. Ejemplo real: "Básico 1" vendido a 30 días usa Netflix a 28 días.
- Un paquete debe tener al menos una plataforma para activarse
- El listado muestra la composición en una línea, con las duraciones reales cuando difieren: `Netflix 28d · Disney+ 30d`

### 5.6 Matriz de precios
Dos pestañas: **Unidades** y **Paquetes**. Filas = duraciones, columnas = tipos de cliente. Cada celda captura precio de venta y costo. Guardado en lote. Una combinación sin precio no aparece como vendible.

**Salvaguarda obligatoria para paquetes (mitiga D12).** Al escribir el costo de un paquete, la interfaz muestra junto al campo la suma de los costos de sus plataformas componentes, usando para cada una su duración real según las excepciones de 5.5. Si el valor digitado difiere en más de 5%, se marca en color de advertencia con el texto "el costo digitado no coincide con la suma de sus componentes". **Es un aviso, no un bloqueo.**

### 5.7 Cuentas, pantallas, perfiles y pines
- ADMIN: crear cuenta (plataforma, correo, contraseña, capacidad)
- Al crear la cuenta el sistema genera sus N pantallas. Si la plataforma usa perfil y PIN, propone perfil `A`, `B`, `C`… y un PIN aleatorio de cuatro dígitos por pantalla. **Ambos son editables** antes y después de guardar (D15).
- Listado de cuentas con plataforma, correo y pantallas libres / totales
- Detalle de cuenta: cada pantalla con su perfil, su PIN, su estado y, si está ocupada, hasta cuándo y en qué venta
- Editar cuenta y desactivarla
- Subir la capacidad genera las pantallas faltantes; bajarla solo si las sobrantes están libres

### 5.8 Venta rápida — la pantalla principal

Arranca con un **selector de modo: UNIDAD o PAQUETE**.

#### Modo UNIDAD
1. Tipo de cliente → 2. Duración → 3. Plataforma

Solo se muestran las plataformas con precio definido para esa combinación **y** al menos una pantalla libre, con el contador de disponibles y sus **condiciones** visibles (ej. "1 pantalla, solo TV. Incluye ESPN y Hulu").

#### Modo PAQUETE
1. Tipo de cliente → 2. Duración → 3. Paquete

Solo se muestran los paquetes con precio definido **y** disponibilidad suficiente en *todas* sus plataformas componentes. Cada paquete muestra su composición con las duraciones reales y las condiciones de sus plataformas.

#### Al presionar VENDER
Dentro de una única transacción:

1. Se resuelve, por cada plataforma componente, su **duración real** (la vendida, o la excepción de 5.5 si existe)
2. Se toman las pantallas libres necesarias. Si alguna plataforma no aporta su cupo completo, **la venta entera se revierte** y se responde nombrando la plataforma sin inventario
3. Se genera el **código de compra**: `prefijoCodigo` + seis dígitos aleatorios, verificando unicidad dentro de la empresa y reintentando hasta cinco veces si colisiona
4. Se crea la `Venta` con vendedor, fecha, hora, precio, costo y utilidad
5. Se crea un `VentaDetalle` por pantalla, **cada uno con su propia duración y su propia fecha de vencimiento**, y con copia de correo, contraseña, perfil y PIN
6. Se escribe `fechaVencimientoMax` como el mayor vencimiento de los renglones
7. Se renderiza el mensaje de WhatsApp y se guarda en `Venta.mensajeGenerado`
8. Se devuelve al vendedor el mensaje armado, con un **botón de copiar** de un solo clic

**Criterios de aceptación**
- Dos vendedores presionando VENDER al mismo tiempo nunca reciben la misma pantalla
- Una venta de paquete nunca queda a medias
- En un combo con excepción de duración, cada pantalla vence en su fecha: la de Netflix a los 28 días y la de Disney+ a los 30, y la de Netflix vuelve a estar disponible dos días antes
- Dos ventas nunca comparten código de compra dentro de una misma empresa
- El vendedor no escribe ningún dato del cliente final
- El precio no es editable por el vendedor en ninguna circunstancia

### 5.9 Mensaje para WhatsApp
El ADMIN edita dos plantillas, una para unidad y otra para paquete. El editor muestra los marcadores disponibles y una vista previa con datos de ejemplo.

| Marcador | Disponible en | Contenido |
|---|---|---|
| `{{codigoCompra}}` | ambas | Código de compra, ej. `DIS995865` |
| `{{fechaEnLetras}}` | ambas | Fecha de la venta en palabras, ej. `Veintisiete de septiembre` |
| `{{fecha}}` | ambas | Fecha de la venta en formato numérico |
| `{{tipoCliente}}` | ambas | Nombre del tipo de cliente |
| `{{duracion}}` | ambas | Nombre de la duración vendida |
| `{{fechaVencimiento}}` | ambas | Mayor vencimiento de la venta |
| `{{precio}}` | ambas | Precio cobrado, formateado en pesos |
| `{{plataforma}}` | unidad | `nombreMensaje` de la plataforma, ej. `N.E.T.F.L.I.X` |
| `{{perfil}}` | unidad | Perfil asignado |
| `{{pin}}` | unidad | PIN asignado |
| `{{correo}}` | unidad | Correo de la cuenta |
| `{{clave}}` | unidad | Contraseña de la cuenta |
| `{{paquete}}` | paquete | Nombre del paquete |
| `{{listaCuentas}}` | paquete | Un bloque por plataforma asignada (formato abajo) |

**Formato de `{{listaCuentas}}`** — un bloque por renglón, separados por línea en blanco:

```
*{{nombreMensaje}} ({{duracionReal}})*
*PERFIL:* {{perfil}}
*PIN:* {{pin}}
*CORREO:* {{correo}}
*CONTRASEÑA:* {{clave}}
```

Las líneas de `PERFIL` y `PIN` se omiten cuando la plataforma tiene `usaPerfilPin = false`.

**`fechaEnLetras`** requiere una función que escriba el día en palabras y el mes en español, con la primera letra en mayúscula: `Veintisiete de septiembre`. Se implementa como utilidad propia con pruebas para los 31 días.

El texto exacto de las plantillas está en el anexo B.

### 5.10 Listado de ventas
- **ADMIN:** todas las ventas con código de compra, vendedor, tipo, ítem, duración, tipo de cliente, precio, costo, utilidad, cuentas asignadas con su vencimiento individual, y el mensaje generado. Filtros por rango de fechas, vendedor, tipo de venta, plataforma o paquete, y **búsqueda por código de compra**. Totales de hoy, esta semana y este mes: número de ventas, ingresos, costos y utilidad.
- **VENDEDOR:** solo sus propias ventas, con las cuentas asignadas y el botón para volver a copiar el mensaje. **Sin ninguna columna de costo o utilidad.**
- Anular una venta (solo ADMIN): la marca, registra quién y cuándo, y libera **todas** sus pantallas de inmediato. No se borra nunca.

---

## 6. Fuera del alcance del MVP

| Funcionalidad | Entrega prevista |
|---|---|
| Garantías, reemplazos y cadena de trazabilidad | Posterior |
| Buscador global de correos con vista 360 | Posterior |
| Pines de recarga de plataforma y su asociación con cuentas | Posterior |
| Pagos por cuenta y control de recargas | Posterior |
| Dashboard de rentabilidad, KPIs y gráficos | Posterior |
| Métricas comparativas por empleado | Posterior |
| Bitácora de auditoría con valor anterior y nuevo | Posterior |
| Alertas automáticas | Posterior |
| Días perdidos y costo real de garantías | Posterior |
| Reportes exportables | Posterior |
| Proveedores | Posterior |
| Envío automático por WhatsApp (el MVP solo genera el texto para copiar) | Posterior |
| Facturación y planes de la plataforma | Posterior |
| Recuperación de contraseña por correo | Posterior |
| App móvil nativa | Posterior |

> **Nota de desambiguación.** El "PIN" de este MVP es el código de perfil de una pantalla, que va en el mensaje al cliente. Es distinto del módulo de "Pines" del documento de requerimientos original, que son los códigos de recarga que DISMANET compra para pagar las plataformas. Ese módulo sigue fuera del MVP.

---

## 7. Stack técnico

| Capa | Tecnología |
|---|---|
| Runtime backend | Bun |
| API | Elysia.js |
| ORM | Prisma 7 |
| Base de datos | PostgreSQL 16+ |
| Frontend | Next.js (App Router) + TypeScript |
| Estilos | Tailwind CSS + shadcn/ui |
| Cliente de API | Eden Treaty |
| Autenticación | JWT con `@elysiajs/jwt` + Argon2id |
| Validación | Esquemas de Elysia (TypeBox) en cada endpoint |
| Fechas | `date-fns` |

```
/
├── apps/api          Elysia + Prisma
├── apps/web          Next.js
├── packages/shared   tipos y constantes compartidos
├── CLAUDE.md
└── PRD-MVP-Ventas.md
```

---

## 8. Reglas técnicas no negociables

### R1 — Aislamiento entre empresas
Ninguna consulta a una tabla con `empresaId` puede ejecutarse sin filtrar por la empresa del usuario autenticado.

Implementación: extensión de Prisma Client (`$extends`) que inyecta `where: { empresaId }` en `findMany`, `findFirst`, `findUnique`, `update`, `updateMany`, `delete`, `deleteMany`, `count` y `aggregate`, y asigna `empresaId` en `create` y `createMany`. El cliente sin extender solo se usa en el arranque, el seed y el login.

Prueba obligatoria: dos empresas con datos; un usuario de la A recibe cero registros de la B en cada endpoint, incluyendo la consulta por ID directo.

### R2 — Asignación atómica de pantallas
Dentro de una transacción, con `SELECT ... FOR UPDATE SKIP LOCKED`.

1. **Orden determinista de bloqueo:** recorrer las plataformas ordenadas por `plataformaId` ascendente. Sin orden fijo, dos ventas de paquetes que comparten plataformas se bloquean mutuamente.
2. **Todo o nada:** si alguna plataforma no aporta su cupo completo, se revierte la transacción entera.
3. **No sustituir** por "buscar pantalla libre, luego insertar la venta".

Pruebas obligatorias:
1. **Unidad:** 20 peticiones en paralelo contra una plataforma con 5 pantallas libres → exactamente 5 ventas, 15 rechazos, ninguna pantalla duplicada.
2. **Paquete:** paquete de 3 plataformas donde una tiene 2 pantallas libres y las otras 10. Diez peticiones en paralelo → exactamente 2 ventas, y las 8 fallidas no consumen pantallas de las otras plataformas.
3. **Código de compra:** 100 ventas en paralelo → 100 códigos distintos.

### R3 — Inmutabilidad del histórico
`Venta` y `VentaDetalle` nunca se actualizan para reflejar cambios en el catálogo, los precios, las cuentas o las plantillas. Editar la plantilla de WhatsApp no cambia los mensajes de ventas ya registradas.

Anular una venta la marca y libera sus pantallas. No se borra ninguna venta jamás. Las entidades de catálogo se desactivan, no se borran.

### R4 — Permisos en el servidor
Cada endpoint valida el rol antes de ejecutar. Ningún endpoint devuelve `costo`, `utilidad` ni `margen` cuando quien consulta es un VENDEDOR; la exclusión se hace en el `select` de Prisma, no filtrando el objeto después.

### R5 — La disponibilidad se calcula por renglón
Una pantalla está ocupada si existe un `VentaDetalle` con venta no anulada y `VentaDetalle.fechaVencimiento > now()`.

**Nunca** usar `Venta.fechaVencimientoMax` para calcular disponibilidad. Ese campo existe solo para filtrar y ordenar listados. Usarlo para disponibilidad mantendría ocupada la pantalla de Netflix dos días de más en cada combo de 30 días.

---

## 9. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| **El CLI de Prisma tiene problemas bajo Bun** ([issue #28805](https://github.com/prisma/prisma/issues/28805)) | Ejecutar `prisma migrate` y `prisma generate` con Node (`npx prisma ...`). Verificar en la entrega 1. |
| Interbloqueo entre ventas de paquetes que comparten plataformas | Orden determinista de bloqueo (R2) y su prueba. |
| Confundir `fechaVencimientoMax` con el vencimiento real de cada pantalla | R5 y la prueba de vencimiento diferenciado. |
| El costo de los paquetes se desactualiza al cambiar el costo de una plataforma (D12) | Salvaguarda visual en la matriz de precios (5.6). |
| Cifrado de contraseñas y pines | Clave en variable de entorno, nunca en el repositorio. Si se pierde, los datos cifrados son irrecuperables. |
| Fuga de datos entre empresas | R1 y su prueba. |

---

## 10. Plan de ejecución

| # | Entrega | Verificable al terminar |
|---|---|---|
| 1 | Andamiaje, esquema de Prisma, migraciones y seed con el catálogo real | El seed carga las 16 plataformas, 7 duraciones, 5 paquetes y sus precios |
| 2 | Autenticación, roles y extensión de aislamiento por empresa | Login funciona; un usuario de la empresa A no ve datos de la B |
| 3 | Gestión de empresas y usuarios | El SUPER_ADMIN crea una empresa con su admin; el admin crea vendedores |
| 4 | Catálogo: plataformas, duraciones y tipos de cliente | El admin configura el catálogo; las duraciones aceptan días y meses |
| 5 | Paquetes, composición y excepciones de duración | El admin reproduce "Básico 1 / 30 días" con Netflix a 28 |
| 6 | Matriz de precios de unidades y paquetes, con la salvaguarda de costo | El admin define precios en ambas pestañas y ve la advertencia |
| 7 | Cuentas, pantallas, perfiles y pines | Crear una cuenta genera pantallas con perfil y PIN editables |
| 8 | Venta rápida en ambos modos, código de compra y mensaje de WhatsApp | Se completan una venta unitaria y una de paquete con vencimientos distintos por renglón; las tres pruebas de concurrencia pasan |
| 9 | Listado de ventas, totales y despliegue | El admin ve ventas y totales y busca por código; el vendedor ve solo las suyas sin cifras financieras |

---

## 11. Qué se necesita de DISMANET

| Insumo | Estado | ¿Bloquea? |
|---|---|---|
| Precios de venta de plataformas y combos | **Recibido** (anexo A) | — |
| Composición de los combos y excepciones de duración | **Recibido** (anexo A) | — |
| Formato del mensaje | **Recibido** (anexo B) | — |
| **Tabla de costos por plataforma y duración** | **Faltante** | No bloquea el desarrollo, pero **sin ella el sistema no calcula utilidad**, que es la razón principal del proyecto. Prioridad alta. |
| **Precios para Revendedor y Promoción** | **Faltante** | El catálogo recibido tiene una sola columna de precios, que se asume "Cliente normal". Sin los otros, la matriz queda con un solo tipo de cliente. |
| **Capacidad de pantallas por cuenta de cada plataforma** | **Faltante** | El catálogo dice "1 pantalla" refiriéndose a lo que compra el cliente final, no a cuántas pantallas tiene una cuenta de DISMANET. Bloquea la entrega 7. |
| Duración individual de Prime Video y Max | Pendiente | Bloquea solo esos dos precios individuales. En combos ya están definidos. |
| Nombres y correos de empleados | Diferido | No bloquea. |

---

## 12. Preguntas abiertas

| # | Pregunta | Impacto | Resolver antes de |
|---|---|---|---|
| P1 | **¿Las cuentas que compra DISMANET tienen fecha de vencimiento propia?** Si vencen, no se puede vender una duración de 3 meses en una pantalla de una cuenta a la que le quedan 10 días. | Alto — agrega `fechaVencimiento` a `Cuenta` y cambia la consulta de disponibilidad | Entrega 7 |
| P2 | ¿Duración en días o en meses? | **Resuelto** — ambas (D8) | — |
| P3 | ¿Existen promociones temporales con fecha de inicio y fin, o "Promoción" es siempre un tipo de cliente? | Medio — si son temporales, la matriz necesita vigencia | Entrega 6 |
| P4 | Texto de las plantillas | **Resuelto** — anexo B | — |
| P5 | ¿Un paquete puede incluir dos pantallas de la misma plataforma? | Bajo — ya modelado con `cantidadPantallas` | Entrega 5 |
| P6 | ¿"Win+ + IPTV" es un solo producto o dos plataformas que siempre van juntas? Se modela como una sola plataforma. | Bajo | Entrega 4 |
| P7 | ¿El PIN de perfil aplica a todas las plataformas o solo a Netflix y Disney+? El campo `usaPerfilPin` lo resuelve, falta saber el valor por plataforma. | Bajo | Entrega 7 |

---

## Anexo A — Catálogo real de DISMANET

Datos de siembra para la entrega 1. Fuente: `Catalogo_Dismanet.xlsx`, hojas *Plataformas* y *Combos*, correspondientes al catálogo enviado por el cliente el 27 de septiembre de 2026.

### A.1 Duraciones

| Nombre | Cantidad | Unidad |
|---|---:|---|
| 14 días | 14 | DIAS |
| 28 días | 28 | DIAS |
| 30 días | 30 | DIAS |
| 1 mes | 1 | MESES |
| 2 meses | 2 | MESES |
| 3 meses | 3 | MESES |
| 1 año | 12 | MESES |

### A.2 Plataformas

`capacidadPantallas` está marcada como pendiente: el catálogo no la trae. Se siembra en 1 y el admin la corrige.

| Plataforma | Condiciones | usaPerfilPin |
|---|---|---|
| Netflix | 1 pantalla | sí |
| Disney+ Premium | 1 pantalla, solo TV. Incluye ESPN y Hulu | sí |
| Prime Video | 1 pantalla | sí |
| Max | 1 pantalla | sí |
| Win+ + IPTV | — | no |
| YouTube Premium | — | no |
| Canva | Con correo personal | no |
| DIRECTV GO | — | no |
| Plex | — | no |
| Crunchyroll | — | no |
| Paramount+ | — | sí |
| ViX | — | no |
| Spotify | — | no |
| Pornhub | — | no |
| Viki Rakuten | — | no |
| DramaBox | — | no |

### A.3 Precios de plataformas individuales

Tipo de cliente: **Cliente normal**. Costos pendientes de recibir.

| Plataforma | Duración | Precio venta |
|---|---|---:|
| Netflix | 14 días | 7.900 |
| Netflix | 28 días | 10.900 |
| Netflix | 30 días | 11.400 |
| Disney+ Premium | 30 días | 10.900 |
| Prime Video | *por confirmar* | 8.900 |
| Max | *por confirmar* | 8.900 |
| Win+ + IPTV | 2 meses | 16.900 |
| YouTube Premium | 30 días | 10.900 |
| Canva | 1 año | 15.900 |
| DIRECTV GO | 30 días | 14.900 |
| Plex | 30 días | 8.900 |
| Crunchyroll | 30 días | 8.900 |
| Paramount+ | 30 días | 8.900 |
| ViX | 30 días | 8.900 |
| Spotify | 3 meses | 26.900 |
| Pornhub | 1 mes | 11.900 |
| Viki Rakuten | 1 mes | 10.900 |
| DramaBox | 30 días | 8.900 |

### A.4 Paquetes y su composición

Todos con 1 pantalla por plataforma.

| Paquete | Plataformas |
|---|---|
| Básico 1 | Netflix, Disney+ Premium |
| Básico 2 | Netflix, Prime Video |
| Básico 3 | Netflix, Max |
| Ya 1 | Max, Disney+ Premium, Prime Video |
| Especial 1 | Netflix, Disney+ Premium, Prime Video |
| Bacano | Netflix, Disney+ Premium, Prime Video, Max |

### A.5 Precios de paquetes y excepciones de duración

La columna *Excepción* genera filas de `PaqueteDuracionPlataforma`. Donde dice "ninguna", todas las plataformas heredan la duración vendida.

| Paquete | Duración vendida | Precio venta | Excepción |
|---|---|---:|---|
| Básico 1 | 14 días | 16.700 | ninguna |
| Básico 1 | 30 días | 19.900 | Netflix → 28 días |
| Básico 2 | 28 días | 14.200 | ninguna |
| Básico 2 | 30 días | 14.900 | Netflix → 28 días |
| Básico 3 | 28 días | 14.200 | ninguna |
| Básico 3 | 30 días | 14.900 | Netflix → 28 días |
| Ya 1 | 30 días | 19.900 | ninguna |
| Especial 1 | 28 días | 18.900 | ninguna |
| Especial 1 | 30 días | 19.900 | Netflix → 28 días |
| Bacano | 28 días | 25.200 | ninguna |
| Bacano | 30 días | 25.900 | Netflix → 28 días |

**Regla del cliente, textual:** *"En combos de 30 días, Netflix dura 28 días y las demás plataformas duran 30 días. Esta excepción no modifica la opción de Netflix individual de 30 días."*

---

## Anexo B — Plantillas del mensaje

### B.1 Plantilla UNIDAD

```
♥️ *{{plataforma}} ({{duracion}})* ♥️

*fecha*
{{fechaEnLetras}}

*CODIGO DE COMPRA*
{{codigoCompra}}

*PERFIL:*
{{perfil}}

*PIN:*
{{pin}}

*CORREO:*
{{correo}}

*CONTRASEÑA:*
{{clave}}

*POLITICAS DE USO* 🫵
❌*NO* cambiar nombres
❌*NO* cambiar pines
❌*NO* usar más de 1 dispositivo

*IMPORTANTE* tenemos segundo numero para soporte

*INSTAGRAM* 👇
https://www.instagram.com/dismanet.col

*¿Quieres un perfume?*
*disma perfumes* te lo tiene
*catalogo:* https://vercatalogo.com/dismanet/products
```

### B.2 Plantilla PAQUETE

```
♥️ *{{paquete}} ({{duracion}})* ♥️

*fecha*
{{fechaEnLetras}}

*CODIGO DE COMPRA*
{{codigoCompra}}

{{listaCuentas}}

*POLITICAS DE USO* 🫵
❌*NO* cambiar nombres
❌*NO* cambiar pines
❌*NO* usar más de 1 dispositivo

*IMPORTANTE* tenemos segundo numero para soporte

*INSTAGRAM* 👇
https://www.instagram.com/dismanet.col

*¿Quieres un perfume?*
*disma perfumes* te lo tiene
*catalogo:* https://vercatalogo.com/dismanet/products
```

### B.3 Ejemplo renderizado, venta unitaria

```
♥️ *N.E.T.F.L.I.X (30 días)* ♥️

*fecha*
Veintisiete de septiembre

*CODIGO DE COMPRA*
DIS995865

*PERFIL:*
E

*PIN:*
5010

*CORREO:*
geradooopaltaa32@hotmail.com

*CONTRASEÑA:*
Net8123@

...políticas...
```

> **Nota.** El mensaje original del cliente venía en una sola línea con tabulaciones. Aquí se reorganizó en líneas para que sea legible en WhatsApp y editable desde el sistema. Confirmar con DISMANET que el formato resultante le sirve antes de la entrega 8.
