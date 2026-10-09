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
| `--secundario-suave` | `#EEF2FF` | `#E4E2FA` | Fondos de énfasis secundarios |

`--primario`, `--primario-hover` y `--secundario` se usan como relleno sólido o como texto plano — nunca como panel grande — así que el mismo valor funciona en ambos temas y no se invierte.

`--primario-suave`/`--primario-texto` y `--secundario-suave` sí son paneles grandes (fondo del ítem activo del menú, pastillas, celdas de excepción): invertir `#FEF3F2` daría un negro casi puro sin relación con `--primario`, y dejarlo sin valor oscuro es el bug que esto corrige (bloque casi blanco sobre la barra negra). El oscuro es un tono elegido a mano:

- `--primario-suave` oscuro (`#3A1412`, un marrón-rojo muy oscuro) + `--primario-texto` oscuro (`#FFB4A8`, un salmón claro) dan **9.6:1** — el texto sigue siendo "rojo de marca", solo que claro sobre oscuro en vez de oscuro sobre claro.
- `--secundario` no cambia de valor entre temas (ver arriba), así que `--secundario-suave` oscuro tiene que seguir siendo un panel *claro* para que ese mismo `#4F46E5` siga leyéndose encima — oscurecerlo también habría bajado el contraste texto/fondo en vez de subirlo. `#E4E2FA` (un lavanda ligeramente más denso que el `#EEF2FF` claro, elegido para esta medición, no igual a ella) da **5.0:1** contra `--secundario` sin tocar ese token.

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
