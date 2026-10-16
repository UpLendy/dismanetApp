# F4.6 — Garantía como una operación más de Vender

**Alcance:** un cuarto botón en la pantalla de Vender, junto a Unidad, Paquete y Promoción, que arranca una garantía. Solo front y navegación.

**Fuera de alcance, no lo construyas:** ningún endpoint nuevo, ninguna migración, ningún cambio en la lógica de garantías. Los dos flujos ya existen y funcionan.

---

## Por qué esta entrega existe

Para el cliente, **dar una garantía es una operación del mismo rango que hacer una venta**: algo que él ejecuta, no algo que se busca dentro de un listado. Hoy para reemplazar una pantalla hay que irse a "Pantallas vendidas" y buscar. Él quiere empezar desde donde trabaja.

Tiene razón en el modelo mental, y lo que pide es barato: toda la funcionalidad existe, falta la puerta.

---

## Las cuatro decisiones ya tomadas

**1. El tile no abre un formulario nuevo: lleva a donde ya está el trabajo.**

Al pulsar **Garantía**, la pantalla de Vender hace una sola pregunta:

> ¿La venta está en el sistema?
> - **Sí** → un campo para el código de compra o el correo de la cuenta → al enviar, navega a `/pantallas-vendidas?codigoCompra=<valor>` (o `?correoCuenta=<valor>`)
> - **No, fue una venta hecha por fuera** → navega a `/pantallas-vendidas?garantiaExterna=1`, y esa pantalla abre sola el diálogo de garantía externa

`routes/garantias.ts` ya acepta los filtros `codigoCompra` y `correoCuenta`, los dos con `contains` e insensibles a mayúsculas (líneas 78 y 87). No hay nada que agregar en el servidor.

**2. NO extraigas los diálogos a componentes compartidos para montarlos dentro de Vender.**

Sería la respuesta instintiva y es la equivocada. `pantallas-vendidas-contenido.tsx` ya tiene `abrirReemplazo`, `confirmarReemplazo`, `abrirExterna` y `confirmarExterna`, cada uno con su estado de error, su mensaje generado y su botón de copiar. Moverlos o duplicarlos crea dos implementaciones de la misma cosa, que es el error que más veces se ha repetido en este proyecto.

Con navegación por parámetros hay **cero duplicación**: el salto se hace desde Vender y el trabajo ocurre donde están los datos — la fila, el estado de la pantalla, el correo de la cuenta, el historial. Eso es mejor para quien atiende la llamada, no solo más barato.

Lo que sí hay que agregar en `/pantallas-vendidas`: leer los parámetros de la URL hacia el estado de filtros al montar, y disparar `abrirExterna()` una sola vez cuando llegue `garantiaExterna=1`. Una sola vez — no en cada render, o el diálogo se reabre al cerrarlo.

**3. `Garantía` NO entra en el tipo `Modo`.**

```ts
type Modo = "UNIDAD" | "PAQUETE" | "PROMOCION";
```

Ese tipo significa "qué categoría de producto estoy vendiendo", y de él cuelgan `categoria`, `productosVisibles`, la carga de opciones, la búsqueda de precio y el reparto por `esPromocion`. Meterle un valor que no es un producto hace que una docena de ramas tengan que preguntar "¿y si es garantía?", y alguna se va a olvidar. Garantía va en su propio estado, separado.

**4. El tile no puede verse igual a los otros tres.**

Unidad, Paquete y Promoción son productos que entran plata. Garantía **saca una pantalla del inventario y registra una pérdida**. Si queda como un cuarto botón idéntico en la misma fila, alguien lo va a pulsar creyendo que es un producto.

La distinción va **por forma, no por color**: `DISENO.md §2` reserva los colores de estado y prohíbe usarlos como decoración. Entonces: separado del grupo de tres —otra fila, o el mismo renglón con una separación clara— y con tratamiento secundario o de contorno, nunca el relleno rojo de marca del botón de venta.

---

## El rol

El tile **no aparece** cuando el rol es `VENDEDOR`. Ausente, no deshabilitado: un botón que da 403 al pulsarlo es peor que un botón que no está.

`/vender` está abierto a VENDEDOR, pero las garantías son `requiereRol(Rol.EMPLEADO)` en adelante, y el servidor ya responde 403 — esto es ocultar lo que no sirve, no control de acceso (R4 sigue estando en el servidor, donde ya está).

**Reusa el mecanismo que ya existe.** F4.4 agregó a esta misma pantalla una llamada a `api.perfil.get` para decidir si se muestra el campo de precio final. Usa ese mismo rol para decidir el tile; no agregues una segunda forma de preguntar quién es el usuario.

En la práctica esto hace lo correcto sin que nadie lo pida: la migración de F3.1 convirtió en EMPLEADO a todos los `VENDEDOR` sin saldo, así que el personal del cliente va a ver el tile y **solo los revendedores con saldo no** — que son justamente quienes no deben regalar pantallas a costa de la empresa.

---

## Pruebas

- `apps/web/app/(protegido)/(vendedor)/vender/page.test.tsx` ya existe y ya tiene `mockPerfilGet`. Agrega: con rol `EMPLEADO` el tile de Garantía está presente; con rol `VENDEDOR` **no está en el árbol renderizado** (no "está deshabilitado").
- Pulsar Garantía y elegir "sí, está en el sistema" con un código escrito navega a `/pantallas-vendidas` con ese `codigoCompra` en la URL.
- Elegir "fue por fuera" navega con `garantiaExterna=1`.
- En `/pantallas-vendidas`: llegar con `codigoCompra` en la URL deja el filtro aplicado; llegar con `garantiaExterna=1` abre el diálogo **una sola vez** — cerrarlo no lo reabre.
- Nada de lo anterior toca `app-compuesta.test.ts`: no hay rutas nuevas de API en esta entrega. Si terminas agregando una, algo se desvió del alcance.

## Terminado cuando

1. `npx tsc --noEmit` limpio en las dos apps. **Córrelo y pega la salida real.**
2. `bun test` pasa, en `apps/api` y en `apps/web`.
3. Desde la interfaz como EMPLEADO: el tile aparece, separado visualmente de los tres productos; con un código de compra real llegas a la fila correcta con el botón de Reemplazar al lado; con "por fuera" se abre el diálogo de garantía externa.
4. Como VENDEDOR: el tile no está, y vender sigue funcionando igual.
5. No quedan `TODO` ni datos quemados.

## Al entregar

Un registro corto: archivos tocados, salida real de `tsc` y `bun test`, qué decidiste distinto de este prompt y por qué, qué quedó sin hacer. **Nombra las desviaciones aunque te parezcan correctas.**

---

## Nota para el futuro, no para esta entrega

Cuando se restaure F3.3 (`git revert 9cad817`, el código vive en `bcff04b`), la grilla de productos se rediseña y **este tile tiene que viajar a la grilla nueva**. Si no se anota, se pierde en el merge — así se perdió el arreglo de `--secundario-suave` cuando se revirtió F3.3 la primera vez.
