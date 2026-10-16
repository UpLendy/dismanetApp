# F4.5 — Estadísticas segmentadas

**Alcance:** una pantalla para el ADMIN que responda "qué se vendió, de qué, quién lo vendió y cuánto se ganó", segmentado por tipo de venta, por paquete, por plataforma y por vendedor, en un rango de fechas.

**Fuera de alcance, no lo construyas:** exportar a CSV o Excel, gráficos, comparativas entre periodos, proyecciones. Si las tablas quedan bien, eso se agrega después sobre datos ya correctos.

---

## Por qué esta entrega existe, y cuál es el riesgo

El cliente pidió *"un recopilado, segmentado entre paquetes, unidad, cuál paquete, que se segmente la información de las ventas, estadísticas más detalladas"*.

El riesgo de esta entrega no es que falte un número. Es que **sobre un número**. Este cliente ya reportó una vez una ganancia que no era real, y la causa fue que el sistema mostró una cifra sin decir que estaba construida sobre costos que nunca se habían cargado. Una estadística que suma lo que sí puede y calla lo que no, miente con más autoridad que un campo vacío.

Por eso la regla central de esta entrega, y es la que hay que respetar por encima de todo lo demás:

> **Cada tabla reporta su propia cobertura.** Al lado de cada segmento va, en texto, qué proporción de las ventas del periodo entra en ese cálculo y qué queda fuera. Un total sin su denominador no se muestra.

---

## Lo que se puede segmentar y lo que no

Esto no es una limitación a resolver: es la forma real de los datos. Hay que mostrarla, no taparla.

| Segmento | Fuente | Unidades | Ingreso | Costo / Utilidad |
|---|---|---|---|---|
| Tipo de venta (unidad / paquete / promoción) | `Venta` | completo | completo | completo |
| Paquete concreto | `Venta.paqueteId` | completo | completo | completo |
| Vendedor | `Venta.vendedorId` | completo | completo | completo |
| **Plataforma** | `VentaDetalle` | **completo** | **parcial** | **parcial** |

La fila de plataforma es la importante:

- **Unidades por plataforma está completo** para todo el histórico: cada `VentaDetalle` tiene su `plataformaId`. Esta es la cifra que la tabla por plataforma debe mostrar primero, porque es la única sin huecos.
- **El ingreso por plataforma solo existe para ventas por unidad hechas desde F4.4.** `VentaDetalle.precioSugerido` es nulo en los paquetes **a propósito** (el precio de un paquete es un bloque único de la matriz; repartirlo entre sus plataformas sería inventar un dato que nadie decidió) y es nulo en todo lo anterior a F4.4.
- **El costo por plataforma existe para todas las ventas desde F4.4**, paquetes incluidos, y es nulo hacia atrás.

Entonces la tabla por plataforma muestra: unidades (completo), y las columnas de dinero marcadas como **atribuible**, con su cobertura al lado. Nunca una utilidad por plataforma presentada como si fuera el total.

**`null` no es cero.** Un renglón sin costo registrado significa "no se sabe", y entra en el contador de "no determinable", nunca en la suma como un cero. Esa confusión es exactamente lo que infló la ganancia la primera vez.

---

## Parte 1 — El endpoint

`GET /ventas/estadisticas?desde=&hasta=`, **solo ADMIN y SUPER_ADMIN**. Todo lo que devuelve es dinero, así que va después de la escalada de rol que ya existe en `routes/ventas.ts`, nunca en el tramo abierto a VENDEDOR.

Un solo endpoint que devuelve todos los segmentos, no cinco endpoints. Razón: así todas las tablas comparten exactamente la misma ventana de fechas. Con cinco llamadas, un cambio de rango a mitad de carga deja tablas de periodos distintos sumando en la misma pantalla.

Respuesta, en forma:

```ts
{
  periodo: { desde: string; hasta: string },
  resumen: {
    numeroVentas, unidadesEntregadas,
    ingresos, costos, utilidad,
    descuentosOtorgados,   // suma de (precioSugerido - precioVenta) cuando es > 0
    recargosAplicados,     // suma de lo mismo cuando es < 0, en valor absoluto
    perdidaGarantias,
    ventasSinCostoRegistrado: number,   // cuántas ventas tienen algún renglón sin costo
  },
  porTipo:       [{ clave, etiqueta, numeroVentas, unidades, ingresos, costos, utilidad }],
  porPaquete:    [{ paqueteId, nombre, numeroVentas, unidades, ingresos, costos, utilidad }],
  porVendedor:   [{ vendedorId, nombre, numeroVentas, unidades, ingresos, costos, utilidad, descuentosOtorgados }],
  porPlataforma: [{
    plataformaId, nombre,
    unidades,                       // completo
    ingresoAtribuible,              // solo renglones con precioSugerido no nulo
    costoAtribuible,                // solo renglones con costo no nulo
    renglonesSinIngresoAtribuible,  // el denominador, no lo omitas
    renglonesSinCostoAtribuible,
    perdidaGarantias,
  }],
}
```

`descuentosOtorgados` y `recargosAplicados` van **separados, no netos**. Netearlos esconde los dos.

---

## Parte 2 — Las reglas que no se pueden romper

**R1, y aquí más que en cualquier otra entrega.** Esto es casi todo `groupBy` y `aggregate`, que son las dos operaciones que CLAUDE.md marca como las más peligrosas: sin filtro de empresa, el ADMIN de DISMANET vería sumado el dinero de las demás empresas. La extensión de Prisma ya cubre las dos — úsala siempre a través de `prismaParaEmpresa`.

**Nada de SQL crudo.** Escribir estadísticas es el momento en que uno quiere un `$queryRaw` con un `GROUP BY` bonito. No. `$queryRaw` no pasa por la extensión, está confinado a una lista blanca vigilada por una prueba, y una fuga aquí es dinero de otra empresa en el panel de este cliente. Si una agrupación no sale con el cliente extendido, se hace en varias consultas y se combina en TypeScript.

**Exclusiones, las dos:** `anulada: false` y `esExterna: false`. La segunda es de F4.3 — las ventas externas existen solo para sostener una garantía y no son ingresos. Que una estadística las cuente es exactamente el error contra el que F4.3 puso una prueba.

**La pérdida de garantías se imputa al día de la garantía, no al día de la venta.** Lo decidió el cliente explícitamente. `Garantia.createdAt` manda; `Venta.fechaVenta` no tiene nada que ver. Y la pérdida por plataforma se saca de la plataforma de la pantalla **reemplazada**.

**Las garantías externas sí cuentan en la pérdida.** Su venta de soporte se excluye de los ingresos, pero su `costoAsumido` es plata real que salió. En la tabla por plataforma, su pérdida se imputa a la plataforma que se entregó.

**R4:** ningún campo de este endpoint llega a un VENDEDOR ni a un EMPLEADO. La guarda en el servidor, no el menú.

---

## Parte 3 — La zona horaria, que hoy está mal

`whereDesdeFiltros()` en `routes/ventas.ts` construye el rango con `new Date(query.desde)`. Eso interpreta la fecha como medianoche **UTC**, no de Bogotá. Para un listado se nota poco; para una estadística por día o por mes, significa que "octubre" incluye las últimas cinco horas de septiembre y se come las últimas cinco de octubre.

`lib/periodos.ts` ya tiene `inicioDiaBogota`, `inicioSemanaBogota` e `inicioMesBogota`. Agrégale lo que falta para un rango arbitrario —inicio del día `desde` y fin del día `hasta`, los dos en `America/Bogota`— y que el endpoint de estadísticas lo use.

**No arregles `whereDesdeFiltros()` en esta entrega.** Cambiar los bordes del listado de ventas es un cambio de comportamiento visible que merece su propia entrega y su propio aviso al cliente. Déjalo anotado en el registro de entrega y ya.

Presets que el endpoint debe poder servir sin que el front calcule fechas a mano: hoy, esta semana, este mes, mes anterior, y rango libre.

---

## Parte 4 — El aviso de costos sin cargar

Si los costos no están cargados, la utilidad de esta pantalla no significa nada, y el cliente ya se equivocó una vez leyéndola así.

`lib/diagnostico-empresa.ts` ya calcula `preciosConCostoCero`. Úsalo: cuando haya precios activos sin costo registrado, o cuando `ventasSinCostoRegistrado` sea mayor que cero, la pantalla muestra **arriba, antes de las tablas**, un aviso que diga cuántas combinaciones de precio no tienen costo y que mientras eso siga así la utilidad que se muestra es un techo, no un dato.

No lo pongas como una nota al pie. Es la diferencia entre una herramienta y una cifra que genera una llamada del cliente.

---

## Parte 5 — Front

Una pantalla nueva en el panel del ADMIN: `/panel/estadisticas`, con su entrada en `nav.ts` con `rolMinimo: "ADMIN"` en el grupo que corresponda según `DISENO.md §3`.

Arriba: el selector de periodo con los presets y el rango libre. Debajo: el aviso de costos si aplica, los tiles del resumen, y las cuatro tablas.

**Tablas, no gráficos.** No hay librería de gráficos instalada en `apps/web`, y agregar una para una pantalla es alcance que no pedimos. Si una tabla pide una señal visual de magnitud, una barra hecha con un `div` y un ancho porcentual alcanza, usando los tokens de color de `DISENO.md §2` — nunca los colores de estado, que están reservados y no son decorativos.

Cada tabla lleva su línea de cobertura debajo del título, en texto normal y en español claro. Para la de plataforma, algo con esta forma: *"Unidades: todas las ventas del periodo. Ingreso y costo: 62% de los renglones; los paquetes y las ventas anteriores al 15 de octubre no permiten atribuir dinero por plataforma."*

Las tablas se desbordan en celular. Ya pasó con la de usuarios y con la de pantallas vendidas y sigue pendiente: aquí hazlo bien de entrada, con desplazamiento horizontal contenido y la primera columna fija si hace falta. El cliente revisa esto desde el teléfono.

---

## Pruebas

- **R1 es la prueba más importante de esta entrega.** Dos empresas con ventas en el mismo periodo: las estadísticas de una no incluyen ni un peso de la otra. Ejercita **cada** segmento, no solo el resumen — un `groupBy` sin envolver devuelve datos y se ve bien.
- **`app-compuesta.test.ts`**: la ruta nueva, montando la app como `index.ts`, con el caso sin sesión, VENDEDOR → 403, EMPLEADO → 403, ADMIN → pasa.
- **Nulo no es cero**: una venta anterior a F4.4 (renglones con `costo` nulo) y una posterior en el mismo periodo. La tabla por plataforma suma solo la segunda en `costoAtribuible` y cuenta la primera en `renglonesSinCostoAtribuible`. Si el nulo entra como cero, esta prueba falla.
- **Ingreso por plataforma en paquetes**: una venta de paquete no aporta `ingresoAtribuible` a ninguna de sus plataformas, y sí aporta unidades y costo.
- **Multi-producto**: una venta de Netflix + Disney+ aporta ingreso a **las dos** plataformas, cada una con su precio de catálogo, y su descuento aparece una sola vez en el resumen — no repartido, no duplicado.
- **Descuento y recargo no se netean**: un periodo con un descuento de 2.000 y un recargo de 500 reporta `descuentosOtorgados: 2000` y `recargosAplicados: 500`, no 1.500 en una sola cifra.
- **Garantías**: una venta de un mes y su garantía del mes siguiente — la pérdida cae en el segundo periodo, no en el primero. Y una garantía externa aporta pérdida sin aportar ingresos ni número de ventas.
- **Anuladas y externas** quedan fuera de todos los segmentos.
- **Zona horaria**: una venta a las 23:00 de Bogotá del último día del mes entra en ese mes, no en el siguiente.
- **Ninguna consulta de esta entrega usa `$queryRaw`**: la prueba de lista blanca que ya existe lo vigila; no la toques para agregar una entrada.

## Terminado cuando

1. `npx tsc --noEmit` limpio en las dos apps. **Córrelo y pega la salida real.**
2. `bun test` pasa, ejecutado **desde `apps/api`** (Bun lee el `.env` del directorio actual y vive ahí; desde la raíz fallan todas por `DATABASE_URL` vacío).
3. Desde la interfaz, como ADMIN: cambiar el periodo y ver las cuatro tablas con su línea de cobertura, y el aviso de costos si faltan.
4. Como EMPLEADO y como VENDEDOR, la pantalla no aparece en el menú y la ruta responde 403.
5. En ancho de celular, ninguna tabla desborda la página.
6. No quedan `TODO`, datos quemados ni credenciales en el código.

## Al entregar

Un registro corto: archivos tocados, salida real de `tsc` y `bun test`, qué decidiste distinto de este prompt y por qué, qué quedó sin hacer. **Nombra las desviaciones aunque te parezcan obvias o correctas** — la última vez una decisión buena quedó sin declarar y eso le quita valor al registro.
