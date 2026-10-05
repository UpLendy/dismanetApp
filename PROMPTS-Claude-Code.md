# Prompts para Claude Code

Secuencia de desarrollo del MVP. **Un prompt por sesión.** No pasar al siguiente hasta que la verificación del anterior pase.

---

## Cómo arrancar

El repositorio es **uno solo** con las dos aplicaciones adentro. No son dos repositorios: Eden Treaty necesita que el frontend importe el tipo de la app de Elysia, y eso exige el mismo proyecto de TypeScript. Se despliegan por separado igual (web a Vercel, API a Railway o Fly).

```
~/Documents/work/dismanet/
├── comercial/            cotización, análisis interno, requerimientos originales
│                         NO es parte del repositorio
└── dismanet-app/         ← el repositorio git. Abrir Claude Code AQUÍ
    ├── CLAUDE.md
    ├── PRD-MVP-Ventas.md
    ├── PROMPTS-Claude-Code.md
    ├── README.md
    ├── .gitignore
    └── .env.example
```

```bash
cd ~/Documents/work/dismanet/dismanet-app
claude
```

Al terminar el prompt 1 la estructura queda así:

```
dismanet-app/
├── apps/api          Elysia + Prisma      → localhost:3001
├── apps/web          Next.js              → localhost:3000
├── packages/shared   tipos compartidos
└── docker-compose.yml
```

### Antes del prompt 1

1. Tener **Bun** y **PostgreSQL 16+** disponibles (Postgres puede ir por Docker; el prompt 1 crea el `docker-compose.yml`).
2. `cp .env.example .env` y generar las dos claves:
   ```bash
   openssl rand -hex 32   # JWT_SECRET
   openssl rand -hex 32   # CLAVE_CIFRADO
   ```
3. Guardar `CLAVE_CIFRADO` fuera del repositorio. Si se pierde, las contraseñas de las cuentas y los pines quedan irrecuperables.

El repositorio ya está inicializado en `main`, con `.gitignore` que excluye `.env`. No commitear nada antes de revisar que `git status` no liste archivos de entorno.

---

## Prompt 1 — Andamiaje, esquema y seed

> **Estado:** listo para ejecutar
> **Verificable al terminar:** la base de datos existe con todas las tablas, el seed crea un SUPER_ADMIN y una empresa de prueba con catálogo.

```
Lee PRD-MVP-Ventas.md y CLAUDE.md antes de empezar. Son la especificación
completa del proyecto.

Vas a montar el andamiaje del monorepo y el esquema de datos. NO construyas
todavía autenticación, endpoints de negocio ni interfaz: solo la base.

## 1. Monorepo

Crea la estructura con workspaces de Bun:

  /
  ├── apps/api          Elysia + Prisma
  ├── apps/web          Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
  ├── packages/shared   tipos y constantes compartidos
  ├── package.json      workspaces
  ├── .env.example
  └── docker-compose.yml   PostgreSQL 16 para desarrollo local

En apps/api deja un servidor Elysia mínimo con un endpoint GET /salud que
responda { ok: true }. En apps/web deja el proyecto Next.js inicializado con
Tailwind y shadcn/ui configurados, sin pantallas todavía.

## 2. Verificación previa obligatoria

Antes de escribir el esquema, confirma que el CLI de Prisma funciona en este
entorno. El CLI tiene problemas bajo Bun (prisma/prisma#28805), así que los
comandos van con Node: `npx prisma ...`. Ejecuta `npx prisma init` y
`npx prisma generate` y confirma que ambos terminan sin error antes de seguir.
Si fallan, detente y repórtalo en vez de buscar un rodeo.

## 3. Esquema de Prisma

Implementa exactamente el modelo de la sección 4 del PRD. Son catorce entidades:
Empresa, Usuario, Plataforma, Duracion, TipoCliente, Paquete, PaquetePlataforma,
PaqueteDuracionPlataforma, Precio, Cuenta, Pantalla, Venta, VentaDetalle,
PlantillaMensaje.

Reglas del esquema:
- Todos los montos con tipo Decimal, nunca Float.
- Índice en empresaId en todas las tablas que lo tengan.
- Enums: Rol (SUPER_ADMIN | ADMIN | VENDEDOR), UnidadDuracion (DIAS | MESES),
  TipoVenta (UNIDAD | PAQUETE), TipoPlantilla (UNIDAD | PAQUETE).
- Duracion lleva cantidad + unidad, no un campo "dias".
- Precio sirve tanto para plataformas como para paquetes: plataformaId y
  paqueteId son ambos nullable, con un CHECK que obliga a que exactamente uno
  esté presente. Dos restricciones únicas:
    (empresaId, plataformaId, duracionId, tipoClienteId)
    (empresaId, paqueteId, duracionId, tipoClienteId)
  El CHECK va como migración SQL manual, Prisma no lo expresa en el esquema.
- PaquetePlataforma: único sobre (paqueteId, plataformaId), con cantidadPantallas
  por defecto 1.
- PaqueteDuracionPlataforma: único sobre (paqueteId, duracionVendidaId,
  plataformaId). Solo lleva filas donde la duración real DIFIERE de la vendida.
- Pantalla: único sobre (cuentaId, numero). Lleva perfil y pin, ambos nullable.
- Venta: único sobre (empresaId, codigoCompra).
- PlantillaMensaje: único sobre (empresaId, tipo).
- Usuario.email único global. Usuario.empresaId nullable, solo nulo para SUPER_ADMIN.
- Venta guarda los IDs de referencia Y las copias de nombres y valores
  (nombreItem, nombreDuracion, cantidadDuracion, unidadDuracion,
  nombreTipoCliente, precioVenta, costo, utilidad, mensajeGenerado).
- VentaDetalle guarda SU PROPIA duracionId, cantidadDuracion, unidadDuracion y
  fechaVencimiento, más copia de nombrePlataforma, correoCuenta, passwordCuenta,
  perfil y pin. Esto es la regla R5: un combo puede vencer en fechas distintas
  según la plataforma.
- Venta.fechaVencimientoMax es un valor derivado solo para filtrar y ordenar.
  Documenta en el esquema que NO debe usarse para calcular disponibilidad.
- Las entidades de catálogo llevan campo activa/activo. No hay borrado físico.

Genera la migración inicial con `npx prisma migrate dev --name esquema_inicial`.

## 3b. Cálculo de vencimiento

Crea apps/api/src/lib/duracion.ts con una función
calcularVencimiento(fechaVenta, cantidad, unidad) que use date-fns:
addDays para DIAS, addMonths para MESES.

Escribe pruebas unitarias de los casos de borde de meses:
- 31 de enero + 1 mes = 28 de febrero (29 en año bisiesto)
- 31 de marzo + 1 mes = 30 de abril
- 15 de junio + 3 meses = 15 de septiembre
- 1 de enero + 12 meses = 1 de enero del año siguiente

## 3c. Fecha en letras

Crea apps/api/src/lib/fecha-en-letras.ts con una función que convierta una fecha
en texto español: "Veintisiete de septiembre". Día en palabras, mes en palabras,
primera letra en mayúscula, sin año. Pruebas para los 31 días y los 12 meses.

## 4. Cifrado de datos sensibles

Cuenta.password, Pantalla.pin y sus copias en VentaDetalle deben poder mostrarse
al vendedor, así que van cifrados de forma reversible, NO hasheados.

Implementa en apps/api/src/lib/cifrado.ts dos funciones, cifrar() y descifrar(),
con AES-256-GCM. La clave sale de la variable de entorno CLAVE_CIFRADO (32
bytes en hex). Documenta en .env.example cómo generarla y advierte que si se
pierde, los datos cifrados son irrecuperables.

Las contraseñas de USUARIOS son distintas: esas van con Argon2id y son hash,
no cifrado. No confundir las dos.

## 4b. Código de compra

Crea apps/api/src/lib/codigo-compra.ts con una función que genere el código:
Empresa.prefijoCodigo (3 letras) + 6 dígitos aleatorios, ej. DIS995865.

La función recibe el cliente de transacción, verifica unicidad contra
(empresaId, codigoCompra) y reintenta hasta 5 veces si colisiona. Si agota los
intentos, lanza error: no devuelvas un código duplicado bajo ninguna
circunstancia.

## 5. Seed

Crea apps/api/prisma/seed.ts que genere:

- Un SUPER_ADMIN con empresaId nulo. Correo y contraseña desde variables de
  entorno, con valores por defecto para desarrollo.
- Una empresa "DISMANET" activa.
- Un ADMIN de esa empresa.
- Un VENDEDOR de esa empresa.
- Un SUPER_ADMIN, una empresa "DISMANET" con prefijoCodigo "DIS", un ADMIN y
  un VENDEDOR de esa empresa.
- Tipos de cliente: Cliente normal, Revendedor, Promoción.

Todo lo demás sale del ANEXO A del PRD, que trae el catálogo real del cliente.
Cárgalo tal cual, sin inventar valores:

- Las 7 duraciones de A.1
- Las 16 plataformas de A.2, con sus condiciones y su bandera usaPerfilPin.
  capacidadPantallas va en 1 porque el cliente aún no la entregó; déjalo
  anotado con un comentario en el seed.
- Los 18 precios individuales de A.3, para el tipo de cliente "Cliente normal".
  El costo va en 0: el cliente todavía no entregó la tabla de costos. Deja un
  comentario en el seed diciéndolo.
- Los 6 paquetes de A.4 con sus filas de PaquetePlataforma.
- Los 11 precios de paquete de A.5, con sus filas de PaqueteDuracionPlataforma
  para las excepciones "Netflix → 28 días". Son 5 excepciones en total.
- Dos cuentas de ejemplo por plataforma, con sus pantallas generadas. Para las
  plataformas con usaPerfilPin, asigna perfil A, B, C... y un PIN aleatorio de
  4 dígitos por pantalla.
- Las dos plantillas de mensaje, UNIDAD y PAQUETE, con el texto exacto del
  ANEXO B del PRD.

El seed debe ser idempotente: correrlo dos veces no debe duplicar nada ni fallar.

Al terminar, verifica con una consulta que el paquete "Básico 1" vendido a la
duración "30 días" resuelve Netflix a 28 días y Disney+ Premium a 30 días.

## 6. Entregable

Al terminar reporta:
- El comando exacto para levantar todo desde cero (base de datos, migraciones,
  seed, api y web).
- Las credenciales sembradas.
- Confirmación de que `npx prisma studio` muestra las tablas con datos.
```

---

## Prompt 2 — Autenticación, roles y aislamiento por empresa

> **Estado:** listo para ejecutar, depende del prompt 1
> **Verificable al terminar:** login funciona para los tres roles; un usuario de la empresa A no puede leer datos de la empresa B por ningún medio.

```
Lee PRD-MVP-Ventas.md y CLAUDE.md. Continúa sobre lo construido en la entrega
anterior.

Esta entrega es la base de seguridad de todo el producto. La regla R1 del
CLAUDE.md (aislamiento entre empresas) es lo más importante que vas a escribir
en el proyecto: un fallo ahí filtra los datos de un cliente a otro.

## 1. Autenticación en el API

- POST /auth/login  → recibe email y contraseña, valida con Argon2id, responde
  con los datos del usuario y su empresa, y fija un JWT en cookie httpOnly,
  SameSite=Lax, Secure en producción, vigencia 7 días.
- POST /auth/logout → limpia la cookie.
- GET  /auth/yo     → devuelve el usuario autenticado y su empresa activa.

El JWT lleva: usuarioId, rol, empresaId. Nada más — ningún dato que pueda
quedar obsoleto.

Reglas de login:
- Usuario inactivo: rechazar.
- Empresa inactiva: rechazar a todos sus usuarios.
- Credenciales incorrectas: mensaje genérico, sin revelar si el correo existe.

## 2. Contexto de petición

Crea un plugin de Elysia que resuelva en cada petición autenticada:
{ usuarioId, rol, empresaId }

Para un SUPER_ADMIN, empresaId sale de una cookie aparte, "empresa_activa",
que indica en qué empresa está operando. Si no la tiene, empresaId queda nulo
y solo puede usar los endpoints de plataforma.

## 3. Extensión de aislamiento de Prisma (R1)

Crea apps/api/src/lib/prisma-empresa.ts que exporte una función
prismaParaEmpresa(empresaId) devolviendo un cliente Prisma extendido con
$extends que:

- inyecta where.empresaId en findMany, findFirst, findUnique, update,
  updateMany, delete, deleteMany, count y aggregate
- inyecta data.empresaId en create y createMany
- se aplica a LOS TRECE modelos que tienen empresaId, sin omitir ninguno:
    Usuario, Plataforma, Duracion, TipoCliente, Paquete, PaquetePlataforma,
    PaqueteDuracionPlataforma, Precio, Cuenta, Pantalla, Venta, VentaDetalle,
    PlantillaMensaje
  Empresa queda fuera porque no tiene empresaId.
  Deriva la lista leyendo el esquema de Prisma en vez de escribirla a mano:
  cualquier modelo futuro con empresaId debe quedar cubierto automáticamente.
  Un modelo omitido aquí es una fuga de datos entre clientes.
- lanza un error si se invoca con empresaId nulo o indefinido

Cuidado con Usuario: su empresaId es nullable porque el SUPER_ADMIN no
pertenece a ninguna empresa. La extensión lo filtra igual, y eso es lo
correcto: un ADMIN no debe ver al SUPER_ADMIN en su listado de usuarios. El
login resuelve al SUPER_ADMIN con prismaRaw, antes de conocer la empresa.

El cliente sin extender se exporta como prismaRaw y solo puede usarse en el
seed y en el login. Deja un comentario explícito en prismaRaw diciéndolo.

Los handlers de negocio NUNCA importan prismaRaw.

## 4. Guardas de rol (R4)

Crea helpers de Elysia: requiereAutenticacion, requiereRol('ADMIN'),
requiereRol('SUPER_ADMIN'). Se aplican a nivel de ruta, no dentro del handler.

## 5. Frontend

- Página /login con formulario de correo y contraseña.
- Middleware de Next.js que redirige a /login si no hay sesión.
- Layout autenticado con la información del usuario y botón de cerrar sesión.
- Redirección por rol tras el login: VENDEDOR va a /vender (déjala como
  marcador de posición), ADMIN y SUPER_ADMIN van a /panel.
- Configura Eden Treaty para consumir el API con tipos extremo a extremo.

## 6. Pruebas obligatorias

Escribe pruebas automatizadas, no verificación manual:

a) Aislamiento: crea dos empresas con datos en LAS TRECE tablas que tienen
   empresaId. Autentica como usuario de la empresa A y verifica, tabla por
   tabla, que toda consulta devuelve cero registros de la empresa B. Incluye el
   intento de leer un registro de B por su id directo: debe responder no
   encontrado, no el registro.

   La prueba debe recorrer la lista de modelos derivada del esquema, no una
   lista escrita a mano, para que un modelo nuevo sin cubrir haga fallar la
   prueba en vez de pasar inadvertido.

b) Escalada de rol: un VENDEDOR autenticado recibe 403 en todo endpoint de
   ADMIN. Un ADMIN recibe 403 en todo endpoint de SUPER_ADMIN.

c) Login: usuario inactivo rechazado, empresa inactiva rechazada, contraseña
   incorrecta rechazada con mensaje genérico.

## 7. Entregable

Reporta el resultado de las pruebas y confirma explícitamente que la prueba (a)
pasa, nombrando las trece tablas verificadas. Si no pasa, no consideres
terminada la entrega.

## 8. Limpieza previa

Antes de empezar, agrega al .gitignore de la raíz las carpetas que generó
`prisma init` en la entrega anterior, para que no entren al repositorio:

  apps/api/.agents/
  apps/api/.windsurf/
  apps/api/.claude/
  apps/api/skills-lock.json

No las borres: basta con ignorarlas.
```

---

## Prompt 3 — Empresas y usuarios

> **Estado:** listo para ejecutar, depende del prompt 2
> **Verificable al terminar:** el SUPER_ADMIN crea una empresa con su admin; ese admin crea vendedores; un admin que crea otra empresa no puede ver nada de ella.

```
Lee PRD-MVP-Ventas.md y CLAUDE.md. Continúa sobre lo construido en la entrega
anterior.

Esta entrega tiene tres partes: dos correcciones de la entrega 2, y luego el
CRUD de empresas y usuarios.

## 1. Corrección: blindar prismaRaw con una prueba

Hoy la regla "los handlers de negocio no usan prismaRaw" es una convención
escrita en CLAUDE.md. Conviértela en una prueba que falle si alguien la rompe.

Escribe una prueba que recorra el código fuente de apps/api, recolecte todos los
archivos que importan prismaRaw y compare ese conjunto contra una lista blanca
explícita declarada dentro de la misma prueba. Si aparece un archivo nuevo, la
prueba falla con un mensaje que diga por qué existe la regla.

La lista blanca en este momento es:
  - prisma/seed.ts
  - las rutas de autenticación (login y /auth/yo)
  - las rutas de empresas que leen o escriben la tabla Empresa

Cada uso de prismaRaw debe llevar arriba un comentario de una línea explicando
por qué no puede ir por el cliente extendido.

## 2. Corrección: control de rol por ruta en el frontend

Hoy (protegido)/layout.tsx solo valida autenticación, así que un VENDEDOR puede
cargar /panel. Sepáralo en grupos de rutas anidados:

  app/(protegido)/layout.tsx              → solo valida sesión
  app/(protegido)/(admin)/layout.tsx      → exige ADMIN o SUPER_ADMIN
  app/(protegido)/(admin)/panel/...
  app/(protegido)/(vendedor)/layout.tsx   → exige VENDEDOR, ADMIN o SUPER_ADMIN
  app/(protegido)/(vendedor)/vender/...

Un rol insuficiente redirige a la pantalla que sí le corresponde, no a /login:
al VENDEDOR se le manda a /vender. Recuerda que SUPER_ADMIN satisface también
las guardas de ADMIN, por jerarquía, tal como ya funciona en el API.

Esto no es control de acceso real — ese vive en el servidor (R4) — es evitar que
un vendedor vea pantallas rotas.

## 3. Gestión de empresas

Endpoints y pantallas, respetando la sección 5.2 del PRD.

SUPER_ADMIN:
- Listar todas las empresas con nombre, prefijo de código, estado y número de
  usuarios activos
- Crear empresa: nombre, nit opcional, prefijoCodigo de exactamente 3 letras
  mayúsculas, más el nombre, correo y contraseña de su primer ADMIN. Todo en
  una sola transacción: si falla la creación del usuario, no queda la empresa.
- Activar y desactivar una empresa
- Entrar a una empresa: fija la cookie empresa_activa y lo deja operando dentro
  de ella. Un botón para salir la limpia.

ADMIN:
- Crear una empresa nueva con su primer ADMIN, mismo formulario
- **No obtiene ningún acceso a la empresa que creó** (decisión D2 del PRD). Se
  registra quién la creó en Empresa.creadaPorUsuarioId, solo para trazabilidad.

Reglas:
- prefijoCodigo único entre todas las empresas, 3 letras A-Z
- La tabla Empresa no tiene empresaId, así que se accede con prismaRaw. Es uno
  de los usos autorizados de la lista blanca del punto 1.
- El primer ADMIN de la empresa nueva SÍ se crea con
  prismaParaEmpresa(nuevaEmpresa.id) dentro de la misma transacción, no con
  prismaRaw. El cliente extendido debe aceptar el id de una empresa recién
  creada dentro de la transacción.

## 4. Gestión de usuarios

ADMIN, dentro de su empresa (sección 5.3 del PRD):
- Listar usuarios con nombre, correo, rol y estado
- Crear usuario: nombre, correo, contraseña inicial, rol (ADMIN o VENDEDOR).
  Un ADMIN no puede crear un SUPER_ADMIN.
- Desactivar y reactivar
- Cambiar el rol de un usuario

Reglas de negocio, todas validadas en el servidor:
- Un usuario no puede desactivarse a sí mismo
- Un usuario no puede cambiarse el rol a sí mismo
- Una empresa no puede quedarse sin ningún ADMIN activo: se bloquea tanto la
  desactivación del último admin como el cambio de su rol a VENDEDOR
- El correo es único global; el error debe decirlo de forma clara

## 5. Pruebas obligatorias

a) Lista blanca de prismaRaw: la prueba del punto 1 pasa, y falla si se agrega
   un import en un archivo no autorizado (verifícalo temporalmente y revierte).

b) Aislamiento tras crear empresa (D2): el ADMIN de la empresa A crea la
   empresa B. Luego, autenticado como ese mismo admin, intenta leer usuarios,
   cuentas y ventas de B y recibe cero registros. Es la prueba de que crear una
   empresa no otorga acceso a ella.

c) Última cuenta de administrador: con un solo ADMIN activo en la empresa,
   desactivarlo devuelve error, y cambiarle el rol a VENDEDOR también. Con dos
   ADMIN activos, ambas operaciones funcionan.

d) Auto-modificación: un usuario recibe error al intentar desactivarse o
   cambiarse el rol a sí mismo.

e) Transacción de creación de empresa: si la creación del primer ADMIN falla
   (por ejemplo, correo duplicado), no queda ninguna empresa huérfana en la
   base.

f) Un ADMIN recibe 403 al intentar crear un usuario con rol SUPER_ADMIN.

## 6. Entregable

Reporta el resultado de las seis pruebas y el conteo total. Confirma
explícitamente que la prueba (b) pasa: es la que sostiene la decisión D2 y la
que hace vendible el producto como plataforma.
```

---

## Prompt 4 — Catálogo: plataformas, duraciones y tipos de cliente

> **Estado:** listo para ejecutar, depende del prompt 3
> **Verificable al terminar:** el ADMIN configura su catálogo completo desde la interfaz, con duraciones en días y en meses.

```
Lee PRD-MVP-Ventas.md y CLAUDE.md. Continúa sobre lo construido en la entrega
anterior.

## 1. Primero: auditar el manejo de P2002 en todo el código

En la entrega anterior se descubrió que con @prisma/adapter-pg el nombre de la
restricción violada NO viaja en error.meta.target sino en
error.meta.driverAdapterError.cause.constraint.index, y se creó el helper
restriccionViolada() para cubrir ambas formas.

Ese hallazgo es más grande que el archivo donde apareció. Antes de escribir
código nuevo:

- Extrae restriccionViolada() a un módulo compartido de la capa de errores si
  todavía vive dentro de empresas.ts.
- Busca en todo apps/api cualquier lectura de meta.target, cualquier catch de
  P2002 y cualquier introspección de errores de Prisma. Reemplázalos por el
  helper.
- Escribe una prueba de integración que provoque una violación real de
  restricción única contra la base y afirme que restriccionViolada() la
  identifica por nombre. Debe correr contra el driver real, no contra un error
  simulado a mano: el objetivo es que si mañana cambia el adaptador o la versión
  de Prisma, la prueba avise.

Deja anotado en CLAUDE.md, si no está ya, que ninguna restricción única nueva
puede manejarse leyendo meta.target.

## 2. Restricciones únicas de catálogo que faltan

El esquema no impide hoy crear dos plataformas llamadas "Netflix" en la misma
empresa. Agrega, como migración SQL manual, un índice único PARCIAL sobre los
registros activos en:

  Plataforma   (empresaId, nombre) donde activa = true
  Duracion     (empresaId, nombre) donde activa = true
  TipoCliente  (empresaId, nombre) donde activo = true
  Paquete      (empresaId, nombre) donde activo = true

Debe ser parcial: si el admin desactiva "Netflix" y más adelante crea otra
plataforma con ese nombre, no puede chocar contra la desactivada. Prisma no
expresa índices parciales en el esquema, así que va como SQL en la migración.

Los errores de estas restricciones se manejan con restriccionViolada() del
punto 1.

## 3. CRUD de plataformas

Solo ADMIN. Sección 5.4 del PRD.

Campos:
- nombre (obligatorio)
- nombreMensaje (opcional) — nombre decorado para el mensaje de WhatsApp,
  ej. "N.E.T.F.L.I.X". Si está vacío se usa nombre.
- condiciones (opcional, texto) — se le muestra al vendedor antes de vender,
  ej. "1 pantalla, solo TV. Incluye ESPN y Hulu"
- capacidadPantallas (entero >= 1)
- usaPerfilPin (booleano)

**Aclaración importante sobre capacidadPantallas.** Es el valor POR DEFECTO que
se propone al crear una cuenta nueva de esa plataforma. Cambiarlo NO modifica
las cuentas ya existentes: cada Cuenta tiene su propia capacidadPantallas. La
interfaz debe decirlo con una línea de ayuda bajo el campo, o el admin va a
creer que subir el número le crea pantallas.

## 4. CRUD de duraciones

Campos: nombre, cantidad (entero > 0), unidad (DIAS o MESES).

La interfaz muestra una vista previa del cálculo mientras se edita: para
"3 meses" con unidad MESES, algo como "una venta del 31 de enero vencería el
30 de abril". Usa la utilidad de cálculo de vencimiento ya existente. Esto hace
visible el comportamiento de recorte de fin de mes antes de que sorprenda en
producción.

## 5. CRUD de tipos de cliente

Campos: nombre. Nada más.

## 6. Reglas transversales de catálogo

- **No existe borrado.** No crees endpoints DELETE. Solo activar y desactivar.
- **Advertencia al desactivar.** Antes de desactivar una plataforma, duración o
  tipo de cliente, el API devuelve cuántas filas de Precio activas quedarían
  inservibles y a qué paquetes afecta. La interfaz lo muestra como confirmación:
  "Al desactivar '30 días' quedan 14 precios sin poder venderse". No lo bloquees,
  solo que el admin sepa lo que hace.
- **Editar no rompe el histórico.** Cambiar el nombre o la cantidad de una
  duración es válido: las ventas pasadas guardan copia (R3) y no se alteran.
  Verifícalo con una prueba.
- Validación en el servidor con esquemas de Elysia, no solo en el formulario.

## 7. Interfaz

Tres pantallas bajo (admin)/panel: /catalogo/plataformas, /catalogo/duraciones,
/catalogo/tipos-cliente, con la nav correspondiente. Mismo patrón que las
pantallas de empresas y usuarios de la entrega anterior.

Listado con estado visible, filtro de activos e inactivos, formulario de alta y
edición, y acción de activar/desactivar con la confirmación del punto 6.

## 8. Pruebas obligatorias

a) restriccionViolada() identifica por nombre una violación real contra la base
   con el driver actual.
b) Crear dos plataformas activas con el mismo nombre en la misma empresa falla
   con un error de negocio claro, no con un 500.
c) Desactivar una plataforma y crear otra con el mismo nombre funciona.
d) Dos empresas distintas pueden tener cada una su plataforma "Netflix".
e) Editar el nombre y la cantidad de una duración no altera los valores copiados
   en ventas ya registradas.
f) Un VENDEDOR recibe 403 en todos los endpoints de catálogo.
g) cantidad = 0, cantidad negativa y capacidadPantallas = 0 son rechazadas por
   validación.

## 9. Entregable

Reporta el resultado de las pruebas, cuántos usos de meta.target encontraste y
reemplazaste en el punto 1, y el conteo total de pruebas.
```

---

## Prompt 5 — Paquetes, composición y excepciones de duración

> **Estado:** listo para ejecutar, depende del prompt 4
> **Verificable al terminar:** el admin abre "Básico 1" y ve que a 30 días Netflix va con 28 y Disney+ Premium con 30, igual que lo sembró el seed.

```
Lee PRD-MVP-Ventas.md y CLAUDE.md. Continúa sobre lo construido en la entrega
anterior.

Esta entrega construye los paquetes. Es la última pieza de configuración antes
de los precios, y produce una función que la entrega 8 va a consumir
directamente, así que la calidad de esa función importa más que la interfaz.

## 1. Deuda de la entrega anterior

a) tipos-cliente valida que el nombre no exista y luego inserta. Eso es una
   condición de carrera: dos peticiones simultáneas pasan ambas la validación y
   una revienta con 500 contra la restricción única. Agrega el manejo de P2002
   con restriccionViolada(), como ya lo tienen los otros routers. Validar antes
   está bien, pero no reemplaza manejar la colisión.

b) Revisa que app-compuesta.test.ts cubra todas las rutas existentes, y agrega
   las de esta entrega. Recuerda la regla: un router que no esté ahí puede tener
   una fuga de hooks que las pruebas aisladas no ven.

## 2. CRUD de paquetes

Solo ADMIN. Sección 5.5 del PRD.

Campos del paquete: nombre, descripcion (opcional), activo.
La restricción única parcial sobre (empresaId, nombre) donde activo = true ya
existe desde la entrega 4.

## 3. Composición del paquete

Cada paquete tiene N filas de PaquetePlataforma: plataforma + cantidadPantallas
(por defecto 1).

Reglas:
- Una plataforma no puede repetirse dentro del mismo paquete; para pedir dos
  pantallas de la misma plataforma se sube cantidadPantallas, no se agrega otra
  fila. La restricción única (paqueteId, plataformaId) ya lo impide — manéjala
  con restriccionViolada().
- cantidadPantallas >= 1.
- Solo se pueden agregar plataformas activas.
- **Un paquete sin plataformas no se puede activar.** Si está activo y se intenta
  quitar su última plataforma, se rechaza con un error de negocio claro.
- Quitar una plataforma de la composición elimina también sus excepciones de
  duración (punto 4). Hazlo en la misma transacción.

## 4. Excepciones de duración — el corazón de esta entrega

Por defecto, todas las plataformas de un paquete usan la duración con la que se
vendió el paquete. La tabla PaqueteDuracionPlataforma guarda únicamente las
excepciones, es decir los casos donde una plataforma usa una duración distinta.

El caso real de DISMANET: "Básico 1" vendido a 30 días lleva Netflix a 28 días y
Disney+ Premium a 30. Esa fila ya existe en el seed, junto con otras cuatro.

### Interfaz

Dentro del detalle del paquete, una matriz:
- Filas: las duraciones activas de la empresa
- Columnas: las plataformas que componen el paquete
- Cada celda: un selector que por defecto dice "igual a la vendida" y permite
  elegir cualquier otra duración activa

Elegir una duración distinta crea la fila; volver a "igual a la vendida" la
elimina. Nunca se guarda una fila donde duracionReal = duracionVendida.

La matriz debe cargar correctamente las 5 excepciones que ya sembró el seed: al
abrir "Básico 1", la fila de 30 días debe mostrar Netflix = "28 días" y
Disney+ Premium = "igual a la vendida".

### Validaciones

- duracionRealId distinta de duracionVendidaId (si son iguales, se borra la fila)
- Ambas duraciones activas
- La plataforma debe pertenecer a la composición del paquete
- Si la duración real es MAYOR que la vendida, guárdala igual pero muestra una
  advertencia: "estás entregando más tiempo del que vendes". En los datos reales
  la excepción siempre es menor, así que lo contrario suele ser un error de
  digitación.

## 5. La función que consume la entrega 8

Crea en la capa de servicios del API:

  resolverComposicionDePaquete(paqueteId, duracionVendidaId)

Devuelve, para cada plataforma del paquete:
  { plataformaId, nombrePlataforma, cantidadPantallas,
    duracionId, cantidadDuracion, unidadDuracion }

donde la duración es la excepción si existe, y la vendida en caso contrario.

Esta función es la que la venta rápida va a usar para saber cuántas pantallas
tomar de cada plataforma y con qué vencimiento. Escríbela con cuidado y pruébala
a fondo: un error aquí se traduce en cuentas entregadas con la vigencia
equivocada.

## 6. Disponibilidad de un paquete

Crea también:

  paquetesDisponibles(duracionVendidaId, tipoClienteId)

Devuelve los paquetes activos que, para esa combinación, tienen suficientes
pantallas libres en TODAS sus plataformas componentes. Por ahora la
disponibilidad se calcula contra el inventario existente; la entrega 7 la
afinará cuando las cuentas tengan capacidades reales.

No filtres todavía por existencia de precio: eso entra en la entrega 6.

## 7. Advertencia al desactivar una plataforma

La entrega 4 ya avisa cuántos precios quedan inservibles al desactivar una
plataforma. Ahora los paquetes también dependen de ellas: extiende esa
advertencia para que incluya qué paquetes quedarían sin poder venderse.

## 8. Interfaz

Bajo (admin)/panel/catalogo/paquetes: listado y detalle.

El listado muestra la composición en una línea, con las duraciones reales
cuando difieren de la vendida. Ejemplo para "Básico 1" a 30 días:

  Netflix 28d · Disney+ Premium 30d

Si no hay excepciones para esa duración, basta con los nombres.

## 9. Pruebas obligatorias

a) resolverComposicionDePaquete("Básico 1", "30 días") devuelve Netflix con
   28 días y Disney+ Premium con 30. Prueba también "Básico 1" a 14 días, donde
   no hay excepción y ambas deben dar 14.
b) Las cinco excepciones del seed se resuelven correctamente, una por una.
c) Un paquete activo no puede quedarse sin plataformas.
d) Quitar una plataforma de la composición elimina sus excepciones.
e) Guardar una excepción con duracionReal = duracionVendida no crea fila; si
   existía, la borra.
f) Agregar dos veces la misma plataforma a un paquete devuelve error de negocio,
   no 500.
g) Dos peticiones simultáneas creando el mismo tipo de cliente devuelven una
   creación y un error de negocio, no un 500 (deuda del punto 1a).
h) Un VENDEDOR recibe 403 en todos los endpoints de paquetes.
i) app-compuesta.test.ts pasa con el router de paquetes montado.

## 10. Entregable

Reporta el resultado de las pruebas y el conteo total. Confirma explícitamente
que (a) y (b) pasan: esa función es la que decide con qué vigencia se entrega
cada cuenta en la venta real.
```

---

## Prompt 6 — Matriz de precios de unidades y paquetes

> **Estado:** listo para ejecutar, depende del prompt 5
> **Verificable al terminar:** el admin define precios en ambas pestañas y ve la advertencia cuando el costo de un paquete no coincide con la suma de sus componentes.

```
Lee PRD-MVP-Ventas.md y CLAUDE.md. Continúa sobre lo construido en la entrega
anterior.

## 1. Primero y más importante: cerrar el hueco del upsert

En la entrega anterior se descubrió que prismaParaEmpresa no envuelve upsert.
Se resolvió el caso puntual cambiando el código que lo usaba, pero **el hueco
sigue abierto**: cualquier código futuro que llame .upsert() sobre un modelo con
empresaId va a consultar sin filtro, devolver datos, y devolver los de todas las
empresas sin que nada falle.

Un parche en el sitio donde apareció no es una corrección. Audita la cobertura
completa:

a) Enumera todas las operaciones de Prisma sobre modelos con empresaId:
   findUnique, findUniqueOrThrow, findFirst, findFirstOrThrow, findMany,
   create, createMany, createManyAndReturn, update, updateMany,
   updateManyAndReturn, upsert, delete, deleteMany, count, aggregate, groupBy.

b) Para cada una, define si la extensión la envuelve o la bloquea. No puede
   quedar ninguna en "no se usa todavía": la de mañana es la fuga de pasado
   mañana.

c) upsert se BLOQUEA, no se envuelve: su where exige un selector único que no
   siempre admite empresaId, así que filtrarlo correctamente no es posible en
   general. Debe lanzar un error explícito que diga qué usar en su lugar
   (findFirst + create/update con manejo de P2002). Un error ruidoso es mejor
   que un filtro silenciosamente incorrecto.

d) Extiende la prueba de aislamiento para que recorra el producto completo
   modelos × operaciones, derivando ambas listas del cliente de Prisma y no de
   un arreglo escrito a mano. Si Prisma agrega una operación nueva en una
   versión futura, la prueba debe fallar hasta que alguien decida qué hacer con
   ella.

**Por qué esto va antes que los precios:** aggregate y groupBy son justamente
las operaciones que alimentan los totales del administrador en la entrega 9. Si
no están filtradas, DISMANET ve sumado el dinero de otras empresas. Es la misma
falla que el upsert, con consecuencias peores.

## 2. Verificar el CHECK de Precio

La tabla Precio debe tener una restricción que obligue a que exactamente uno de
plataformaId y paqueteId esté presente. Se especificó como migración SQL manual
en la entrega 1. Confirma que existe y que está activa; si no, créala ahora.

Escribe una prueba que intente insertar una fila con ambos nulos y otra con
ambos presentes, y verifique que la base las rechaza.

## 3. Modelo de edición de la matriz

Cada combinación tiene como mucho UNA fila de Precio en toda la vida del
sistema, porque la restricción única no incluye el campo activo.

- Celda con valores → fila con activo = true
- Celda vaciada → la fila se marca activo = false, NO se borra
- Celda vuelta a llenar → la misma fila se reactiva y se actualiza

Así nunca hay colisión de la restricción única al reactivar, y queda rastro de
lo que se cobró antes.

Una combinación sin fila activa no es vendible y no aparece en el selector de
venta.

## 4. Matriz de unidades

Pestaña "Unidades", un selector de plataforma arriba y una matriz:
- Filas: duraciones activas
- Columnas: tipos de cliente activos
- Cada celda: dos campos, precio de venta y costo

Guardado en lote: enviar solo las celdas modificadas, no la matriz entera.

Validaciones:
- precioVenta > 0
- costo >= 0
- Si costo >= precioVenta, se guarda pero se marca la celda en advertencia
  ("estás vendiendo a pérdida"). No se bloquea: una promoción puede serlo a
  propósito.

## 5. Matriz de paquetes

Pestaña "Paquetes", misma estructura con un selector de paquete.

**Salvaguarda obligatoria del costo (mitiga la decisión D12 del PRD).**

Junto al campo de costo de cada celda, muestra la suma de los costos de las
plataformas que componen el paquete. Para calcular esa suma usa
resolverComposicionDePaquete(paqueteId, duracionId) de la entrega anterior, de
modo que cada plataforma aporte el costo de SU duración real, no la vendida.
Para "Básico 1" a 30 días, la suma debe tomar el costo de Netflix a 28 días y el
de Disney+ Premium a 30.

Si el costo digitado difiere en más de 5% de esa suma, marca la celda en color
de advertencia con el texto "el costo digitado no coincide con la suma de sus
componentes". **Es un aviso, no un bloqueo.**

Si falta el precio de alguna plataforma componente para su duración real, la
suma no se puede calcular: muestra "no calculable" y di cuál falta.

## 6. Aviso de costos en cero

Los costos del catálogo sembrado están todos en 0 porque el cliente aún no
entregó su tabla de costos. Mientras eso siga así, la utilidad de cada venta va
a registrarse igual al precio completo y el panel del administrador mostrará
ganancias infladas.

Muestra un aviso visible en la pantalla de precios cuando existan filas activas
con costo = 0, diciendo cuántas son y qué implica. No lo bloquees: es un estado
legítimo mientras llegan los datos.

## 7. Interfaz

Bajo (admin)/panel/precios, con las dos pestañas. Debe cargar y mostrar
correctamente los 27 precios que ya sembró el seed: 16 individuales y 11 de
paquete.

## 8. Pruebas obligatorias

a) La prueba de aislamiento recorre modelos × operaciones completo y pasa.
b) upsert sobre un modelo con empresaId lanza error explícito.
c) aggregate y groupBy filtran por empresa: una empresa con ventas no ve
   sumados los montos de otra.
d) El CHECK de Precio rechaza ambos nulos y ambos presentes.
e) Vaciar una celda desactiva la fila; volver a llenarla la reactiva sin violar
   la restricción única.
f) La suma de componentes de "Básico 1" a 30 días usa el costo de Netflix a
   28 días, no a 30.
g) Una combinación sin precio activo no aparece como vendible.
h) Un VENDEDOR recibe 403 en todos los endpoints de precios.
i) app-compuesta.test.ts pasa con el router de precios montado.

## 9. Entregable

Reporta el resultado de las pruebas, cuántas operaciones de Prisma quedaron
envueltas y cuántas bloqueadas, y el conteo total de pruebas. Confirma
explícitamente que (c) pasa: es la que protege el dinero del cliente en el panel
de la entrega 9.
```

---

## Prompt 7 — Cuentas, pantallas, perfiles y pines

> **Estado:** listo para ejecutar, depende del prompt 6
> **Verificable al terminar:** crear una cuenta de Netflix genera sus pantallas con perfil y PIN editables, y el listado muestra cuántas están libres.

```
Lee PRD-MVP-Ventas.md y CLAUDE.md. Continúa sobre lo construido en la entrega
anterior.

Esta entrega crea el inventario real. Es la última antes de la venta.

## 1. Capacidades de siembra

El seed puso capacidadPantallas = 1 en las 16 plataformas porque el cliente no
había entregado los valores reales. Con eso solo existen 32 pantallas y ninguna
plataforma tiene 5 libres, así que las pruebas de concurrencia de la entrega 8
no se pueden correr.

Actualiza el seed con capacidades provisionales plausibles, cada una con un
comentario que diga que están pendientes de confirmación del cliente:

  Netflix 5 · Disney+ Premium 4 · Max 3 · Prime Video 3 · Paramount+ 6
  el resto 1

Y sube a cuatro las cuentas de ejemplo por plataforma, para que haya inventario
suficiente donde probar.

## 2. CRUD de cuentas

Solo ADMIN.

Campos: plataforma, correo, password, capacidadPantallas, notas, activa.

- Al crear la cuenta, el sistema genera automáticamente sus N pantallas,
  numeradas de 1 a N.
- Si la plataforma tiene usaPerfilPin = true, cada pantalla recibe un perfil
  propuesto (A, B, C, …) y un PIN aleatorio de 4 dígitos. **Ambos editables**,
  antes y después de guardar.
- Si usaPerfilPin = false, perfil y pin quedan nulos.
- password y pin se guardan cifrados con la utilidad de la entrega 1. No son
  hash: hay que poder mostrarlos.

Cambios de capacidad:
- Subirla genera las pantallas faltantes, continuando la numeración.
- Bajarla solo se permite si las pantallas sobrantes están libres. Si alguna
  está ocupada, se rechaza nombrando cuáles y hasta cuándo.

Nunca se borra una cuenta ni una pantalla: se desactivan.

## 3. Disponibilidad — una sola función

Crea pantallasDisponibles(plataformaId) y úsala en todas partes. Una pantalla
está libre si no existe un VentaDetalle cuya venta esté sin anular y cuyo
VentaDetalle.fechaVencimiento sea mayor que ahora (regla R5).

**Aísla esa lógica en una única función.** Queda abierta la pregunta P1 del PRD:
si las cuentas que compra el cliente tienen fecha de vencimiento propia, habrá
que impedir vender 3 meses en una pantalla de una cuenta a la que le quedan 10
días. Si esa respuesta llega después, debe tocarse un solo lugar.

## 4. Lo que puede ver cada rol

Esto es seguridad, no presentación (R4):

- Los endpoints de cuentas son **solo ADMIN**. El VENDEDOR no tiene acceso a la
  base de correos y contraseñas (decisión D6 del PRD).
- Para el VENDEDOR existe un endpoint aparte, de solo disponibilidad, que
  devuelve únicamente conteos por plataforma: nombre, libres, totales. **Cero
  credenciales en esa respuesta.**
- Ni siquiera para el ADMIN se incluyen password ni pin en los listados. Solo
  aparecen en el detalle de una cuenta y bajo una acción explícita de "ver
  credenciales". Se excluyen en el select de Prisma, no filtrando el objeto
  después.

## 5. Interfaz

Bajo (admin)/panel/cuentas:
- Listado: plataforma, correo, pantallas libres / totales, estado. Filtro por
  plataforma y por estado.
- Detalle: datos de la cuenta y la tabla de sus pantallas con número, perfil,
  PIN, estado y, si está ocupada, hasta cuándo y en qué venta.
- Credenciales ocultas por defecto, con un botón para revelarlas.

## 6. Pruebas obligatorias

a) Crear una cuenta de una plataforma con usaPerfilPin genera N pantallas con
   perfiles A, B, C… y pines de 4 dígitos distintos entre sí.
b) Crear una cuenta de una plataforma sin perfiles deja perfil y pin nulos.
c) password y pin quedan cifrados en la base y se recuperan correctamente.
d) Subir la capacidad genera solo las pantallas faltantes, sin tocar las
   existentes ni reiniciar la numeración.
e) Bajar la capacidad con una pantalla ocupada se rechaza; con todas libres
   funciona.
f) Un VENDEDOR recibe 403 en todos los endpoints de cuentas, y en el endpoint de
   disponibilidad recibe conteos sin ningún campo de credencial.
g) Ningún listado de cuentas incluye password ni pin en la respuesta.
h) app-compuesta.test.ts pasa con el router de cuentas montado.
```

---

## Prompt 8 — Venta rápida, código de compra y mensaje de WhatsApp

> **Estado:** listo para ejecutar, depende del prompt 7
> **Verificable al terminar:** un vendedor completa una venta unitaria y una de paquete, y copia el mensaje listo para WhatsApp.

```
Lee PRD-MVP-Ventas.md y CLAUDE.md. Continúa sobre lo construido en la entrega
anterior.

Esta es la entrega central del proyecto y la que más fácil se rompe en
producción sin que nadie lo note. Lee con cuidado la sección 5.8 del PRD y las
reglas R2, R3 y R5 del CLAUDE.md antes de escribir código.

## 1. Dos huecos de R1 que hay que cerrar ANTES de escribir la venta

Toda la venta ocurre dentro de una transacción con SQL crudo. Esos son
justamente los dos lugares donde el aislamiento por empresa puede no aplicarse,
y la prueba de cobertura actual no ve ninguno de los dos.

### 1a. ¿El cliente de la transacción conserva la extensión?

En la entrega anterior se agregó cuentas.ts a la lista blanca de prismaRaw "solo
para abrir la transacción". Hay que verificar qué significa eso exactamente,
porque si el patrón es:

    prismaRaw.$transaction(async (tx) => { ... })

entonces **tx es un cliente SIN extender**, y todas las operaciones dentro de esa
transacción consultan sin filtro de empresa. No sería un uso acotado de
prismaRaw: sería R1 desactivada en todo el bloque transaccional. Y es invisible
para las pruebas actuales, porque la prueba de cobertura ejerce operaciones
sueltas, nunca dentro de una transacción.

Qué hacer:

- Revisa cómo se abre hoy la transacción en cuentas.ts y en cualquier otro lugar.
- Si prismaParaEmpresa no expone $transaction, es porque el Proxy no lo reenvía.
  Corrígelo: $transaction debe estar disponible en el cliente extendido y el
  `tx` que entrega debe venir extendido también, con el mismo empresaId.
- Si eso no fuera posible, la alternativa es envolver el `tx` con la misma
  extensión dentro del callback. Lo que no es aceptable es operar sobre un `tx`
  crudo.
- Saca cuentas.ts de la lista blanca una vez corregido. Un archivo en la lista
  blanca debe ser una excepción justificada, no una forma de silenciar la regla.

**Extiende la prueba de cobertura para que ejerza cada operación DENTRO de una
transacción**, no solo fuera. Es el mismo error de la lista de modelos y del
upsert: lo que no se enumera, no se cubre.

### 1b. El SQL crudo no está protegido por R1

La asignación de pantallas necesita FOR UPDATE SKIP LOCKED, que Prisma no
expresa en su API. Hay que usar $queryRaw dentro de $transaction.

**$queryRaw NO pasa por la extensión de aislamiento.** El filtro por empresa no
se inyecta solo: tienes que escribir empresaId explícitamente en el WHERE de la
consulta, parametrizado, nunca interpolado.

Encapsula toda la consulta cruda en una sola función, con un comentario que
explique por qué es cruda y que el filtro por empresa es manual. Esa función va
a la lista blanca con su justificación. Escribe una prueba que confirme que
nunca bloquea ni asigna una pantalla de otra empresa.

**Punto ciego de la prueba de cobertura.** La prueba de la entrega anterior
deriva las operaciones del cliente de Prisma, así que cubre las 17 operaciones
de modelo. Pero $queryRaw, $queryRawUnsafe, $executeRaw y $executeRawUnsafe NO
son operaciones de modelo: quedan fuera de esa enumeración por completo. La
prueba va a seguir en verde mientras una consulta cruda lee la base entera sin
filtrar.

Extiende la prueba de lista blanca —la que hoy vigila los imports de
prismaRaw— para que vigile también cualquier uso de $queryRaw, $executeRaw y
sus variantes Unsafe. Mismo mecanismo: un conjunto de archivos autorizados
declarado en la prueba, y falla si aparece uno nuevo. Prohíbe por completo las
variantes Unsafe: no hay ningún caso en este proyecto que las justifique.

## 2. Flujo de la venta

Selector de modo UNIDAD o PAQUETE, y luego:
- Tipo de cliente → duración → plataforma (modo unidad) o paquete (modo paquete)

Qué se ofrece en el tercer paso:
- **Unidad:** plataformas con precio activo para esa combinación Y al menos una
  pantalla libre. Mostrar el contador de disponibles y las condiciones de la
  plataforma.
- **Paquete:** paquetes con precio activo para esa combinación Y suficientes
  pantallas libres en TODAS sus plataformas componentes, según
  resolverComposicionDePaquete. Mostrar la composición con las duraciones reales
  cuando difieran de la vendida.

La función paquetesDisponibles de la entrega 5 se construyó **sin** filtrar por
existencia de precio, porque los precios todavía no existían. Ahora sí existen:
actualiza esa función para que exija precio activo, en vez de crear una segunda
función paralela que haga lo mismo con una condición más.

Se muestra el precio antes de confirmar. El vendedor no puede editarlo nunca.

## 3. La transacción de venta

Todo dentro de una sola transacción:

1. Resolver la composición: una plataforma con cantidad 1 en modo unidad, o
   resolverComposicionDePaquete(paqueteId, duracionId) en modo paquete. Cada
   entrada trae su plataforma, cuántas pantallas y **su duración real**.

2. Recorrer las plataformas **ordenadas por plataformaId ascendente**. El orden
   fijo es obligatorio: sin él, dos ventas de paquetes que comparten plataformas
   se bloquean mutuamente y el sistema se congela.

3. Para cada una, tomar sus pantallas con
   SELECT ... FOR UPDATE SKIP LOCKED LIMIT n, filtrando por empresaId y por la
   condición de disponibilidad de R5.

4. Si alguna plataforma no aporta su cupo completo, **revertir la transacción
   entera** y responder nombrando la plataforma sin inventario. Una venta de
   paquete nunca queda a medias.

5. Generar el código de compra: prefijoCodigo de la empresa + 6 dígitos
   aleatorios, hasta 5 reintentos si colisiona.

   **Trampa conocida:** la colisión se detecta atrapando el P2002, y con
   @prisma/adapter-pg ese error NO trae la restricción en meta.target. Usa
   restriccionViolada(). Si lees la forma equivocada, el reintento nunca se
   dispara y la venta revienta con un 500 justo cuando el vendedor tiene al
   cliente esperando. Escribe la prueba de 100 ventas en paralelo.

6. Crear la Venta con copia de nombres, precio, costo y utilidad (R3).

7. Crear un VentaDetalle por pantalla, **cada uno con su propia duración y su
   propia fechaVencimiento**, calculada con la utilidad de duraciones. Copiar
   nombrePlataforma, correo, password, perfil y pin.

8. Escribir fechaVencimientoMax como el mayor vencimiento de los renglones. Es
   solo para filtrar listados: **nunca** se usa para calcular disponibilidad.

9. Renderizar el mensaje desde la plantilla y guardarlo en Venta.mensajeGenerado.
   Es interpolación de texto, sin entrada ni salida, así que puede ir dentro de
   la transacción sin alargar los bloqueos.

## 4. El mensaje

Renderiza la plantilla UNIDAD o PAQUETE según el modo, con los marcadores de la
sección 5.9 del PRD y el texto del anexo B.

- {{plataforma}} usa nombreMensaje si existe, si no el nombre.
- {{fechaEnLetras}} usa la utilidad de la entrega 1.
- {{listaCuentas}}, en modo paquete, genera un bloque por renglón con la
  plataforma, SU duración real, perfil, PIN, correo y contraseña. Las líneas de
  PERFIL y PIN se omiten cuando la plataforma tiene usaPerfilPin = false.
- Las contraseñas y pines se descifran para el mensaje.

La pantalla muestra el mensaje ya armado con un botón de copiar de un solo clic.

## 5. Pruebas obligatorias

a) **Concurrencia unitaria:** 20 peticiones en paralelo contra una plataforma
   con 5 pantallas libres → exactamente 5 ventas, 15 rechazos, ninguna pantalla
   asignada dos veces.
b) **Concurrencia de paquete:** paquete de 3 plataformas donde una tiene 2
   pantallas libres y las otras 10. Diez peticiones en paralelo → exactamente 2
   ventas, y las 8 fallidas no dejan consumida ninguna pantalla de las otras
   plataformas.
c) **Código de compra:** 100 ventas en paralelo → 100 códigos distintos, ningún
   500.
d) **Vencimiento por renglón:** vender "Básico 1" a 30 días deja el renglón de
   Netflix venciendo a los 28 días y el de Disney+ Premium a los 30. A los 29
   días la pantalla de Netflix vuelve a estar disponible y la de Disney+ no.
e) **Aislamiento del SQL crudo:** la consulta de bloqueo nunca toma una pantalla
   de otra empresa.
f) El mensaje renderizado de una venta unitaria contiene el código, la fecha en
   letras, perfil, PIN, correo y contraseña correctos.
g) El mensaje de un paquete lista una entrada por plataforma con su duración
   real, y omite PERFIL y PIN en las plataformas que no los usan.
h) Sin inventario, el ítem no aparece en el selector y el intento directo de
   vender devuelve un error de negocio claro, no un 500.
i) Un VENDEDOR puede vender; la respuesta de venta no incluye costo ni utilidad.

## 6. Entregable

Reporta el resultado de las nueve pruebas. Confirma explícitamente (a), (b),
(c) y (d): son las cuatro que, si fallan en producción, le entregan al cliente
final una cuenta que no funciona o le cobran dos veces la misma pantalla.
```

---

## Prompt 9 — Listado de ventas, totales y despliegue

> **Estado:** listo para ejecutar, depende del prompt 8
> **Verificable al terminar:** el admin ve sus ventas y totales y busca por código; el vendedor ve solo las suyas sin cifras financieras; el sistema queda desplegado.

```
Lee PRD-MVP-Ventas.md y CLAUDE.md. Es la última entrega del MVP.

## 0. Cerrar lo que quedó sin confirmar de la entrega 8

El reporte de la entrega anterior no menciona estas cuatro cosas. Verifica cada
una y repórtala explícitamente, aunque ya esté hecha.

### 0a. ¿El `tx` de la transacción conserva el aislamiento?

Era el punto 1a del prompt anterior. Confirma por inspección del código:

- Cómo se abre la transacción de la venta y la de cuentas.
- Si el `tx` que entrega viene extendido con el `empresaId` correcto.
- Si `cuentas.ts` salió de la lista blanca de prismaRaw.
- Si la prueba de cobertura ejerce las operaciones DENTRO de una transacción,
  no solo fuera.

Si alguna no se hizo, hazla ahora. Es la diferencia entre R1 activa y R1 apagada
en todo el camino de la venta.

### 0b. Aislamiento del SQL crudo

La prueba (e) del prompt anterior —que la consulta de bloqueo nunca toma una
pantalla de otra empresa— no aparece en el reporte. Confírmala o escríbela.

Confirma también que la lista blanca vigila `$queryRaw` y `$executeRaw`, y que
las variantes `Unsafe` están prohibidas.

### 0c. El reintento del código de compra nunca se ejerció

La prueba de 30 ventas en paralelo demuestra que no hubo colisión. No demuestra
que el reintento funcione: con 6 dígitos aleatorios, 30 ventas tienen una
probabilidad de colisión cercana a cero, así que esa rama de código
probablemente nunca se ejecutó.

Escribe una prueba que **fuerce** la colisión: inyecta o sustituye el generador
de dígitos para que devuelva el mismo valor dos veces seguidas, con una venta ya
existente que use ese código. La prueba debe verificar que la segunda venta
reintenta, obtiene un código distinto y se completa.

Es justo la rama que depende de detectar el P2002 con `restriccionViolada()`. Si
se lee la forma equivocada, el reintento no se dispara y la venta revienta con
500 — y hoy no hay nada que lo detecte.

Agrega también el caso contrario: si se agotan los 5 intentos, debe lanzar un
error claro, nunca devolver un código repetido.

### 0d. La pantalla se libera en su propia fecha

La verificación manual confirmó que "Básico 1" a 30 días guarda Netflix a 28
días y Disney+ a 30. Falta la prueba automatizada de la consecuencia: que al día
29 la pantalla de Netflix esté disponible otra vez y la de Disney+ no.

Es lo que convierte la regla R5 en inventario revendible. Escríbela
manipulando la fecha de la venta hacia atrás, no esperando.

## 1. Listado para el ADMIN

Todas las ventas de la empresa: código de compra, fecha, vendedor, tipo, ítem
vendido, duración, tipo de cliente, precio, costo, utilidad, cuentas asignadas
con su vencimiento individual, y el mensaje generado.

Filtros: rango de fechas, vendedor, tipo de venta, plataforma o paquete, y
**búsqueda por código de compra**, que es como el cliente final va a pedir
soporte.

Totales de hoy, esta semana y este mes: número de ventas, ingresos, costos y
utilidad. Usan aggregate y groupBy, que quedaron filtrados por empresa en la
entrega 6 — verifica que esos totales nunca crucen empresas.

## 2. Listado para el VENDEDOR

Solo sus propias ventas, con las cuentas asignadas y el botón para volver a
copiar el mensaje.

**Sin ninguna columna de costo, utilidad ni margen.** La exclusión va en el
select de Prisma, no filtrando el objeto después (R4). Escribe una prueba que
inspeccione la respuesta cruda del endpoint y falle si aparece cualquiera de
esos campos.

## 3. Anular una venta

Solo ADMIN. Marca anulada = true, registra quién y cuándo, y **libera todas sus
pantallas de inmediato**. No se borra nunca ninguna venta.

Una pantalla liberada por anulación debe poder venderse otra vez enseguida:
pruébalo.

## 4. Antes de producción

a) **Las contraseñas del seed están fijas en el código.** Sirven para
   desarrollo, no para producción. Haz que el seed las exija por variable de
   entorno y falle si no están definidas cuando NODE_ENV sea production.

b) Revisa que ningún valor sensible esté en el repositorio y que .env siga
   ignorado.

c) Verifica que la clave de cifrado esté documentada como irrecuperable si se
   pierde.

## 5. Despliegue

- API en Railway o Fly, web en Vercel. Documenta las variables de entorno de
  cada uno.
- Migraciones con `npx prisma migrate deploy` en el arranque del despliegue,
  nunca `migrate dev`.
- Respaldos automáticos diarios de la base, con la instrucción de cómo
  restaurar uno.
- Endpoint de salud para el monitoreo.
- Escribe un README de despliegue con el procedimiento completo y qué hacer si
  una migración falla a mitad de camino.

## 6. Pruebas obligatorias

a) Los totales del admin de una empresa no incluyen ventas de otra.
b) La respuesta del listado del vendedor no contiene costo, utilidad ni margen
   en ningún campo, verificado sobre el JSON crudo.
c) Un vendedor no puede ver las ventas de otro vendedor de la misma empresa.
d) Anular libera todas las pantallas de la venta, y una de ellas se puede vender
   de nuevo acto seguido.
e) La búsqueda por código de compra encuentra la venta y no cruza empresas.
f) El seed falla si faltan las credenciales por variable de entorno en modo
   producción.
g) app-compuesta.test.ts pasa con todos los routers montados.

## 7. Entregable

Reporta el conteo total de pruebas del proyecto, el resultado de las siete de
esta entrega, y el procedimiento de despliegue verificado de punta a punta.
```

---

## Bitácora de entregas

| # | Estado | Notas |
|---|---|---|
| 1 | **Aprobada** | Conteos verificados contra el anexo A: 27 precios, 16 composiciones, 5 excepciones, 32 pantallas. Seed idempotente. Puerto de Postgres movido a 5435 por conflicto con instalación nativa. |
| 2 | **Aprobada** | R1 verificada en las 13 tablas con lista derivada del esquema. Guardas de rol jerárquicas. Login sin revelar existencia de correos. 103 pruebas. Dos observaciones trasladadas al prompt 3: blindar `prismaRaw` con prueba, y separar rutas por rol en el frontend. |
| 3 | **Aprobada** | Las 6 pruebas obligatorias pasan, incluida (b), que sostiene D2. Lista blanca de `prismaRaw` verificada en negativo. 116 pruebas. **Hallazgo importante:** con `@prisma/adapter-pg`, el P2002 no expone la restricción en `meta.target`. Auditar ese patrón en todo el código es el primer punto del prompt 4. |
| 4 | **Aprobada** | Auditoría de P2002 completa: 0 usos de `meta.target` fuera de la capa de errores. Índices únicos parciales agregados. 129 pruebas. **Hallazgo importante:** las guardas de rol usaban scope `global` en Elysia, que propaga el hook a la raíz y bloqueaba con 403 a los ADMIN en todos los routers montados después de `/empresas`. Las pruebas por router aislado no lo veían. Corregido a `scoped` y cubierto con `app-compuesta.test.ts`. |
| 5 | **Aprobada** | `resolverComposicionDePaquete` verificada contra los datos reales del seed, no contra una réplica. Las 5 excepciones resuelven una por una. 147 pruebas. **Hallazgo crítico:** `prismaParaEmpresa` no envuelve `upsert` — hueco en R1. Se corrigió el caso puntual, pero cerrar el hueco por completo es el punto 1 del prompt 6. |
| 6 | **Aprobada** | Hueco del `upsert` cerrado por completo: 16 operaciones envueltas y 1 bloqueada, con la lista derivada del cliente vivo de Prisma. `aggregate` y `groupBy` confirmados bajo prueba — el dinero del panel ya no puede cruzarse entre empresas. CHECK de `Precio` verificado a nivel de Postgres. Salvaguarda de costo de paquetes usando la duración real de cada componente. 161 pruebas. **Observación:** la prueba de cobertura solo alcanza operaciones de modelo; `$queryRaw` queda fuera, y la entrega 8 lo va a introducir. Reforzado en el prompt 8. |
| 7 | **Aprobada** | Capacidades reales sembradas. `estadoDePantallas` como única implementación de R5, reutilizada por `paquetesDisponibles`. Credenciales cifradas, excluidas del select y solo visibles bajo acción explícita. Endpoint de disponibilidad para el vendedor con cero credenciales. 170 pruebas. **Pendiente de verificar:** `cuentas.ts` entró a la lista blanca "para abrir la transacción". Si el patrón es `prismaRaw.$transaction`, el `tx` viene sin extender y R1 queda desactivada dentro del bloque. Es el punto 1a del prompt 8. |
| 8 | **Aprobada con reservas** | Las tres pruebas de concurrencia corren con transacciones Postgres reales en paralelo: 20→5 unitaria, 10→2 de paquete sin huérfanos, y códigos únicos. Inmutabilidad de `mensajeGenerado` verificada. R4 confirmado en ruta y en vivo. 245 pruebas. **Cuatro verificaciones no reportadas**, trasladadas al punto 0 del prompt 9: el `tx` extendido, el aislamiento del SQL crudo, el reintento del código de compra (nunca ejercido) y la liberación de pantalla en su fecha propia. |
| 9 | **Aprobada con reservas** | Las 7 pruebas obligatorias pasan, incluida la del JSON crudo del vendedor y la búsqueda por código entre empresas. 271 pruebas en total. `DEPLOYMENT.md` completo y verificado en Docker local. **Bug real encontrado:** la cookie necesitaba `SameSite=None` por los dominios distintos de Vercel y Railway. **Reservas:** el punto 0 (las cuatro verificaciones arrastradas) no se reportó por segunda vez, y `SameSite=None` abre CSRF sin mitigación. Ambas en `CIERRE-PRE-PRODUCCION.md`. |

**MVP cerrado como código el 2 de octubre de 2026.** Lo que falta entre esto y que el cliente lo use está en `CIERRE-PRE-PRODUCCION.md`.

---

## Prompt 10 — Rediseño de la interfaz

> **Estado:** listo para ejecutar. No estaba en el MVP: la cotización decía "interfaz funcional y sobria, sin diseño gráfico a medida".
> **Verificable al terminar:** la aplicación se ve como un producto, no como un formulario. Ninguna funcionalidad cambia.

```
Lee DISENO.md, PRD-MVP-Ventas.md y CLAUDE.md antes de empezar.

Vas a rediseñar la interfaz completa aplicando el sistema de DISENO.md. **No
cambies ninguna funcionalidad, ningún endpoint ni ningún esquema.** Si algo del
backend te estorba, anótalo y sigue; no lo toques.

Las 271 pruebas deben seguir pasando sin modificarse. Si alguna falla, es que
cambiaste comportamiento.

## 1. Fundación

- Declara todos los tokens de la sección 2 de DISENO.md como variables CSS en
  globals.css, con sus valores claros y oscuros bajo los dos ámbitos que
  describe el documento.
- Configura Tailwind para consumirlos por nombre de rol, no por hex.
- No introduzcas una fuente externa: sans del sistema.

## 2. Componentes

Construye los de la sección 4 en apps/web/components/ui/, sobre shadcn/ui que ya
está instalado. Iconos de lucide-react, que también está.

Empieza por Boton, Tarjeta, TileDato, Campo, Tabla, Pastilla y Aviso: con esos
siete ya se puede rehacer todo lo demás.

Presta atención a la distinción de la sección 2 de DISENO.md entre la acción
principal y la destructiva. Una pantalla tiene **como máximo un botón sólido
primario**. Las acciones destructivas van en contorno, con icono y con diálogo
de confirmación que nombre lo que se va a hacer.

## 3. Estructura

Implementa la barra lateral y la barra superior de la sección 3, con la
agrupación de navegación tal como está escrita y el filtrado por rol: un
VENDEDOR ve solo Vender y Ventas, y los grupos que no le corresponden **no se
renderizan**, no aparecen deshabilitados.

Cuando un SUPER_ADMIN esté operando dentro de una empresa, la pastilla con el
nombre de la empresa y el botón de salir tienen que estar siempre visibles.

## 4. Pantallas

En este orden, porque es el de impacto decreciente:

1. **/vender** — es la que más se usa. Sigue la sección 6 al detalle: pestañas
   de modo, tres selectores, tarjeta de resumen, botón VENDER de 56px, y la
   tarjeta del mensaje con copiado y confirmación visible.
2. **/panel** — tiles, aviso de costos en cero, gráfico, accesos directos y
   últimas ventas.
3. **Listas** — unifica plataformas, duraciones, tipos de cliente, paquetes,
   cuentas, usuarios y empresas bajo el mismo patrón, con alta y edición en
   panel lateral deslizante.
4. **/precios** — matriz con cabeceras fijas, celdas modificadas marcadas y
   contador de cambios pendientes en el botón de guardar.
5. **Paquetes, matriz de excepciones** — celdas con excepción destacadas.

## 5. El gráfico

Sección 5 de DISENO.md. Barras, serie única, color secundario, tooltip por
barra obligatorio, estado vacío propio.

**No uses una librería de gráficos.** Siete barras se dibujan con SVG en línea
en menos código del que cuesta configurar una librería, y sin sumar peso.

Nunca dos escalas verticales.

## 6. Estados que hoy no existen y hay que cubrir

Revisa cada pantalla y asegúrate de que tenga:
- Estado de carga con esqueletos con la forma del contenido, no un spinner.
- Estado vacío con la acción que lo resuelve.
- Estado de error con el mensaje del API y un botón de reintentar.
- Estado de guardando, con el botón deshabilitado y sin doble envío posible.

El doble envío importa de verdad en /vender: dos clics rápidos en VENDER no
pueden producir dos ventas.

## 7. Responsive

Todo tiene que funcionar a 390px de ancho. La barra lateral se vuelve cajón, las
filas de selectores se apilan, las tablas con muchas columnas se vuelven
tarjetas. /vender tiene que ser cómoda en celular: es donde va a usarse.

## 8. Verificación

- `bunx tsc --noEmit` limpio en ambas apps.
- Las 271 pruebas pasan sin modificarse.
- Recorre con curl las rutas principales y confirma que renderizan 200.
- Reporta qué pantallas quedaron y cuáles no alcanzaste, sin dejar ninguna a
  medias: es preferible una pantalla menos rediseñada que una rota.
```

---

## Prompt 11 — Selector de empresa del SUPER_ADMIN

> **Estado:** corrección urgente. El SUPER_ADMIN no puede usar ninguna pantalla.
> **Verificable al terminar:** un SUPER_ADMIN entra, elige una empresa desde la barra superior y opera normalmente; sabe en todo momento en cuál está.

```
Lee DISENO.md y la sección 5.2 del PRD antes de empezar.

## El problema

Todas las pantallas administrativas exigen una empresa activa, pero **no existe
ninguna forma de seleccionarla**. El SUPER_ADMIN entra y queda en un callejón sin
salida: cada pantalla le dice "Selecciona una empresa" y ninguna le ofrece
hacerlo.

Hay un segundo problema, igual de importante: en esas pantallas el formulario de
alta se renderiza **habilitado**, con sus campos editables, encima del mensaje de
error. Se puede escribir un usuario completo y presionar Crear, para que falle.
Un formulario que no puede funcionar no se muestra.

## 1. Selector de empresa en la barra superior

Componente nuevo, visible **solo para SUPER_ADMIN**, siempre presente en la barra
superior, en la misma posición en todas las pantallas.

Dos estados:

- **Sin empresa activa:** botón con estilo de advertencia que dice "Selecciona
  una empresa". No es decorativo: es la acción que desbloquea la aplicación.
- **Con empresa activa:** pastilla con fondo `--secundario-suave`, el nombre de
  la empresa en negrita y un chevron. Tiene que ser imposible olvidar en cuál se
  está trabajando: un SUPER_ADMIN editando los precios de la empresa equivocada
  es un desastre que nadie nota hasta que es tarde.

Al abrirlo: lista de empresas activas, con buscador si pasan de diez. Al elegir
una, fija la cookie empresa_activa y refresca los datos de la vista actual.
Abajo del todo, separado por una línea, "Salir de la empresa", que limpia la
cookie.

El ADMIN **no ve este selector**: siempre opera en la suya y no tiene otra.

## 2. Al entrar

Si un SUPER_ADMIN inicia sesión sin empresa activa, llévalo a la pantalla de
Empresas, no al panel. El panel tampoco puede mostrar nada sin empresa, así que
mandarlo ahí es mandarlo a un callejón.

Con empresa activa, al panel como siempre.

## 3. Pantallas sin empresa seleccionada

Regla general, no solo para estas pantallas: **cuando una pantalla no puede
funcionar, no se renderiza su formulario.**

En vez del formulario deshabilitado o habilitado-pero-roto, un `EstadoVacio`:
icono, el texto "Selecciona una empresa para gestionar su catálogo" y un botón
que abre el selector de la barra superior. Nada más. Sin tabla vacía con
cabeceras, sin campos, sin mensaje rojo de error — porque no es un error, es un
estado normal del super admin.

Aplícalo en: usuarios, plataformas, duraciones, tipos de cliente, paquetes,
precios, cuentas, ventas y vender.

Revisa si el mismo patrón —formulario habilitado sobre un error que impide
usarlo— aparece en otra pantalla, y corrígelo igual.

## 4. La pantalla de Empresas

Es la única del SUPER_ADMIN que funciona sin empresa activa.

- Listado con nombre, prefijo de código, estado y número de usuarios activos.
- Botón **Entrar** por fila, que es el mismo camino del selector.
- La empresa activa marcada visualmente en la lista.
- Alta de empresa con su primer admin, como ya existe.

## 5. Pruebas

a) Un SUPER_ADMIN sin empresa activa aterriza en Empresas tras iniciar sesión.
b) Elegir una empresa desde el selector fija la cookie y la vista actual pasa a
   mostrar los datos de esa empresa.
c) "Salir de la empresa" limpia la cookie y las pantallas vuelven al estado
   vacío.
d) Un ADMIN no recibe el selector en ninguna pantalla.
e) Ninguna pantalla renderiza un formulario de alta cuando no hay empresa
   activa.
f) Las 271 pruebas del backend siguen pasando sin modificarse.

## 6. Entregable

Recorre con curl, como SUPER_ADMIN, el ciclo completo: entrar sin empresa →
seleccionar → operar en una pantalla de catálogo → salir de la empresa. Reporta
el resultado de cada paso, no solo que compila.
```

---

## Prompt 12 — Plantillas del mensaje y empresas nacidas rotas

> **Estado:** corrección urgente. Una empresa creada desde la interfaz no puede vender.
> **Verificable al terminar:** se crea una empresa nueva, se configura y se vende, sin tocar la base de datos a mano.

```
Lee la sección 5.9 y el anexo B del PRD antes de empezar.

## El problema

Al vender aparece: "La empresa <id> no tiene una PlantillaMensaje de tipo
UNIDAD".

Son tres fallas encadenadas:

1. **Crear una empresa desde la interfaz no le crea sus plantillas.** Solo las
   tiene DISMANET, porque se las puso el seed. Toda empresa creada por el
   producto nace incapaz de vender.
2. **No existe pantalla para editar las plantillas.** Está especificada en la
   sección 5.9 del PRD y nunca se construyó. No hay forma de arreglarlo desde la
   aplicación: hay que entrar a la base de datos.
3. **La venta falla por completo** por una plantilla faltante, y el mensaje de
   error le muestra al usuario un identificador interno.

Las tres se arreglan juntas.

## 1. Una empresa nueva nace lista para operar

Al crear una empresa, dentro de la misma transacción que ya crea su primer
ADMIN, crear también:

- Las **dos plantillas de mensaje**, UNIDAD y PAQUETE, con el texto del anexo B
  del PRD. No es un valor de ejemplo: es lo que hace que la empresa pueda
  vender. El admin las edita después si quiere.
- Los tres **tipos de cliente** por defecto: Cliente normal, Revendedor,
  Promoción. El admin los renombra o desactiva.

Plataformas, duraciones, paquetes, precios y cuentas siguen vacíos: eso sí es
propio de cada negocio y lo configura el admin.

**Audita si falta algo más.** Compara qué crea el seed para DISMANET contra qué
crea el alta de empresa, y lleva al alta todo lo que sea condición para operar,
no solo datos de ejemplo. Una empresa recién creada no puede quedar en un estado
donde el producto no funcione.

Escribe una migración de datos que cree las plantillas y los tipos de cliente
faltantes en las empresas que ya existen sin ellos.

## 2. La venta nunca falla por una plantilla

Una venta mueve inventario y dinero. El mensaje es la entrega. **No se pierde
una venta por un problema de formato.**

Si al vender falta la plantilla, usar una plantilla de respaldo incorporada en
el código —sobria y funcional: producto, duración, código de compra, y las
credenciales con perfil y PIN cuando apliquen— completar la venta normalmente, y
devolver junto al resultado un aviso de que la plantilla no está configurada.

La pantalla muestra ese aviso encima del mensaje, con un enlace a la pantalla de
plantillas. El vendedor entrega igual; el admin se entera de que hay algo que
configurar.

## 3. Mensajes de error para humanos

"La empresa cmup1bnl70000jyxx37oj0ibo no tiene una PlantillaMensaje de tipo
UNIDAD" le muestra al usuario un identificador interno y un nombre de tabla.

Revisa todos los mensajes de error que llegan a la interfaz y reescribe los que
expongan identificadores, nombres de modelos o detalles de implementación. El
usuario lee qué pasó y qué hacer; el identificador va al registro del servidor.

## 4. Pantalla de plantillas

Nueva, bajo (admin)/panel/mensajes. Solo ADMIN. Es la sección 5.9 del PRD.

- Dos pestañas: **Venta unitaria** y **Venta de paquete**.
- Editor de texto amplio, en fuente monoespaciada, con la plantilla actual.
- Al lado o debajo, la **lista de marcadores disponibles** para esa pestaña,
  tomada de la tabla de la sección 5.9. Cada uno se inserta en el cursor al
  hacer clic: nadie debería tener que escribir `{{fechaEnLetras}}` a mano.
- **Vista previa en vivo** con datos de ejemplo, renderizada con la misma
  función que usa la venta real. No una imitación: la misma función, o la vista
  previa va a mentir.
- Aviso si el texto usa un marcador que no existe o uno que no aplica a esa
  pestaña, nombrando cuál.
- Botón de restaurar la plantilla por defecto.
- Guardar no toca las ventas pasadas: `Venta.mensajeGenerado` es copia (R3).
  Verifícalo con una prueba.

## 5. Pruebas

a) Crear una empresa desde el API deja sus dos plantillas y sus tres tipos de
   cliente creados, en la misma transacción.
b) Una empresa sin plantilla vende igual, usando la de respaldo, y la respuesta
   trae el aviso.
c) Editar una plantilla no cambia el mensaje de ventas ya registradas.
d) La vista previa y la venta real producen el mismo texto con los mismos datos.
e) Un marcador inexistente se reporta al guardar, no se renderiza literal en el
   mensaje del cliente.
f) Un VENDEDOR recibe 403 en los endpoints de plantillas.
g) Ningún mensaje de error devuelto al cliente contiene un identificador interno
   ni un nombre de modelo de Prisma.
h) Las 271 pruebas siguen pasando.

## 6. Entregable

Recorre el ciclo completo con curl: crear empresa → entrar a ella → configurar
una plataforma, una duración y un precio → crear una cuenta → vender → copiar el
mensaje. Sin tocar la base de datos a mano en ningún paso. Reporta dónde se
rompe, si se rompe.
```

### Pendientes menores arrastrados

| Tema | Entrega |
|---|---|
| Ninguna pantalla se ha verificado en navegador real: formularios, confirmaciones y la matriz de excepciones de paquetes | Revisión manual de Felipe, o cuando Chrome esté disponible |
| P3 sin resolver: ¿existen promociones temporales con fecha de inicio y fin? Si las hay, la matriz de precios necesita vigencia | Antes de cerrar la entrega 6 |

### Deuda técnica registrada

| Tema | Cuándo se salda |
|---|---|
| Contraseñas del seed fijas en el código (`DismanetAdmin#2026`) | Entrega 9, antes de producción |
| `capacidadPantallas = 1` en todas las plataformas: solo hay 32 pantallas y ninguna plataforma tiene 5 libres | Entrega 7, cuando el cliente entregue las capacidades reales. La prueba de concurrencia de la entrega 8 las necesita. |
| Costos en 0 en toda la matriz | Cuando el cliente entregue la tabla de costos. Sin ella no hay utilidad. |
| Precios solo para "Cliente normal" | Cuando el cliente entregue los de Revendedor y Promoción |
| Detección de P2002 con la forma equivocada en cualquier archivo aún no auditado | Entrega 4, punto 1. Crítico para el reintento del código de compra en la entrega 8. |
