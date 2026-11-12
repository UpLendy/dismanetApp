# F4.12 y F4.13 — Rendimiento

Dos entregas separadas, para correr una después de la otra. La primera toca
R5 y necesita que las pruebas de concordancia sigan pasando; la segunda es
independiente y de riesgo bajo. Si la primera se complica, la segunda se
puede desplegar igual.

Contexto medido: ~8.700 pantallas activas en 1.400 cuentas, creciendo ~22%
cada cuatro días, con 98% de ocupación. El volumen es el problema, no el
código en abstracto.

---

# F4.12 — Una sola consulta de disponibilidad (N+1)

## El problema

Cuatro sitios recorren las plataformas una por una pidiendo disponibilidad:

| archivo | línea aprox. |
|---|---|
| `apps/api/src/routes/disponibilidad.ts` | 65 |
| `apps/api/src/lib/paquetes.ts` | 121 |
| `apps/api/src/lib/pantallas.ts` (`plataformasDisponibles`) | 252 |
| `apps/api/src/lib/pantallas.ts` (`plataformasConInventario`) | 292 |

Todos con la misma forma:

```js
plataformas.map(async (plataforma) => {
  const estados = await pantallasDisponibles(cliente, plataforma.id);
  return estados.filter((e) => e.libre).length;
})
```

`pantallasDisponibles` hace un `findMany` con `include` anidado **más** un
`groupBy`. Sumado sobre todas las plataformas eso carga todas las pantallas
del negocio a memoria, dos veces, en 2N viajes a la base — y la pantalla
Vender dispara esto cada vez que el vendedor cambia la duración o el tipo de
cliente.

F4.11 lo empeoró: antes era una consulta por plataforma, ahora son dos,
porque se agregó el `groupBy` para comparar contra `liberadaEn`.

## La observación que hace el arreglo fácil

Los cuatro sitios **solo necesitan conteos**, no el detalle por pantalla. Y
el estado completo se deriva de tres valores, sin el `include` anidado:

| `ultimoVencimiento` | condición | estado |
|---|---|---|
| `null` | — | LIBRE |
| `> ahora` | — | OCUPADA |
| `<= ahora` | `liberadaEn === null` o `ultimoVencimiento > liberadaEn` | POR_REINICIAR |
| `<= ahora` | resto | LIBRE |

El `include` de `ventaDetalles` vigentes solo hace falta para
`ocupadaHasta`, `ventaId` y `codigosCompraAfectados`, que únicamente usan el
detalle de cuenta y el 409 de pantalla vendida.

## Qué hacer

### 1. Extraer la regla a una función pura

En `pantallas.ts`, una sola función que sea **el hogar de R5**:

```ts
export function estadoDesde(
  liberadaEn: Date | null,
  ultimoVencimiento: Date | null,
  ahora: Date,
): "LIBRE" | "OCUPADA" | "POR_REINICIAR"
```

Pura, sin base de datos, exportada y probada directamente. A partir de aquí
**todas** las rutas de lectura la llaman: no se vuelve a escribir la
condición en ningún otro lado de TypeScript.

### 2. Conteo por plataforma, dos consultas para todo

```ts
export async function contarPantallasPorPlataforma(
  cliente: ClienteEmpresa,
  plataformaIds?: string[],
): Promise<Map<string, ConteoPantallas>>
```

- Consulta 1: `pantalla.findMany` con
  `{ activa: true, cuenta: { activa: true, ...(plataformaIds ? { plataformaId: { in: plataformaIds } } : {}) } }`
  y un `select` **mínimo**: `id`, `liberadaEn`, `cuenta: { select: { plataformaId: true } }`.
  Sin `include` de `ventaDetalles`.
- Consulta 2: el `groupBy` de `ventaDetalle` por `pantallaId` con
  `_max: { fechaVencimiento: true }` y `venta: { anulada: false }`, igual que
  hoy.
- Agrupar en memoria con `estadoDesde`.

Dos consultas en total, para todas las plataformas, con filas de tres
campos. Hoy son 2N consultas con filas anidadas.

### 3. Reemplazar los cuatro bucles

Cada uno pasa a una sola llamada a `contarPantallasPorPlataforma` y lee del
`Map`. `disponibilidad.ts` necesita `libres` y `porReiniciar`;
`paquetes.ts`, `plataformasDisponibles` y `plataformasConInventario` solo
`libres`.

### 4. `estadoDePantallas` se queda, usando la misma función

Sigue existiendo para el detalle de cuenta, el 409 y
`GET /cuentas/por-reiniciar`. Cambia solo en que calcula el estado llamando
a `estadoDesde` en vez de tener la condición escrita adentro. Agrega
`plataformaId` a `EstadoPantalla` (vía `cuenta: { select: { plataformaId: true } }`),
que hace falta para agrupar.

### 5. Lo que NO se toca

- El SQL crudo de `bloqueo-pantallas.ts`. Sigue siendo la implementación
  independiente para asignar bajo `FOR UPDATE SKIP LOCKED`, y sigue teniendo
  que coincidir.
- `garantias.ts:88` (`soloVigentes`), que significa otra cosa.
- No agregues una quinta implementación de la regla. Si te hace falta la
  condición en algún sitio nuevo, llama a `estadoDesde`.

### 6. Pruebas

- Las 8 de `pantallas-retencion.test.ts` **pasan sin modificar**. Si alguna
  necesita cambiar, para y dime por qué antes de tocarla.
- Extiende la prueba de concordancia a un **cuarto** participante:
  `contarPantallasPorPlataforma` tiene que coincidir con
  `estadoDePantallas`, con el SQL crudo y con el diagnóstico, sobre los
  mismos datos.
- Pruebas directas de `estadoDesde` para las cuatro filas de la tabla de
  arriba, incluida la de `liberadaEn` anterior al vencimiento.
- Una prueba de que `contarPantallasPorPlataforma` no hace más de dos
  consultas sin importar cuántas plataformas haya (cuenta las llamadas con
  un espía, o verifica que no haya `await` dentro de un `map` sobre
  plataformas).

Al terminar, reporta cuántas consultas hace hoy `GET /disponibilidad` con N
plataformas y cuántas hace después.

---

# F4.13 — Paginación del listado de ventas

## El problema

`GET /ventas/mias` (línea ~597) y `GET /ventas/listado` (línea ~653) no
tienen `take`, `skip` ni `cursor`: devuelven **todas** las ventas, cada una
con `mensajeGenerado` —el texto completo de WhatsApp, ~800 caracteres— y
todos sus `detalles`. Un vendedor con 2.000 ventas se baja varios MB de JSON
para ver una pantalla donde caben 20 filas.

## Qué hacer

### 1. Paginar por cursor

`take` (por defecto 25, máximo 100) y `cursor` opcional en las dos rutas.

**El orden tiene que ser determinista o el cursor se salta o repite filas.**
Hoy es `orderBy: { fechaVenta: "desc" }` y `fechaVenta` no es única — dos
ventas del mismo instante rompen la paginación. Usa
`orderBy: [{ fechaVenta: "desc" }, { id: "desc" }]`, el cursor sobre `id` y
`skip: 1`.

La respuesta devuelve `{ ventas, siguienteCursor }`, con `siguienteCursor`
en `null` cuando no hay más. Los filtros existentes
(`whereDesdeFiltros`) siguen funcionando igual y se combinan con el cursor.

### 2. Sacar `mensajeGenerado` del listado

Quítalo del `select` de las dos rutas. Es el grueso del peso y casi nunca se
usa: el vendedor copia el mensaje de una venta, no de las 2.000.

### 3. Ruta nueva para el mensaje

`GET /ventas/:id/mensaje` que devuelva solo `{ mensajeGenerado }`. Mismos
permisos que el listado del que se llama: un VENDEDOR solo puede pedir el
mensaje de una venta suya (`vendedorId === contexto.usuarioId`), ADMIN
cualquiera de su empresa. R1 como siempre.

Decláralo después de las rutas estáticas del archivo por legibilidad.

### 4. Frontend

- `apps/web/app/(protegido)/(vendedor)/ventas/ventas-contenido.tsx:166` copia
  `venta.mensajeGenerado` de la fila. Cámbialo por: al hacer clic, pedir
  `GET /ventas/:id/mensaje` y copiar el resultado. Deja el botón en estado de
  carga mientras llega y maneja el error sin romper la página.
- Botón "Cargar más" al final de la lista que pida la página siguiente con
  `siguienteCursor` y agregue las filas. No hace falta scroll infinito.
- Revisa si el listado de ADMIN usa `mensajeGenerado` en algún lado; si sí,
  el mismo tratamiento.

### 5. Pruebas

- Dos páginas seguidas no repiten ni se saltan ventas, incluso con varias
  ventas con el mismo `fechaVenta` al segundo.
- `take` por encima del máximo se recorta a 100.
- El listado ya no trae `mensajeGenerado`.
- `GET /ventas/:id/mensaje`: un VENDEDOR no puede pedir el mensaje de una
  venta de otro vendedor (403 o 404, el que ya use el proyecto); R1 entre
  empresas.
- Los filtros existentes siguen funcionando combinados con el cursor.

---

## Al terminar las dos

Reporta archivos tocados, pruebas antes y después, y explícitamente: cuántas
consultas hace `GET /disponibilidad` antes y después, y cuánto pesa la
respuesta de `GET /ventas/mias` antes y después con los datos de prueba.
