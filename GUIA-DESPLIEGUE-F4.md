# Despliegue de F4.1 → F4.6

**Un solo commit, un solo despliegue.** La versión anterior de esta guía planeaba tres olas con ramas separadas; eso ya no es posible. Las seis entregas están en el árbol de trabajo de `main`, 86 archivos sin commitear, y `apps/api/prisma/schema.prisma` es un único archivo con el estado final — no existe "el schema después de F4.2" sin editarlo a mano. Reconstruir la separación cuesta más riesgo del que quita.

Lo que sí se conserva es la **verificación por bloques**: se despliega una vez y se verifica en orden. Si algo falla, sabes qué entrega es, aunque el rollback sea de todo.

---

## Fase 0 — Arreglar antes de commitear

Dos de estos no son pulido: son cosas que **no se pueden arreglar después**.

### 0.1 — `lib/ventas.ts`: costo en `null`, no en cero

Tres sitios (~201, ~248, ~597). Cuando no hay `CostoPlataforma`, el renglón de `VentaDetalle` debe quedar en `null`. `Venta.costo` se queda como está.

**Por qué va primero:** cada venta que el cliente haga después del despliegue con costos sin cargar queda grabada como "costó cero", y después **nadie puede distinguirla** de una que de verdad costó cero. Es pérdida de información permanente, y es exactamente la causa de que el cliente reportara una ganancia inflada en su momento.

### 0.2 — `/garantias/costo-externo` solo ADMIN

Hoy está bajo el único `requiereRol(Rol.EMPLEADO)` del router, recibe `plataformaId` y `duracionId` por query, y devuelve el costo. Un EMPLEADO puede recorrer la tabla de costos completa combinando valores. Escalarlo a ADMIN a mitad de cadena, y mostrar la línea de pérdida en el diálogo solo al ADMIN.

**Por qué va antes y no después:** es exposición de datos. Una vez arriba, ya pasó.

### 0.3 — Los cinco baratos

- Bloques de usuario, código y enlace en `PLANTILLA_UNIDAD_POR_DEFECTO` y `PLANTILLA_RESPALDO_UNIDAD`, con `*CÓDIGO:*` acentuado igual que `bloqueListaCuentas()`.
- El diagnóstico de PIN inconsistente visible para el ADMIN de la empresa, no solo para el SUPER_ADMIN.
- Al cambiar el **perfil** de una pantalla, adoptar el PIN de las hermanas de ese perfil.
- El 409 de `PANTALLA_VENDIDA` con **todos** los códigos de compra, no uno.
- Borrar la copia de `letraPerfil` en `plataformas/page.tsx:51` e importarla de `@dismanet/shared`.
- Borrar `preciosConCostoCero` de `diagnostico-empresa.ts` (lee `Precio.costo`, columna que ya nadie escribe).

### 0.4 — Cerrar la verificación local

```
cd apps/api && npx tsc --noEmit && bun test
cd ../web && npx tsc --noEmit && bun test
```

`bun test` **desde `apps/api`**, nunca desde la raíz: Bun lee el `.env` del directorio actual y vive ahí.

Y tres cosas a ojo, que ninguna prueba cubre:

- **Modo oscuro.** Están modificados `globals.css`, `aviso.tsx`, `pastilla.tsx`, `tarjeta-acceso.tsx`, `tile-dato.tsx` y `selector-empresa.tsx` sin que ningún reporte de entrega lo declarara. Probablemente es el arreglo pendiente de `--secundario-suave`. Míralo en oscuro antes de subirlo.
- **El tile de Garantía** separado de los tres productos, y ausente al entrar como VENDEDOR.
- **Anular la venta de prueba** de F4.4 (la de "Netflix + Disney+") y confirmar que libera **las dos** pantallas. Es la prueba que falta y además limpia los datos de demo.

---

## Fase 1 — Commitear

```
git add -A
git commit -m "feat: costos y utilidad, campos de cuenta por plataforma, garantia externa, venta multiproducto, estadisticas y garantia desde vender"
```

Un commit grande es peor que seis chicos, pero mejor que seis chicos mal partidos. Que el mensaje nombre las seis entregas es lo que te va a salvar cuando dentro de un mes busques dónde entró algo.

---

## Fase 2 — Respaldo

**Snapshot de Postgres en Railway.** Es el único botón de deshacer que existe para datos.

Hazlo ahora, no "cuando tenga tiempo". La migración de F4.4 es la primera de este lote que **escribe en filas existentes** (`UPDATE "Venta" SET "precioSugerido" = "precioVenta"`).

---

## Fase 3 — Desplegar

Migraciones que se van a aplicar, en orden:

```
20261010044425_costo_plataforma          (F4.1, nunca desplegada)
20261013200802_f42_campos_plataforma_pin
20261014204755_f43_garantia_externa
20261014220131_f44_venta_multiproducto
```

Pasos:

1. **Pausar el despliegue automático en Vercel.** Railway tarda minutos construyendo la imagen; Vercel tarda segundos. Si salen a la vez, el web nuevo le pide rutas a una API que todavía no las tiene.
2. **Push a main.** Railway construye y arranca.
3. **Mirar los logs del arranque de Railway**: tienen que verse las cuatro migraciones aplicándose por nombre. Después:
   ```
   curl https://<tu-api>.up.railway.app/salud
   ```
4. **Reanudar Vercel** y dejar que despliegue el web.
5. **Verificar** con la Fase 4.

**Hazlo cuando no estén vendiendo.** Railway reinicia el servicio.

---

## Fase 4 — Verificar, en este orden

**F4.1 — costos y utilidad**
- [ ] Entras como ADMIN **sin volver a loguearte** (ninguna migración toca sesiones)
- [ ] El aviso de costos faltantes aparece en el panel
- [ ] La utilidad ya no es igual al ingreso cuando hay costos cargados

**F4.2 — campos de cuenta y PIN**
- [ ] Una plataforma con usuario + código + enlace y **sin** correo se configura
- [ ] Una cuenta de esa plataforma se crea sin pedir correo
- [ ] Vendes esa plataforma: el mensaje trae los tres campos y **no** aparece `CORREO:` seguido de nada
- [ ] Un PIN de 6 dígitos se guarda; uno de 3 y uno de 7 se rechazan
- [ ] Cambiar el PIN de una pantalla con perfil repetido actualiza las hermanas y lo dice
- [ ] Cambiar el PIN de una pantalla vendida pide confirmación y nombra los códigos de compra

**F4.3 — garantía externa**
- [ ] Registras una: mensaje correcto, **sin `$0`**, sin etiqueta huérfana
- [ ] La pantalla entregada queda ocupada y no aparece disponible para vender
- [ ] El dashboard muestra la pérdida y **no** cuenta la venta externa en "Ventas de hoy"
- [ ] Como EMPLEADO: puedes registrarla y **no** ves la línea de pérdida

**F4.4 — venta multi-producto**
- [ ] Vender **un** producto da el mismo mensaje que antes
- [ ] Vender Netflix + Disney+ da **un** mensaje con los dos servicios
- [ ] Como ADMIN el campo de precio final aparece; como VENDEDOR **no existe**
- [ ] Filtrar el listado por Netflix encuentra la venta de Netflix + Disney+
- [ ] Anular esa venta libera **las dos** pantallas

**F4.5 — estadísticas**
- [ ] Las cuatro tablas, cada una con su línea de cobertura
- [ ] El aviso de costos aparece **arriba** si faltan costos
- [ ] Como EMPLEADO y como VENDEDOR: no está en el menú y la ruta da 403
- [ ] Desde el teléfono, ninguna tabla desborda

**F4.6 — garantía desde Vender**
- [ ] El tile aparece como EMPLEADO, separado de los tres productos
- [ ] Con un código de compra real llegas a la fila correcta
- [ ] Con "fue por fuera" se abre el diálogo de garantía externa
- [ ] Como VENDEDOR el tile no está y vender funciona igual

---

## Fase 5 — Los costos, y la reparación

**Esto no bloquea el despliegue ni el cobro.** Bloquea que las cifras de utilidad signifiquen algo.

1. El cliente carga la tabla de costos.
2. **Snapshot de la base otra vez**, aparte del de la Fase 2.
3. Simulación, sin escribir nada:
   ```
   cd apps/api && bun run reparar:costos-historicos
   ```
   Imprime cuántas ventas repararía y cuántas quedan sin costo determinable, con su código de compra y el motivo.
4. **Leer los números y compararlos con lo que el cliente dice que ganó.** En dev dio 0 reparables y 6 indeterminables, y eso no dice nada de sus ventas reales. Si quiere tocar algo que no esperas, para.
5. Solo entonces:
   ```
   bun run reparar:costos-historicos -- --aplicar
   ```

**Mientras él no cargue los costos**, la pantalla de estadísticas va a mostrar su aviso arriba. Eso es a tu favor: es evidencia visible, dentro del producto, de que esa parte depende de él.

---

## Si algo sale mal

**Revertir el código es seguro. Revertir la base, no.**

Las cuatro migraciones son aditivas, así que el código anterior funciona igual contra la base nueva: revertir el commit y empujar alcanza.

**Lo que sí rompe:** quitar del repo una carpeta de migración ya aplicada en producción. `prisma migrate deploy` falla cuando la base tiene migraciones que el repo no tiene, y como el contenedor corre `npx prisma migrate deploy && bun run src/index.ts`, ese fallo significa que **el API nunca arranca**. Ya pasó con el rollback de F3.3.

Receta correcta:

```
git revert --no-commit <commit>
git checkout <commit> -- apps/api/prisma/migrations apps/api/prisma/schema.prisma
git commit
```

Deshaz el código, **deja la migración y el schema donde están**.

---

## Lo que queda abierto

- Los **logos** del cliente (SVG). Bloqueado en él.
- Restaurar **F3.3**: `git revert 9cad817`; el código vive en `bcff04b`. **El tile de garantía de F4.6 tiene que viajar a la grilla nueva** — si no se anota, se pierde en el merge, igual que se perdió `--secundario-suave`.
- **Rotar la contraseña del admin.** Viajó por mensajería.
- **Probar una restauración de respaldo de verdad.** Es la única parte del plan de desastre sin verificar.
- `whereDesdeFiltros()` interpreta las fechas como UTC, no como Bogotá. Entrega propia, con aviso al cliente.
- `mock.module` en Bun es global al proceso: todo mock de un módulo compartido debe exponer la superficie completa. Va a `CLAUDE.md`.
- Búsqueda de garantía sin `@`: si el valor no tiene arroba va a `codigoCompra` y no encuentra nada sin explicar por qué.
- `Plataforma.capacidadPantallas` y las filas de `PlataformaPantalla` son dos fuentes de verdad del mismo dato.
- Las tablas de usuarios y de pantallas vendidas se desbordan en celular.
- Comentario viejo en `pantallas-vendidas-contenido.tsx` dice que la vista la usa el VENDEDOR; desde F3.1 es EMPLEADO.
