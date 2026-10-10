# Prompt F3.3 — Rediseño de la pantalla de vender

> **Estado:** **entregada y aprobada** el 10 de octubre. Registro al final.
> **Peso:** ~16 h.
> **Verificable al terminar:** el vendedor pulsa una pastilla grande, elige la plataforma de una grilla, y recién ahí pone duración, tipo de cliente y celular. Sin callejones sin salida.

---

## El flujo que pidió el cliente

```
Paso 1   Tres pastillas grandes de color:  UNIDAD · PAQUETE · PROMOCIÓN
           ↓  (pulsa una)
Paso 2   Modal con grilla de ítems, con su logo y su disponibilidad
           ↓  (pulsa uno)
Paso 3   Duración · Tipo de cliente · Celular (opcional) · precio · VENDER
```

Viene de una captura de otro producto. Lo que le gustó es concreto: pastillas grandes con color propio y conteo, y una grilla de logos en vez de un desplegable de 17 nombres.

---

## Lo que lo convierte en algo más que front

**El orden rompe cómo se calculan los precios hoy.** `/ventas/plataformas` exige `duracionId` y `tipoClienteId` para devolver precio y disponibilidad. En el flujo nuevo la plataforma se elige **antes** de esos dos, así que la grilla no los tiene.

Si no se resuelve: el vendedor elige Netflix y dos pasos después descubre que no hay precio para esa combinación. Un callejón sin salida en la pantalla de más prisa del sistema.

La solución va en el prompt: un endpoint que, dada la plataforma, devuelve **solo las combinaciones que sí tienen precio**.

---

## Decisiones tomadas

| | |
|---|---|
| Las tres pastillas | UNIDAD · PAQUETE · PROMOCIÓN, las que ya existen |
| El celular del comprador | En el paso 3, junto a duración y tipo de cliente |
| Los logos | Campo `logoUrl` en Plataforma. Los que se pongan en el repo apuntan a `/logos/x.svg`; los que agregue el admin después son una URL que él pega. Sin logo, pastilla con la inicial. |

---

## El prompt

```
Lee CLAUDE.md, DISENO.md, PRD-MVP-Ventas.md y GUIA-DE-PRUEBA.md antes de
empezar. Las credenciales de desarrollo están en GUIA-DE-PRUEBA.md.

Lee también la pantalla de vender actual completa y los endpoints
/ventas/plataformas y /ventas/paquetes. Este bloque reordena ese flujo; la
llamada que registra la venta no cambia.

## El flujo nuevo

Tres pasos, en la misma pantalla (no son rutas distintas):

1. Tres pastillas grandes: UNIDAD, PAQUETE, PROMOCIÓN. Cada una con icono,
   nombre y el conteo de lo que hay detrás ("17 plataformas", "6 paquetes").
2. Al pulsar una, un modal con la grilla: plataformas para UNIDAD, paquetes
   para las otras dos. Cada tarjeta con su logo y su disponibilidad.
3. Elegido el ítem, el modal se cierra y aparecen duración, tipo de cliente,
   celular opcional, el precio y el botón VENDER.

Un paso atrás siempre visible: desde el paso 3 se puede volver a elegir ítem
sin perder la pantalla, y desde el modal se puede cerrar sin elegir.

## 1. El problema del orden, y el endpoint que lo resuelve

Hoy la lista de productos necesita `duracionId` y `tipoClienteId` para traer
precio y disponibilidad. Ahora el ítem se elige antes que esos dos.

**Endpoint nuevo:** `GET /ventas/plataformas/:id/opciones` y su gemelo
`GET /ventas/paquetes/:id/opciones`. Devuelven las combinaciones con precio
activo para ese ítem:

    { opciones: [ { duracionId, tipoClienteId, precioVenta } ] }

Con eso el paso 3 construye sus dos selectores solo con lo que existe, y
muestra el precio en cuanto hay duración y tipo elegidos, sin otra petición.

- **Nunca devuelve `costo` ni `utilidad`** (R4). El `select` de Prisma no los
  pide; no se filtran después.
- Rol mínimo VENDEDOR, como el resto del flujo de venta.
- Si el ítem no tiene ninguna combinación con precio, devuelve lista vacía y
  el paso 3 lo dice con todas sus letras en vez de mostrar selectores vacíos.

**Mejor aún: que no se llegue ahí.** En la grilla del paso 2, un ítem sin
ninguna combinación con precio se muestra deshabilitado y con el motivo, no
clicable. El callejón sin salida deja de existir en vez de avisarse tarde.

## 2. La grilla del paso 2

**Para UNIDAD:** todas las plataformas activas, con logo y el número de
pantallas libres. Sin precio: todavía no se sabe la duración.

Una plataforma sin pantallas libres se muestra deshabilitada y diciendo "sin
pantallas libres". Que se vea, no que desaparezca: el vendedor necesita saber
que existe y está agotada, no creer que no la venden.

**Para PAQUETE y PROMOCIÓN:** los paquetes, con los logos de sus componentes
en pequeño (los mismos archivos) y si se puede armar o no.

Ojo: hoy la disponibilidad de paquetes se calcula con la duración. Revisa si
se puede calcular sin ella — la composición no depende de la duración, solo
los vencimientos. Si resulta que sí depende, dilo en vez de inventar un valor.

El modal lleva buscador cuando hay más de 12 ítems. Con 17 plataformas y la
lista creciendo, escribir "net" tiene que ser más rápido que buscar con el
ojo.

## 3. Logos

Campo nuevo `Plataforma.logoUrl String?`, nullable. Migración aditiva.

- En la pantalla de plataformas, un campo para la URL del logo, con vista
  previa.
- Los logos que estén en `apps/web/public/logos/` se referencian como
  `/logos/<archivo>`. Los que el admin agregue después son una URL externa.
  Un solo campo sirve para las dos cosas.
- **Sin logo: pastilla con la inicial de la plataforma** sobre `--plano`, con
  el nombre debajo como siempre. Tiene que verse deliberado, no roto.
- Las imágenes externas pueden no cargar. Un `onError` que caiga a la pastilla
  de inicial: el modal nunca muestra un icono de imagen rota.

**No bloquees la entrega esperando los logos.** La pantalla tiene que quedar
bien con cero logos cargados; se van agregando después.

## 4. Color — tokens nuevos, no pasteles a dedo

El cliente quiere pastillas de colores distintos. `DISENO.md` §2 reserva
verde, ámbar y rojo para estados: una pastilla verde al lado de una pastilla
"Activo" verde le enseña al usuario lo contrario de lo que queremos.

- Define **tres tonos de categoría** como tokens nuevos en `DISENO.md` §2, uno
  por modo, con su valor claro **y su valor oscuro**. No reutilices `--bien`,
  `--aviso`, `--serio` ni `--critico`.
- El texto sobre cada tono cumple 4.5:1 en los dos temas. Elige los valores,
  no los inviertas automáticamente (§7).
- **De paso, arregla `--secundario-suave`**, que quedó claro en modo oscuro y
  está pendiente: necesita un valor oscuro de verdad y un `--secundario-texto`
  nuevo para el texto encima. Es el mismo trabajo y es el momento.

La pastilla de UNIDAD puede llevar el rojo de marca por ser la venta más
común; las otras dos, tonos de categoría. Una sola acción sólida por pantalla
sigue siendo VENDER.

## 5. Lo que no cambia

- La petición que registra la venta.
- La tarjeta del mensaje al terminar, con "Copiar mensaje" y "Nueva venta".
- El aviso de plantilla no configurada.
- Que el error del servidor quede visible y no lo borre ningún refresco
  posterior (hallazgo 8).
- Que un VENDEDOR no vea costo ni utilidad en ninguna respuesta.

## 6. Verificación

- Las pruebas existentes pasan sin modificarse. `tsc --noEmit` limpio en ambas
  apps, cero errores incluidos los de archivos de prueba.
- `app-compuesta.test.ts` para los dos endpoints nuevos, con el caso sin
  sesión y con los dos roles.
- **R4 sobre el JSON crudo** de `/opciones`: no contiene "costo", "utilidad"
  ni "margen".
- Un ítem sin ninguna combinación con precio aparece deshabilitado en la
  grilla y no se puede abrir.
- Una plataforma sin pantallas libres aparece deshabilitada, no oculta.
- Las pruebas de la pantalla de vender que ya existen (`vender/page.test.tsx`)
  se adaptan al flujo nuevo y siguen verificando que **el error del servidor
  queda visible después del refresco**.
- Con `logoUrl` vacío y con una URL rota, la tarjeta cae a la inicial y la
  consola queda sin errores.
- Recorre los tres pasos en claro y en oscuro, y en ancho de teléfono: las
  tres pastillas se apilan y el modal ocupa la pantalla completa.
- Consola sin errores ni advertencias de React en todo el flujo.

## 7. Entregable

Reporta:
- Si la disponibilidad de paquetes se pudo calcular sin la duración, o qué
  encontraste.
- Qué valores elegiste para los tres tonos de categoría y para
  `--secundario-suave` oscuro, con su razón de contraste.
- Cuántos clics toma una venta de unidad ahora contra cuántos tomaba antes.
```

---

## Registro — F3.3 · **aprobada**

Revisado el 10 de octubre.

**Los seis contrastes reportados se verificaron calculándolos, y dan exactos a dos decimales.** Importa porque la vez anterior el número era cierto y medía lo que no era.

Y el arreglo del token quedó bien por la razón correcta, no solo por el número:

| fondo oscuro | contraste contra la página `#0D0D0D` |
|---|---|
| `#23214A` (nuevo) | **1.28** — superficie sutil, se apoya en la página |
| `#E4E2FA` (el anterior) | **15.32** — la expresión numérica de "bloque blanco sobre negro" |

La nota de `DISENO.md` §2 explica la causa raíz mejor de lo que yo la había diagnosticado: **no existía un token de texto propio para el oscuro, así que oscurecer el panel bajaba el contraste en vez de subirlo.** Por eso la vez pasada se parchó el componente en vez del token. Y haber tocado `pastilla.tsx` para que use `text-secundario-texto` en vez de `text-secundario` es justo lo que se habría quedado atrás.

**El conteo de clics se reportó como empate, 7 contra 7.** Era fácil inflarlo y no se hizo. La lectura es la correcta: la ganancia no es menos clics, es que el flujo viejo te dejaba elegir a ciegas y descubrir después que no había producto, y el nuevo deshabilita con motivo antes de que entres.

**Dos caminos sin probar en vivo** —el `onError` de una URL de logo rota y una tarjeta de paquete no armable— porque exigían mutar la base de desarrollo compartida y el clasificador de permisos lo bloqueó. **No se buscó la vuelta**, que es lo correcto. El riesgo es bajo: el `onError` es un cambio de estado de una línea con la misma forma que el camino nulo, que sí se ejercitó en las 19 plataformas. Eyeléalo cuando cargues el primer logo de verdad.

### Nota de diseño, menor

`--categoria-paquete-texto` claro es `#0F766E`, un verde azulado, y `--bien` es `#0CA30C`. En el modal de paquetes conviven la pastilla de categoría y el estado "Disponible". A tamaño chico pueden leerse de la misma familia, que es justo lo que `DISENO.md` quiere evitar al reservar los colores de estado. No es bloqueante y puede que en pantalla se distingan de sobra — míralo cuando pases por ahí.

### ⚠️ Sigue abierto el pendiente de F3.2, ahora a dos entregas de distancia

Verificado hoy: `POST /plataformas` **sigue exigiendo `capacidadPantallas >= 1`** y escribiéndolo sin crear filas de plantilla, y **el seed sigue sin crear plantilla** (cero referencias a `plataformaPantalla` en `seed.ts`).

Es el caso exacto que quedó escrito como convención permanente en `CLAUDE.md` tras repetirse tres veces. Ahora van cuatro.

No es regresión de F3.3 —no estaba en su encargo— y parte de la culpa es mía por no haberlo metido en el prompt. Pero conviene cerrarlo antes de que se vuelva folclore: `POST /plataformas` deja de recibir `capacidadPantallas` y lo crea en 0, y el seed crea sus filas. Veinte minutos.

---

## Los logos: lo que falta y de dónde sacarlos

**No los puedo bajar yo** — este entorno no descarga archivos binarios de la web.

Lo que no recomiendo: tomar lo primero que salga en una búsqueda de imágenes. Tamaños distintos, fondos blancos quemados, PNG pixelados en pantallas retina.

La fuente buena son las páginas de marca de cada proveedor, que publican SVG. Un agente en Claude Code, que sí tiene navegador, puede juntarlos en `apps/web/public/logos/` con nombres predecibles (`netflix.svg`, `disney-plus.svg`...). Una vez ahí, cargarlos es pegar `/logos/netflix.svg` en el campo de cada plataforma.

Mientras tanto la pantalla funciona con las pastillas de inicial, así que esto no bloquea nada.
