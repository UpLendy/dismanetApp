# F6.8 — Video y registro de visualización

Cierra el punto 7 del cliente: *"para marcar una instrucción como completada,
el empleado deberá visualizar el video completo. El sistema registrará
automáticamente su cumplimiento"*.

Depende de F6.7 (instrucciones y S3).

## Parte 0 — Lo que esto puede y no puede hacer

**No se puede demostrar que alguien vio un video.** Todo lo que reporta el
navegador se puede falsificar desde las herramientas de desarrollador, y no
hay forma de verificarlo del lado del servidor.

Lo que sí se puede hacer, y es lo que hace esta entrega, es **subir el costo
de hacer trampa de "cero esfuerzo" a "manipulación deliberada"**: arrastrar
la barra hasta el final no cuenta, y abrir y cerrar tampoco.

Escríbelo así en la cabecera del módulo. Que nadie lea este código dentro de
un año creyendo que es una prueba.

## Parte 1 — El mecanismo

### 1.1 Tramos cubiertos, no posición máxima

Guardar solo "llegó hasta el segundo 600" hace que arrastrar la barra al
final complete el video de inmediato. Hay que guardar **qué tramos vio**.

En `InstruccionCumplimiento`, por archivo de video:

```prisma
model InstruccionVisualizacion {
  id            String   @id @default(cuid())
  empresaId     String
  archivoId     String
  usuarioId     String
  tramos        Json     // [[inicio, fin], ...] en segundos, ordenados y sin solapar
  segundosVistos Int     @default(0) // suma de los tramos, desnormalizada para consultar
  ultimoReporte DateTime // para el control de reloj de la parte 1.2
  completadoEn  DateTime?
  // @@unique([empresaId, archivoId, usuarioId])
}
```

Los tramos se **fusionan** en cada reporte: ordenados, sin solapamientos.
En una reproducción normal queda un solo tramo. **Limita la cantidad de
tramos a 50**: si un cliente manipulado manda cientos de fragmentos sueltos,
se rechaza el reporte en vez de crecer sin límite.

### 1.2 El control de reloj — esto es lo que de verdad sirve

En cada reporte, el servidor compara los **segundos nuevos de cobertura**
contra el **tiempo real transcurrido** desde `ultimoReporte`.

Regla: se acreditan como máximo `(segundos de reloj transcurridos) × 2`
segundos nuevos de cobertura. El exceso se **recorta**, no se rechaza — así
la interfaz no se rompe si hay un salto de red.

El factor 2 deja margen para reproducir a velocidad aumentada y para el
jitter de red, y aun así hace imposible cubrir diez minutos de video en
treinta segundos. Es el único control que vive en el servidor y por eso es el
que importa.

### 1.3 Cuándo se da por completado

Cuando se cumplen **las dos** condiciones:

- cobertura ≥ **95%** de `duracionSegundos`, y
- tiempo real acumulado desde el primer reporte ≥ **90%** de la duración.

El 95% existe porque el último segundo rara vez se reporta. Las dos juntas
son lo que impide completar saltando.

### 1.4 De dónde sale la duración

`InstruccionArchivo.duracionSegundos` la manda el navegador **del ADMIN** al
registrar el archivo, leída de los metadatos del video.

Es un dato que viene del cliente y se podría falsear bajo para completar
rápido — pero quien lo manda es quien sube la instrucción, no quien la tiene
que ver, y ese no tiene ningún incentivo para hacerlo. Déjalo comentado así.

Si llega nula o en cero para un video, el archivo **no puede gatillar
cumplimiento automático**: trátalo como pendiente y repórtalo al ADMIN.

## Parte 2 — Qué pasa con el cumplimiento de la instrucción

- Una instrucción **con al menos un video**: se completa sola cuando **todos**
  sus videos están completados. Las imágenes no condicionan nada.
- Una instrucción **sin videos**: se sigue marcando a mano.
- `POST /instrucciones/:id/completar` (la de F6.7, que quedó comentada como
  provisional) ahora responde **409** si la instrucción tiene videos: ahí el
  cumplimiento es automático y no se puede autodeclarar.

## Parte 3 — Rutas

- `POST /instrucciones/:id/archivos/:archivoId/progreso` — **EMPLEADO en
  adelante**, solo para sí mismo. Body con el tramo reproducido desde el
  último reporte (`desde`, `hasta` en segundos). Valida que la instrucción
  esté publicada y le aplique, igual que F6.7. Devuelve la cobertura y si ya
  quedó completado.
- `GET /instrucciones/:id/progreso` — el propio, por archivo.
- `GET /instrucciones/:id/cumplimiento` (ya existe de F6.7) — agrégale, por
  empleado y por video, el porcentaje de cobertura y si está completado. Es
  lo que le deja ver al ADMIN quién va a medias.

## Parte 4 — Frontend

En la página de instrucciones, el video con el reproductor nativo más:

- Un reporte de progreso cada ~10 segundos mientras se reproduce, y además al
  pausar, al cambiar de pestaña y al terminar. No reportes en cada
  `timeupdate`: son varias veces por segundo.
- La barra de avance **de cumplimiento** (cobertura acumulada), aparte de la
  barra de reproducción del video. Son cosas distintas y el empleado tiene
  que ver cuánto le falta para que cuente.
- Cuando se completa, el estado cambia solo, sin que tenga que pulsar nada.
- Si el archivo no tiene duración registrada, un aviso de que ese video no
  registra cumplimiento automático.

## Parte 5 — Pruebas

- **Arrastrar al final**: un solo reporte del último segundo deja cobertura
  mínima y **no** completa.
- **Reproducción normal** simulada avanzando el reloj: completa.
- **Reporte imposible**: pedir 600 segundos nuevos con 5 de reloj
  transcurrido se recorta a 10, y la cobertura refleja el recorte.
- **Visualización en dos sesiones**: ver la primera mitad, volver al día
  siguiente y ver la segunda, completa.
- Tramos solapados se fusionan y no inflan `segundosVistos`.
- Más de 50 tramos: el reporte se rechaza.
- Instrucción con dos videos: completa solo cuando los dos están completos.
- `POST /completar` en una instrucción con video: 409.
- Un video sin `duracionSegundos` no completa nunca por sí solo y sale
  reportado.
- Un empleado no puede reportar progreso de otro, ni de una instrucción no
  publicada o que no le aplica.
- R1: nada cruza empresas.

## Lo que NO entra

Transcodificación, miniaturas, librerías de reproducción, streaming
adaptativo, y cualquier intento de "verificar" la visualización más allá de
lo de la Parte 0.

## Al terminar

Reporta la lista de archivos tocados **verificada contra `git status`**,
pruebas antes y después, y confirma explícitamente que el control de reloj de
la Parte 1.2 se aplica **en el servidor** y no solo en el navegador.
