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

Del manual de marca del cliente (valores RGB tal cual el documento): rojo **#EB0028** (R235 G0 B40), negro **#000000**, azul **#65ACFF** (R101 G172 B255) — el manual marca el azul como complementario y lo limita a **no más del 15% de la composición**.

| Rol | Claro | Oscuro | Uso |
|---|---|---|---|
| `--primario` | `#EB0028` | `#EB0028` | Identidad, ítem activo de navegación, **la acción principal de cada pantalla** |
| `--primario-hover` | `#B8001F` | `#B8001F` | Estado hover del primario |
| `--primario-suave` | `#FEF1F3` | `#3A1219` | Fondo del ítem activo en la barra lateral, fondos de énfasis |
| `--primario-texto` | `#B8001F` | `#FFA8B7` | Texto sobre fondo suave |
| `--secundario` | `#0063D6` | `#65ACFF` | Acciones alternas, iconos de acceso directo, **marcas de los gráficos** |
| `--secundario-suave` | `#EBF4FF` | `#12273F` | Fondos de énfasis secundarios |
| `--secundario-contraste` | `#FFFFFF` | `#0D0D0D` | Texto/ícono encima de un relleno **sólido** `--secundario` (botón "secundario") |

**`--primario` es el rojo de marca sin modificar**, `#EB0028`. Contraste medido contra blanco: **4.59:1** — el texto blanco sobre el botón rojo sigue cumpliendo AA (≥4.5:1).

`--primario-hover` (`#B8001F`) es un tono más oscuro del mismo matiz (~350°, L 46%→36%): **6.87:1** contra blanco.

`--primario-suave`/`--primario-texto` están medidos de nuevo contra el rojo nuevo, no contra el `#D92D20` anterior:

- Claro: `--primario-suave` `#FEF1F3` (tinte pastel del mismo matiz) + `--primario-texto` `#B8001F` (el mismo tono que `--primario-hover`, reutilizado) dan **6.87:1** contra blanco y **6.24:1** contra el propio `--primario-suave`.
- Oscuro: `--primario-suave` `#3A1219` (marrón-rojo muy oscuro) + `--primario-texto` `#FFA8B7` (salmón claro) dan **9.01:1** contra `--primario-suave`, **9.57:1** contra `--superficie` oscuro y **10.68:1** contra `--plano` oscuro — todos ≥ 4.5:1.

**`--secundario` ya no es el mismo valor en los dos temas** (antes sí, con el índigo). El azul del manual, `#65ACFF`, da solo **2.36:1 contra blanco**: no sirve para texto ni iconos sobre fondo claro. Entonces:

- **Oscuro:** `--secundario` es el valor literal del manual, `#65ACFF` — ahí funciona como acento y como texto: **8.24:1** contra `--plano` oscuro, **7.38:1** contra `--superficie` oscuro.
- **Claro:** `--secundario` es un azul más oscuro derivado del mismo matiz (~212°, `#0063D6`), que da **5.59:1** contra blanco — cumple el 4.5:1 de texto y de sobra el 3:1 de componentes.
- `--secundario-suave` se invierte respecto al diseño anterior: en oscuro pasa a ser un panel **oscuro** (`#12273F`, antes era claro en los dos temas), porque ahora `--secundario` oscuro es un color *claro* (`#65ACFF`) y necesita un fondo oscuro para seguir leyéndose encima (**6.41:1**), el mismo patrón ya usado en `--primario-suave` oscuro. En claro, `--secundario-suave` (`#EBF4FF`) sigue siendo el panel pálido de siempre, con `--secundario` (`#0063D6`) encima a **5.04:1**.
- `--secundario-contraste` es nuevo: el texto que va *encima* de un relleno sólido `--secundario` (el botón "secundario" de `Boton`, antes tenía `text-white` fijo). Con `--secundario` claro (oscuro de por sí) el texto blanco funciona (**5.59:1**); con `--secundario` oscuro (`#65ACFF`, claro de por sí) el blanco fallaría (2.36:1), así que ahí el texto es casi negro, `#0D0D0D` (**8.24:1**).

**Revisar el 15% de azul** no cambia el uso existente de `--secundario`: sigue limitado a enlaces, el anillo de foco, el gráfico de 7 días, y fondos "suave" de pastillas/avisos — nunca un panel grande ni la acción principal. A ojo, en ninguna pantalla del admin el azul domina la composición.

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

`--primario` y `--critico` son parecidos — los dos son rojos. Con el rojo nuevo (`#EB0028`) medí la distancia real contra `--critico` (`#D03B3B`) para confirmar que seguían siendo distinguibles, y resultó que están **más separados que antes**, no menos: distancia euclídea en RGB de 67.6 (antes, `#D92D20` vs `#D03B3B`, era 31.7) y diferencia de matiz de 10.2° (antes 4.2°) — `--primario` es ahora un rojo más saturado y volcado a magenta (matiz ~350°, S 100%), mientras `--critico` es un rojo más apagado y neutro (matiz 0°, S 61%). La suposición de que se acercarían no se confirmó, pero el principio de diseño sigue aplicando igual: para que VENDER y Anular no se confundan, la distinción la carga **la forma, no el color**, sin depender de cuánto se parezcan los tonos:

- **Acción principal:** botón sólido con `--primario`. **Una sola por pantalla.**
- **Acción destructiva:** botón de contorno, texto `--primario-texto`, icono a la izquierda, y **siempre** diálogo de confirmación que nombre lo que se va a hacer.

Nunca un botón sólido rojo para destruir.

### Tipografía

El manual de marca pide **Alexandria** para titulares y **Museo Sans** para cuerpos. Museo Sans solo libera el peso 500 para web y la interfaz necesita 600 y 700 (etiquetas de dato, texto semibold, botones), así que:

- **Titulares y texto destacado — Alexandria**, cargada por `next/font/google` (`apps/web/app/layout.tsx`). Cubre título de página/sección/tarjeta y el valor de dato (28px/700): es el texto más prominente de todo el sistema, más grande que cualquier título, así que cuenta como "destacado".
- **Cuerpos — Nunito Sans**, cargada igual por `next/font/google`, como equivalente libre de Museo Sans. Cubre cuerpo y etiqueta de dato.

Las dos se declaran como variables CSS (`--font-alexandria`, `--font-nunito-sans`, inyectadas por `layout.tsx`) que alimentan `--font-sans` (cuerpo) y `--font-heading` (titulares) en `globals.css`. Cambiar la fuente de cuerpo el día que el cliente compre Museo Sans es una línea: redeclarar `--font-sans`, nada más — está comentado en el sitio.

| Rol | Tamaño / peso | Fuente |
|---|---|---|
| Título de página | 24px / 700 | Alexandria |
| Título de sección | 18px / 600 | Alexandria |
| Título de tarjeta | 16px / 600 | Alexandria |
| Cuerpo | 14px / 400 | Nunito Sans |
| Etiqueta de dato | 12px / 600, mayúsculas, `letter-spacing: .06em`, `--ink-muted` | Nunito Sans |
| Valor de dato | 28px / 700 | Alexandria |

Las dos son fuentes variables (un solo archivo cubre el rango de pesos), que es lo que recomienda Next.js para fuentes de Google: no hace falta declarar `weight` fijo, el `font-weight` de cada utilidad de arriba ya selecciona el corte correcto.

`tabular-nums` solo en columnas de tabla y ejes de gráfico, donde los números tienen que alinearse verticalmente. Los valores grandes sueltos van con cifras proporcionales — **excepto** el valor de dato (`.valor-dato`), que ya traía `tabular-nums` de la F4.9 (ver comentario en `globals.css`); Alexandria expone la característica OpenType `tnum`, así que el alineamiento no se pierde al cambiar de fuente.

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

Fija, 240px, fondo `--superficie`, borde derecho hairline. En móvil se colapsa a cajón (no a un ancho menor: es overlay completo o nada, por eso la "reducción a símbolo" del logo no tiene escenario que la dispare hoy).

- Arriba: el logo de marca (`apps/web/public/marca/`), no el nombre en texto. `logo-claro.png` (negro) en modo claro, `logo-oscuro.png` (blanco) en modo oscuro — se alternan por CSS con `:root[data-theme="dark"]` (`globals.css`), nunca con `prefers-color-scheme`, porque el tema lo decide el atributo `data-theme` que escribe `menu-usuario.tsx`, no el sistema operativo. 120px de ancho (el mínimo del manual para el logo completo — por debajo va el símbolo solo, que no aplica aquí) con `pl-10` (40px) de margen izquierdo: el manual pide un área de seguridad igual al ancho del símbolo, medido en ~36.5px a ese tamaño de logo. `next/image` con `width`/`height` explícitos, sin salto de layout.
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

### Favicon

`apps/web/public/favicon-32.png` (32px) y `apple-touch-icon.png` (180px), declarados en `metadata.icons` de `app/layout.tsx`. 32px y no 16: el manual fija el símbolo en 20px mínimo, y a 16px se violaría esa reducción mínima.

---

## 4. Componentes

Todos en `apps/web/components/ui/`, construidos sobre shadcn/ui, que ya está instalado.

| Componente | Notas |
|---|---|
| `Tarjeta` | Fondo `--superficie`, radio 12, borde hairline, padding 20. Con título y acción opcional en la cabecera. |
| `TileDato` | Etiqueta arriba (estilo etiqueta de dato), valor grande debajo, variación opcional con icono y color de estado. Es el bloque de los indicadores. |
| `TarjetaAcceso` | Icono en cuadrado de 48px con fondo de color y radio 12, título, descripción, chevron a la derecha. Toda la tarjeta es clicable. |
| `Boton` | Variantes: `principal` (sólido primario), `secundario` (sólido `--secundario`, texto `--secundario-contraste` — blanco u oscuro según el tema, ver §2), `contorno`, `fantasma`, `destructivo` (contorno + icono). Tamaños sm / md / lg. |
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
- **Color:** `--secundario` (el azul de marca). No el rojo de marca: barras rojas se leen como pérdida, y además el color de los datos no debe ser el mismo de las acciones.
- **Marcas:** barras delgadas, extremo superior redondeado 4px, ancladas a la línea base, 2px de separación entre barras.
- **Ejes:** línea base `--ink-muted` al 40%, rejilla horizontal hairline y recesiva, etiquetas en 12px `--ink-muted`.
- **Hover obligatorio:** tooltip por barra con el día, el número de ventas y el monto.
- **Sin datos:** estado vacío con el texto "Aún no hay ventas en este periodo", no un gráfico plano en cero.

**Regla permanente: nunca un gráfico con dos escalas verticales.** Si hace falta mostrar ingresos y utilidad a la vez, son dos gráficos o dos tiles, jamás dos ejes. Si algún día se agrega una segunda serie, hay que validar la paleta antes de usarla.

---

## 6. Pantallas

### `/vender` — la pantalla estrella

Es la que más se usa y la única con tratamiento especial. Sin barra lateral desplegada en móvil; el foco es el flujo.

1. Selector de modo **UNIDAD / PAQUETE** como dos pestañas grandes.
2. Tres selectores en fila: tipo de cliente, duración, producto. En móvil se apilan.
3. Cada opción de producto muestra su contador de disponibles y, si tiene, sus condiciones.
4. Tarjeta de resumen con el precio en grande antes de confirmar.
5. **Botón VENDER sólido primario, ancho completo, altura 56px.** Es la única acción sólida de la pantalla.
6. Al vender: la tarjeta del mensaje reemplaza el formulario, con el texto en fuente monoespaciada dentro de un bloque, un botón grande **Copiar mensaje**, y debajo un botón de contorno **Nueva venta**.
7. Confirmación visible al copiar — una pastilla verde "Copiado" junto al botón, no un toast que desaparezca antes de que lo vean.

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
