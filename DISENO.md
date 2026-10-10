# Sistema de diseño — Interfaz

**Proyecto:** Sistema Interno de Gestión
**Versión:** 1.0 — 2 de octubre de 2026

> Esta es la fuente de verdad visual. Toda pantalla nueva se construye con estos tokens y estos componentes. Si algo no está aquí, se agrega aquí antes de usarlo.

---

## 1. Principio

Dos superficies con prioridades distintas:

- **El vendedor** usa una sola pantalla, muchas veces al día, con prisa. Botones grandes, pocos elementos, el camino a VENDER siempre visible.
- **El administrador** usa muchas pantallas, pocas veces. Densidad de información, tablas, formularios ordenados.

No se diseñan igual. La pantalla de venta es la única con un botón de acción gigante.

---

## 2. Tokens

Se declaran como variables CSS en `globals.css` y se usan por rol, nunca por hex suelto.

### Color de marca

| Rol | Claro | Oscuro | Uso |
|---|---|---|---|
| `--primario` | `#D92D20` | `#D92D20` | Identidad, ítem activo de navegación, **la acción principal de cada pantalla** |
| `--primario-hover` | `#B42318` | `#B42318` | Estado hover del primario |
| `--primario-suave` | `#FEF3F2` | `#3A1412` | Fondo del ítem activo en la barra lateral, fondos de énfasis |
| `--primario-texto` | `#B42318` | `#FFB4A8` | Texto sobre fondo suave |
| `--secundario` | `#4F46E5` | `#4F46E5` | Acciones alternas, iconos de acceso directo, **marcas de los gráficos** |
| `--secundario-suave` | `#EEF2FF` | `#23214A` | Fondos de énfasis secundarios (pastilla "Ocupada", celdas de excepción) |
| `--secundario-texto` | `#4F46E5` | `#C7D2FE` | Texto sobre `--secundario-suave` |

`--primario`, `--primario-hover` y `--secundario` se usan como relleno sólido o como texto plano — nunca como panel grande — así que el mismo valor funciona en ambos temas y no se invierte.

`--primario-suave`/`--primario-texto` y `--secundario-suave`/`--secundario-texto` sí son paneles grandes (fondo del ítem activo del menú, pastillas, celdas de excepción): invertir `#FEF3F2` daría un negro casi puro sin relación con `--primario`, y dejarlo sin valor oscuro es el bug que esto corrige (bloque casi blanco sobre la barra negra). El oscuro es un tono elegido a mano:

- `--primario-suave` oscuro (`#3A1412`, un marrón-rojo muy oscuro) + `--primario-texto` oscuro (`#FFB4A8`, un salmón claro) dan **9.6:1** — el texto sigue siendo "rojo de marca", solo que claro sobre oscuro en vez de oscuro sobre claro.
- `--secundario-suave` oscuro **corregido** — bug pendiente desde la versión anterior de este documento, hecho explícito aquí. El valor oscuro anterior (`#E4E2FA`) era, en los hechos, un lavanda *claro*: pasaba la medición de contraste (5.0:1) reutilizando `--secundario` (`#4F46E5`, invariante entre temas) como color de texto, pero como panel se veía igual de claro en modo oscuro que en modo claro — un bloque pastel flotando sobre una página negra, el mismo síntoma que ya se había corregido para `--primario-suave`. La causa era no tener un token de texto propio para el oscuro: sin él, oscurecer el panel bajaba el contraste en vez de subirlo. La corrección introduce `--secundario-texto` (nuevo) para desacoplar panel y texto por tema:
  - Claro: panel `#EEF2FF` sin cambios, texto `--secundario-texto` claro = `#4F46E5` (el mismo `--secundario` de siempre) → **5.62:1**.
  - Oscuro: panel `#23214A` (índigo oscuro genuino, no una inversión automática) + `--secundario-texto` oscuro `#C7D2FE` (lavanda claro) → **10.14:1**.
  - `Pastilla` (`components/ui/pastilla.tsx`) usa ahora `bg-secundario-suave text-secundario-texto`, no `text-secundario` a secas, para que el texto sí cambie de tono entre temas.

### Tonos de categoría — `/vender`, paso 1

Las tres pastillas grandes de modo (UNIDAD / PAQUETE / PROMOCIÓN) necesitan distinguirse por color sin pisar los tokens de estado (`--bien`/`--aviso`/`--serio`/`--critico`, reservados — ver más abajo): una pastilla verde junto a una pastilla de estado "Activo" también verde enseñaría lo contrario de lo que significa. Dos tonos nuevos, uno por modo que lo necesita:

| Rol | Claro | Oscuro | Uso |
|---|---|---|---|
| `--categoria-paquete-suave` | `#ECFEFF` | `#083344` | Fondo de la pastilla PAQUETE |
| `--categoria-paquete-texto` | `#0F766E` | `#5EEAD4` | Texto/ícono sobre `--categoria-paquete-suave` — **5.26:1** claro, **9.06:1** oscuro |
| `--categoria-promocion-suave` | `#FAF5FF` | `#2E1065` | Fondo de la pastilla PROMOCIÓN |
| `--categoria-promocion-texto` | `#7E22CE` | `#E9D5FF` | Texto/ícono sobre `--categoria-promocion-suave` — **6.51:1** claro, **11.19:1** oscuro |

La pastilla UNIDAD **no** recibe un tono nuevo: reutiliza `--primario-suave`/`--primario-texto` a propósito, porque UNIDAD es el tipo de venta más frecuente y ya tiene el rojo de marca como asociación. Las tres pastillas comparten entonces la misma forma (fondo suave + texto/ícono de color, nunca relleno sólido): VENDER sigue siendo la única acción de relleno sólido de la pantalla.

Los dos tonos nuevos son deliberadamente distintos de `--secundario` (índigo) además de los cuatro de estado, para no competir visualmente con la pastilla "Ocupada" ni con el anillo de foco (ambos `--secundario`).

### Superficies e ink

| Rol | Claro | Oscuro |
|---|---|---|
| `--plano` (fondo de página) | `#F7F7F8` | `#0D0D0D` |
| `--superficie` (tarjetas) | `#FFFFFF` | `#1A1A19` |
| `--borde` | `rgba(16,24,40,0.08)` | `rgba(255,255,255,0.10)` |
| `--ink` | `#101828` | `#FFFFFF` |
| `--ink-2` | `#475467` | `#C3C2B7` |
| `--ink-muted` | `#98A2B3` | `#898781` |

Declarar los valores oscuros bajo `@media (prefers-color-scheme: dark)` con guarda `:root:not([data-theme="light"])` y también bajo `:root[data-theme="dark"]`, para que un selector manual gane en ambos sentidos.

### Estado — reservados, nunca se usan como color decorativo

| Rol | Valor |
|---|---|
| `--bien` | `#0CA30C` |
| `--aviso` | `#FAB219` |
| `--serio` | `#EC835A` |
| `--critico` | `#D03B3B` |

**Todo estado va con icono y etiqueta, nunca solo con color.** `--aviso` y `--serio` quedan por debajo de 3:1 sobre fondo claro; el icono y el texto son la mitigación.

### Rojo de marca contra rojo de peligro

`--primario` y `--critico` son casi el mismo tono. Para que VENDER y Anular no se confundan, la distinción la carga **la forma, no el color**:

- **Acción principal:** botón sólido con `--primario`. **Una sola por pantalla.**
- **Acción destructiva:** botón de contorno, texto `--primario-texto`, icono a la izquierda, y **siempre** diálogo de confirmación que nombre lo que se va a hacer.

Nunca un botón sólido rojo para destruir.

### Tipografía

Sans del sistema: `system-ui, -apple-system, "Segoe UI", sans-serif`. Sin serif ni fuentes de display.

| Rol | Tamaño / peso |
|---|---|
| Título de página | 24px / 700 |
| Título de sección | 18px / 600 |
| Título de tarjeta | 16px / 600 |
| Cuerpo | 14px / 400 |
| Etiqueta de dato | 12px / 600, mayúsculas, `letter-spacing: .06em`, `--ink-muted` |
| Valor de dato | 28px / 700 |

`tabular-nums` solo en columnas de tabla y ejes de gráfico, donde los números tienen que alinearse verticalmente. Los valores grandes sueltos van con cifras proporcionales.

### Espaciado y forma

Escala de 4px: 4, 8, 12, 16, 24, 32, 48.
Radios: 8px en controles, 12px en tarjetas, 999px en pastillas.
Sombra de tarjeta: `0 1px 2px rgba(16,24,40,.06)`. Nada más pesado.

---

## 3. Estructura de la aplicación

```
┌────────────┬──────────────────────────────────────┐
│            │  Barra superior                      │
│  Barra     ├──────────────────────────────────────┤
│  lateral   │                                      │
│  240px     │  Contenido, máx 1280px, padding 32px │
│            │                                      │
│  (footer)  │                                      │
└────────────┴──────────────────────────────────────┘
```

### Barra lateral

Fija, 240px, fondo `--superficie`, borde derecho hairline. En móvil se colapsa a cajón.

- Arriba: nombre del producto.
- Ítems: icono de 20px (`lucide-react`) + etiqueta, altura 40px, radio 8px.
- **Activo:** fondo `--primario-suave`, texto e icono `--primario-texto`, peso 600.
- Hover: fondo `rgba(16,24,40,.04)`.
- Abajo: "Cerrar sesión" y el número de versión en 12px `--ink-muted`.

**Agrupación**, con encabezado de grupo en 11px mayúsculas `--ink-muted`:

```
  Vender                    ← destacado, siempre primero
  Ventas

OPERACIÓN
  Cuentas

CONFIGURACIÓN
  Plataformas
  Duraciones
  Tipos de cliente
  Paquetes
  Precios

ADMINISTRACIÓN               ← solo ADMIN y SUPER_ADMIN
  Usuarios
  Empresas                   ← solo SUPER_ADMIN, o ADMIN para crear una nueva
```

El VENDEDOR ve solo "Vender" y "Ventas". Los grupos que no le corresponden no se muestran, no se muestran deshabilitados.

### Barra superior

Altura 64px, fondo `--superficie`, borde inferior hairline.

- Izquierda: saludo con el nombre del usuario y, debajo, en 12px, el nombre de la empresa activa.
- Derecha: menú de usuario con correo, rol y cerrar sesión.
- Cuando un SUPER_ADMIN está operando dentro de una empresa, una pastilla visible con el nombre de la empresa y un botón "Salir de la empresa". **Tiene que ser imposible olvidar en qué empresa se está.**

---

## 4. Componentes

Todos en `apps/web/components/ui/`, construidos sobre shadcn/ui, que ya está instalado.

| Componente | Notas |
|---|---|
| `Tarjeta` | Fondo `--superficie`, radio 12, borde hairline, padding 20. Con título y acción opcional en la cabecera. |
| `TileDato` | Etiqueta arriba (estilo etiqueta de dato), valor grande debajo, variación opcional con icono y color de estado. Es el bloque de los indicadores. |
| `TarjetaAcceso` | Icono en cuadrado de 48px con fondo de color y radio 12, título, descripción, chevron a la derecha. Toda la tarjeta es clicable. |
| `Boton` | Variantes: `principal` (sólido primario), `secundario` (sólido índigo), `contorno`, `fantasma`, `destructivo` (contorno + icono). Tamaños sm / md / lg. |
| `Campo` | Etiqueta, control, texto de ayuda y mensaje de error. El texto de ayuda siempre visible, no en tooltip. |
| `Tabla` | Cabecera `--ink-muted` en 12px mayúsculas, filas con separador hairline, **sin cebra**, hover de fila sutil. Números con `tabular-nums` y alineados a la derecha. |
| `Pastilla` | Para estados: Activo, Inactivo, Libre, Ocupada, Anulada. Icono + texto, fondo suave. |
| `Aviso` | Alerta en línea con icono, para las advertencias del sistema (costos en cero, costo que no coincide, precios que quedan inservibles). Variantes info / aviso / serio / crítico. |
| `EstadoVacio` | Icono, frase de qué falta y botón de la acción que lo resuelve. Nunca una tabla vacía sin explicación. |
| `Dialogo` | Confirmación de una acción irreversible. El título nombra lo que se va a hacer. Botón de confirmar en variante `destructivo` (desactivar, anular, eliminar) o `principal` (irreversible pero no destructiva, p. ej. cargar saldo). |
| `Cargando` | Esqueletos con la forma del contenido, no un spinner centrado. |
| `Interruptor` | Switch binario con efecto inmediato (p. ej. "Vende contra saldo"), sin botón de guardar aparte. |

---

## 5. Gráfico del panel

Un solo gráfico en el MVP: **ingresos de los últimos 7 días**.

- **Forma:** barras verticales. Son periodos discretos y lo que importa es la magnitud por día.
- **Serie única.** Sin leyenda — el título nombra la serie.
- **Color:** `--secundario` (índigo). No el rojo de marca: barras rojas se leen como pérdida, y además el color de los datos no debe ser el mismo de las acciones.
- **Marcas:** barras delgadas, extremo superior redondeado 4px, ancladas a la línea base, 2px de separación entre barras.
- **Ejes:** línea base `--ink-muted` al 40%, rejilla horizontal hairline y recesiva, etiquetas en 12px `--ink-muted`.
- **Hover obligatorio:** tooltip por barra con el día, el número de ventas y el monto.
- **Sin datos:** estado vacío con el texto "Aún no hay ventas en este periodo", no un gráfico plano en cero.

**Regla permanente: nunca un gráfico con dos escalas verticales.** Si hace falta mostrar ingresos y utilidad a la vez, son dos gráficos o dos tiles, jamás dos ejes. Si algún día se agrega una segunda serie, hay que validar la paleta antes de usarla.

---

## 6. Pantallas

### `/vender` — la pantalla estrella

Es la que más se usa y la única con tratamiento especial. Sin barra lateral desplegada en móvil; el foco es el flujo. Tres pasos progresivos en una sola pantalla — nunca rutas separadas — para que retroceder no pierda estado.

1. **Paso 1 — tres pastillas grandes de modo**: UNIDAD / PAQUETE / PROMOCIÓN, cada una con ícono, nombre y conteo de ítems ("12 plataformas", "4 paquetes"). El conteo viene de los datos de grilla, cargados una sola vez al montar la pantalla, no al presionar cada pastilla. UNIDAD usa `--primario-suave`/`--primario-texto` (el rojo de marca, por ser el tipo de venta más frecuente); PAQUETE y PROMOCIÓN usan los tonos nuevos de [§2 "Tonos de categoría"](#tonos-de-categoría--vender-paso-1).
2. **Paso 2 — modal de selección**, abierto al presionar una pastilla: una grilla de tarjetas con logo (`LogoPlataforma`, con reserva al inicial sobre `--plano` si no hay `logoUrl` o si la imagen falla al cargar — nunca un ícono de imagen rota) y, debajo del logo, su disponibilidad.
   - En UNIDAD: **todas** las plataformas activas, sin excepción. Las de cero pantallas libres se muestran **deshabilitadas con el motivo** ("sin pantallas libres"), nunca ocultas — que el callejón sin salida deje de existir en vez de descubrirse después.
   - En PAQUETE/PROMOCIÓN: paquetes con los logos pequeños de sus plataformas componentes y si son armables ahora mismo. Armabilidad es independiente de la duración (ver nota técnica abajo); un paquete sin ningún precio activo pero con inventario libre sigue apareciendo armable, solo deshabilitado por precio con su motivo ("sin precio configurado").
   - Más de 12 tarjetas → aparece un buscador arriba de la grilla.
   - El modal se cierra sin elegir nada con la X o tocando fuera; cerrarlo no pierde el paso 1.
3. **Paso 3 — selectores progresivos**, revelados solo después de elegir un ítem en el modal: duración y tipo de cliente (poblados desde `GET .../opciones`, que nunca incluye `costo` ni `utilidad`), el precio calculado en el cliente a partir de la combinación elegida, el campo de celular, y el botón VENDER. Si `opciones` viene vacía, el paso 3 lo dice explícitamente en palabras ("Esta plataforma no tiene combinaciones de precio configuradas") en vez de mostrar selectores vacíos.
   - Un botón de retroceso siempre visible desde el paso 3 vuelve al paso 1 sin perder qué pastilla estaba abierta ni reabrir el modal innecesariamente.
4. **Botón VENDER sólido primario, ancho completo, altura 56px.** Es la única acción sólida de la pantalla — ninguna de las tres pastillas de modo ni las tarjetas del modal usan relleno sólido.
5. Al vender: la tarjeta del mensaje reemplaza el formulario, con el texto en fuente monoespaciada dentro de un bloque, un botón grande **Copiar mensaje**, y debajo un botón de contorno **Nueva venta**.
6. Confirmación visible al copiar — una pastilla verde "Copiado" junto al botón, no un toast que desaparezca antes de que lo vean.
7. Un error del servidor, una vez mostrado, sobrevive a un refresco posterior de datos en segundo plano — no lo reemplaza un reintento silencioso.

**Nota técnica — por qué el paso 2 no depende de la duración:** si una pantalla está libre u ocupada depende solo de las ventas *ya registradas* (R5: `VentaDetalle.fechaVencimiento` + `anulada`), nunca de una venta hipotética todavía sin crear. Lo mismo vale para la armabilidad de un paquete: su composición (qué plataformas, cuántas pantallas de cada una) no cambia con la duración elegida — solo cambia qué vencimiento recibe cada componente al momento de vender (`resolverComposicionDePaquete`), que es irrelevante para "¿se puede armar esto ahora mismo?". Por eso el paso 2 pregunta disponibilidad una sola vez, antes de pedir duración, y el paso 3 solo filtra combinaciones de precio ya existentes — nunca vuelve a consultar inventario.

### `/panel` — inicio del administrador

1. Fila de cuatro `TileDato`: ventas de hoy, ingresos de hoy, utilidad de hoy, pantallas disponibles.
2. Si hay precios con costo en cero, un `Aviso` arriba de todo explicando que la utilidad mostrada no es real.
3. Gráfico de ingresos de 7 días.
4. Tres `TarjetaAcceso`: Vender, Cuentas, Precios.
5. Tabla de las últimas 10 ventas con enlace a la lista completa.

### Pantallas de lista (plataformas, duraciones, tipos de cliente, paquetes, cuentas, usuarios, empresas)

Patrón único: título, botón de alta arriba a la derecha, filtros en una fila, tabla, estado vacío. El alta y la edición en panel lateral deslizante, no en página aparte — menos navegación.

### `/precios`

Dos pestañas. La matriz con duraciones en filas y tipos de cliente en columnas, celdas con dos campos. Cabeceras de fila y columna fijas al hacer scroll. Las celdas modificadas se marcan hasta guardar, y el botón de guardar muestra cuántas hay pendientes.

### Paquetes — matriz de excepciones

Duraciones en filas, plataformas en columnas. Cada celda, un selector cuyo valor por defecto dice "igual a la vendida". Las celdas con excepción se destacan con fondo `--secundario-suave` para que se vean de un golpe.

---

## 7. Reglas de accesibilidad

- Todo control alcanzable con teclado, con anillo de foco visible de 2px en `--secundario`.
- Ningún estado comunicado solo con color: siempre icono o texto.
- Contraste mínimo 4.5:1 en texto de cuerpo.
- Los mensajes de error se asocian al campo con `aria-describedby`.
- El modo oscuro es un conjunto de valores elegidos, no una inversión automática.
