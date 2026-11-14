# F6.7 — Instrucciones semanales (base y archivos en S3)

Séptima entrega del bloque de empleados. Cubre la primera mitad del punto 7
del cliente: *"sección para subir imágenes y videos con instrucciones y
tareas que los empleados deben realizar semanalmente"*.

**F6.6 queda reservado para el cálculo de comisiones**, que está esperando
que el dueño escoja su política en la pantalla de F6.5.

El registro automático de visualización de video (*"deberá visualizar el
video completo"*) es **F6.8**, la entrega siguiente. Aquí se suben y se ven
los archivos, y el cumplimiento se marca a mano.

## Parte 0 — Arreglo pendiente de F6.4

En `GET /reportes/faltantes` de `apps/api/src/routes/reportes.ts`, el filtro
es `rol: { not: Rol.VENDEDOR }`, así que ADMIN y SUPER_ADMIN aparecen en la
lista de quién debe reporte semanal. El dueño no se reclama un reporte a sí
mismo, y un SUPER_ADMIN es personal de la plataforma.

Cámbialo a `rol: Rol.EMPLEADO` exacto, y ajusta la prueba para que afirme
que un ADMIN activo sin reporte **no** aparece.

## Parte 1 — La decisión que define la entrega: los archivos no pasan por la API

Un video subido a través del servidor de la API lo recibe entero en memoria,
consume el tiempo de petición de Railway y paga el ancho de banda dos veces.
Con videos semanales eso se cae solo.

**Los archivos van directo del navegador a S3, con URLs prefirmadas:**

1. El navegador pide al API una URL de subida.
2. El API valida permisos, tipo y tamaño, **genera la clave** y devuelve una
   URL prefirmada de `PUT` con vencimiento corto.
3. El navegador sube el archivo directo a S3.
4. El navegador avisa al API que terminó, y recién ahí se registra la fila.

Para ver un archivo, igual pero al revés: el API devuelve una URL prefirmada
de `GET` de vida corta. **El bucket es privado**, sin acceso público ni ACL
abiertas.

### Reglas de seguridad, no negociables

- **La clave la genera el servidor, nunca el cliente.** Si el navegador
  pudiera elegirla, podría escribir en cualquier parte del bucket.
- Las claves van namespaced por empresa:
  `empresas/{empresaId}/instrucciones/{instruccionId}/{uuid}.{ext}`. Si
  alguna vez se cuela un error de aislamiento, el prefijo lo contiene.
- Lista blanca de `contentType`: imágenes `image/png`, `image/jpeg`,
  `image/webp`; video `video/mp4`, `video/webm`. Nada más.
- Tamaño máximo por archivo, configurable por variable de entorno, con un
  valor por defecto razonable para video. Se valida **al pedir la URL** (el
  API lo firma con esa condición) y se comprueba contra lo registrado.
- Las URLs prefirmadas de lectura vencen en minutos, no en horas.

### Variables de entorno nuevas

Bucket, región, access key id y secret. Agrégalas a `verificarEntorno` para
que el arranque falle temprano si faltan, y documéntalas en `.env.example`
**sin valores reales**. Son secretos: viven en Railway, nunca en el repo —
mismo trato que `CLAVE_CIFRADO`.

## Parte 2 — Modelo

```prisma
enum TipoArchivoInstruccion { IMAGEN  VIDEO }

model Instruccion {
  id           String   @id @default(cuid())
  empresaId    String
  titulo       String
  descripcion  String?
  semanaInicio DateTime // lunes 00:00 Bogotá de la semana a la que aplica
  cargoId      String?  // null = para todos los empleados
  publicada    Boolean  @default(false)
  creadaPorId  String
  createdAt    DateTime @default(now())
}

model InstruccionArchivo {
  id               String @id @default(cuid())
  empresaId        String
  instruccionId    String
  clave            String // la key en S3, generada por el servidor
  nombre           String // el nombre original, para mostrar
  tipo             TipoArchivoInstruccion
  contentType      String
  bytes            Int
  duracionSegundos Int?   // solo VIDEO; lo usará F6.8 para el seguimiento
  orden            Int
}

model InstruccionCumplimiento {
  id            String    @id @default(cuid())
  empresaId     String
  instruccionId String
  usuarioId     String
  completadaEn  DateTime?
  // @@unique([empresaId, instruccionId, usuarioId])
}
```

`semanaInicio` sale de `inicioSemanaBogota` de `lib/periodos.ts`, igual que
los reportes de F6.4. No escribas aritmética de semanas nueva.

`publicada` existe para que el ADMIN prepare la semana antes del lunes sin
que nadie la vea a medias. Una instrucción no publicada no sale en ninguna
consulta de empleado.

`cargoId` nulo significa "para todos". No construyas una tabla de asignación
múltiple: el cliente pidió instrucciones semanales para el equipo, no una
matriz de asignaciones.

## Parte 3 — Rutas

Prefijo `/instrucciones`.

**ADMIN:**

- `POST /` — crear (nace sin publicar).
- `PATCH /:id` — editar título, descripción, semana, cargo.
- `PATCH /:id/publicar` y `/despublicar`.
- `DELETE /:id` — solo si **no está publicada**. Una publicada ya la vio
  gente; se despublica, no se borra.
- `POST /:id/archivos/url-subida` — body con `nombre`, `contentType` y
  `bytes`. Valida y devuelve `{ url, clave }`.
- `POST /:id/archivos` — registra el archivo ya subido (`clave`, metadatos).
  **Verifica contra S3 que el objeto existe** antes de crear la fila: si la
  subida falló a mitad, no debe quedar una fila que apunta a nada.
- `DELETE /:id/archivos/:archivoId` — borra la fila y el objeto en S3.
- `GET /:id/cumplimiento` — quién la marcó y quién no, entre los empleados a
  los que aplica.

**EMPLEADO en adelante** (un VENDEDOR es revendedor externo y no recibe
instrucciones, mismo criterio que F6.3 y F6.4):

- `GET /instrucciones?semana=` — las **publicadas** de esa semana que le
  aplican (su cargo, o las de cargo nulo), con su estado de cumplimiento.
- `GET /instrucciones/:id/archivos/:archivoId/url` — URL prefirmada de
  lectura. Solo si la instrucción está publicada y le aplica.
- `POST /instrucciones/:id/completar` — la marca como cumplida. **En F6.8
  esta ruta cambia para los videos**; déjalo comentado para que quien la lea
  después sepa que es provisional.

## Parte 4 — Frontend

Página `panel/instrucciones`, sidebar en OPERACIÓN, `rolMinimo: "EMPLEADO"`.

- **Empleado**: las instrucciones de la semana con sus imágenes y videos,
  y el botón de marcar como cumplida. Selector de semana.
- **ADMIN**: crear y editar, subir archivos con barra de progreso real (la
  subida va directo a S3, así que el progreso es el del `PUT`), publicar, y
  ver quién cumplió.
- Las imágenes se muestran en la página; los videos con el reproductor nativo
  del navegador. Nada de librerías de video en esta entrega.

## Parte 5 — Pruebas

Para S3, usa un doble en las pruebas — **no pegues contra un bucket real**.
Recuerda que `mock.module` en Bun es global al proceso.

- La clave generada incluye el `empresaId` y el `instruccionId`, y un
  `contentType` fuera de la lista blanca se rechaza.
- Un `bytes` por encima del máximo se rechaza al pedir la URL.
- Registrar un archivo cuyo objeto no existe en S3 falla y no crea la fila.
- Una instrucción **no publicada** no sale en la consulta del empleado, ni
  siquiera si pide su id directo, y tampoco entrega URL de lectura.
- Una instrucción con `cargoId` de Soporte técnico no le sale a un empleado
  de otro cargo; una con `cargoId` nulo le sale a todos.
- `DELETE` de una instrucción publicada: 409.
- `POST /completar` dos veces no duplica la fila de cumplimiento.
- Un VENDEDOR recibe 403 en todas las rutas.
- Un EMPLEADO recibe 403 en crear, publicar, subir y ver cumplimiento.
- R1 en todo, incluido que un empleado de la empresa B no obtenga URL de
  lectura de un archivo de la empresa A.

## Lo que NO entra

El registro automático de visualización de video (F6.8), transcodificación,
miniaturas, y cualquier librería de reproducción. Tampoco comisiones ni
estadísticas.

## Al terminar

Reporta la lista de archivos tocados **verificada contra `git status`**,
pruebas antes y después, y **las variables de entorno nuevas por su nombre**,
para poder configurarlas en Railway antes de desplegar.
