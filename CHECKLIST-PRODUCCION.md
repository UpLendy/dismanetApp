# Checklist de producción — todo lo que quedó vivo

**Fecha:** 8 de octubre de 2026 · Después del despliegue de la fase 2 completa.

> Recorrido para marcar. Cada punto dice dónde está. Si algo no se comporta como dice acá, anótalo con lo que esperabas ver.
>
> Entra con el admin del cliente. Donde dice **vendedor**, hay que salir y entrar con una cuenta de vendedor.

---

## 1. Entrar

**Dónde:** la raíz del sitio, redirige a `/login`

- [ ] El sistema se ve **en claro**, no en oscuro, sin importar cómo tengas el sistema operativo
- [ ] Entra el ADMIN → cae en `/panel`
- [ ] Sale y entra un VENDEDOR → cae en `/vender`, **no** en el panel
- [ ] Contraseña incorrecta: mensaje genérico, sin decir si el correo existe

> Acá vas a ver el botón "Ingresar" **negro** en vez del rojo de la marca. Es conocido, es el hallazgo 2 de F2.4, y no está arreglado todavía.

---

## 2. Panel del administrador

**Dónde:** `/panel` — "Panel" es la pantalla de entrada del ADMIN

- [ ] Cuatro indicadores arriba: ventas de hoy, ingresos de hoy, utilidad de hoy, pantallas disponibles
- [ ] Aviso naranja de **"Hay precios con costo en cero"**, con el número de celdas afectadas
- [ ] Gráfico de ingresos de los últimos 7 días, barras índigo, con tooltip al pasar el mouse
- [ ] Tres accesos directos: Vender, Cuentas, Precios
- [ ] Tabla de las últimas ventas

---

## 3. Tema claro y oscuro · **F2.1**

**Dónde:** menú de usuario, arriba a la derecha (tu correo con la flechita)

- [ ] El menú tiene un selector **Claro / Oscuro**
- [ ] Cambia a Oscuro: toda la interfaz cambia
- [ ] Recarga la página: **se queda en oscuro**, no vuelve a claro
- [ ] Al cargar no hay un destello del otro tema
- [ ] Vuelve a Claro

> En oscuro, el ítem activo de la barra lateral se ve como un bloque casi blanco. Conocido, hallazgo 5 de F2.4.

---

## 4. Vender · **F2.1 (celular) y F2.2 (promoción)**

**Dónde:** `/vender` — primer ítem de la barra lateral

- [ ] Abre directamente en modo **Unidad**, con los selectores ya visibles
- [ ] Hay **tres** pestañas: Unidad · Paquete · **Promoción**
- [ ] Campo **"Celular del cliente (opcional)"** debajo de los selectores
- [ ] Se puede vender **sin** llenar el celular — el botón VENDER nunca se bloquea por él
- [ ] Vende una unidad: sale la tarjeta con el mensaje de WhatsApp
- [ ] El mensaje trae código de compra, fecha en letras, correo, contraseña y (si aplica) perfil y PIN
- [ ] Botón **"Copiar mensaje"** con confirmación visible al copiar
- [ ] Botón **"Nueva venta"** debajo
- [ ] Vende otra con celular lleno, y revisa que el número salga en el mensaje si la plantilla usa `{{celular}}`

> La pestaña Promoción se deja abrir aunque no haya promociones configuradas. Conocido, hallazgo 4 de F2.4.

---

## 5. Promociones · **F2.2**

**Dónde:** `/panel/catalogo/paquetes` — barra lateral, CONFIGURACIÓN → Paquetes

- [ ] En el panel de crear/editar un paquete hay un interruptor **"Es promoción"**
- [ ] Al activarlo, la fila muestra una pastilla **"Promoción"** (fondo índigo claro, no rojo)
- [ ] Hay un filtro arriba: Todos / Paquetes / Promociones
- [ ] Marca un paquete como promoción y ve a `/vender` → aparece en la pestaña **Promoción**, y ya **no** en la pestaña Paquete
- [ ] Véndelo: entrega las mismas pantallas y usa el mismo formato de mensaje que un paquete
- [ ] En `/ventas`, esa venta aparece marcada como promoción

**El tipo de cliente "Promoción" quedó obsoleto:**

**Dónde:** `/panel/catalogo/tipos-cliente`

- [ ] "Promoción" aparece como **Inactivo**
- [ ] En `/panel/precios`, la columna "Promoción" **ya no está** en la matriz
- [ ] En `/vender`, el selector de tipo de cliente **no** ofrece "Promoción"

---

## 6. Códigos para sorteos · **F2.1**

**Dónde:** `/ventas` — segundo ítem de la barra lateral (solo ADMIN)

- [ ] Fila de filtros: fechas, vendedor, tipo de venta, plataforma, paquete, **promoción**, código de compra y **celular del cliente**
- [ ] Botón **"Copiar códigos"** al lado de Buscar y Limpiar
- [ ] Filtra un rango de fechas, dale Copiar códigos → confirmación con el número ("42 códigos copiados")
- [ ] Pega en un bloc de notas: **un código por línea**, sin comas ni encabezados
- [ ] Anula una venta de ese rango, vuelve a copiar → **esa venta ya no aparece**
- [ ] Si el filtro no devuelve nada, el botón queda deshabilitado

---

## 7. Listado de ventas

**Dónde:** `/ventas`

- [ ] Tres tarjetas arriba: Hoy, Esta semana, Este mes — con ventas, ingresos, costos y utilidad
- [ ] Tabla con código, vendedor, ítem, precio, costo, utilidad, **celular** y estado
- [ ] Buscar por **fragmento** del código de compra funciona, sin importar mayúsculas
- [ ] Buscar por celular funciona igual
- [ ] Anular una venta: pide confirmación y la marca como anulada, nunca la borra
- [ ] Anular libera la pantalla: lo compruebas vendiendo lo mismo otra vez

> La utilidad sale en verde aunque el costo sea cero, así que esa cifra no es real todavía. Conocido, hallazgo 7 de F2.4.

---

## 8. Saldo de revendedores · **F2.3** — lo más nuevo

### Lado del administrador

**Dónde:** `/panel/usuarios` — barra lateral, ADMINISTRACIÓN → Usuarios

- [ ] Columna **"Vende contra saldo"** con un interruptor por usuario
- [ ] Actívalo sobre un vendedor → aparece su saldo en la fila (en $0)
- [ ] Botón **"Cargar saldo"** en la fila: pide monto y nota, y **confirma antes** nombrando el monto
- [ ] Carga $50.000 → el saldo de la fila se actualiza
- [ ] Botón **"Historial"** en la fila → lleva al detalle del usuario, `/panel/usuarios/<id>`
- [ ] En el historial: fecha, tipo (CARGA), monto, saldo resultante y quién lo hizo
- [ ] Un usuario sin "vende contra saldo" muestra "—", sin saldo ni botones

> Al activar el interruptor sobre alguien con saldo en cero, esa persona **no puede vender hasta que le cargues saldo** y nada te lo advierte. Conocido, es el punto 1 de F2.4. Por ahora: carga el saldo inmediatamente después de activarlo.

### Lado del revendedor — **entra con esa cuenta**

**Dónde:** barra superior y `/perfil`

- [ ] Su saldo se ve en la **barra superior**, siempre
- [ ] Su saldo también se ve en `/vender`, antes de confirmar
- [ ] Hace una venta → **el saldo de la barra baja solo, sin recargar la página**
- [ ] En `/perfil`, sección de saldo: su historial de movimientos, con la CARGA y el CONSUMO
- [ ] **No** puede ver el saldo ni los movimientos de nadie más

### El caso que importa: saldo insuficiente

- [ ] Con saldo menor al precio, intenta vender
- [ ] **Sale un aviso rojo que dice cuánto cuesta, cuánto tiene y cuánto le falta** — no falla en silencio
- [ ] La venta **no** se registra y el saldo no se mueve

> Esto es lo que arreglamos hoy y lo único que ninguno de los dos ha visto funcionar en producción. Es el punto más importante de todo el checklist.

### Devolución al anular

- [ ] Como ADMIN, anula una venta que consumió saldo
- [ ] El saldo del revendedor **vuelve a subir**
- [ ] En su historial aparece un movimiento **DEVOLUCION** nuevo — el CONSUMO original sigue ahí, sin tocar

### El empleado no cambia

- [ ] Un vendedor con el interruptor apagado vende igual que siempre
- [ ] **No ve nada de saldo en ninguna parte** — ni en cero, ni deshabilitado

---

## 9. Perfil propio · del bloque de perfil

**Dónde:** `/perfil` — menú de usuario → "Mi perfil"

- [ ] Cambia tu nombre y tu correo
- [ ] Cambia tu contraseña exigiendo la actual
- [ ] Con la contraseña actual equivocada, no deja y no cambia nada
- [ ] Al cambiarla, **las demás sesiones se cierran** pero la tuya sigue viva

> **Haz esto hoy con la cuenta del cliente.** Su contraseña la pusiste tú y viajó por mensajería.

---

## 10. Plantillas de mensaje

**Dónde:** `/panel/mensajes` — barra lateral, CONFIGURACIÓN → Plantillas

- [ ] Están las dos plantillas: UNIDAD y PAQUETE
- [ ] Se pueden editar y guardar
- [ ] Se ve la lista de marcadores disponibles, incluido `{{celular}}`
- [ ] Hay vista previa con datos de ejemplo
- [ ] **Edita una plantilla y mira una venta vieja en `/ventas`: su mensaje NO cambió** (es historia, no se reescribe)

---

## 11. Diagnóstico de empresa · solo SUPER_ADMIN

**Dónde:** `/panel/empresas` → entrar a una empresa, `/panel/empresas/<id>`

- [ ] Dice si la empresa **puede vender** y qué le falta si no
- [ ] Cuenta plataformas, precios activos, precios con costo en cero, pantallas y plantillas

---

## 12. Lo demás del catálogo, que ya venía

- [ ] `/panel/catalogo/plataformas` — alta, edición, activar/desactivar
- [ ] `/panel/catalogo/duraciones` — igual
- [ ] `/panel/catalogo/tipos-cliente` — igual
- [ ] `/panel/precios` — matriz con duraciones en filas y tipos de cliente en columnas; las celdas modificadas se marcan hasta guardar
- [ ] `/panel/cuentas` — cuentas con sus pantallas; **"Ver credenciales"** oculta correo y contraseña hasta que se hace clic
- [ ] `/panel/usuarios` — crear usuarios, cambiar rol, activar/desactivar

---

## 13. Permisos — el vendedor no debe poder

**Entra con la cuenta de vendedor y escribe las URLs a mano.** Ocultar un botón no es control de acceso; esto comprueba que el servidor también dice que no.

- [ ] `/panel` → no entra
- [ ] `/ventas` → no entra (su listado es el de `/vender`, solo sus ventas)
- [ ] `/panel/usuarios` → no entra
- [ ] `/panel/precios` → no entra
- [ ] `/panel/cuentas` → no entra
- [ ] En ninguna pantalla suya ve **costo, utilidad ni margen**

---

## Lo que ya sabemos que está mal

No hace falta reportarlos, están en `PROMPTS-FASE-2.md` como bloque F2.4:

1. El botón del login sale negro, no rojo
2. En oscuro, el ítem activo del menú es un bloque casi blanco
3. La tabla de usuarios se desborda y la fila pierde el nombre al cargar saldo
4. La pestaña Promoción se abre sin haber promociones
5. La utilidad se muestra en verde aunque el costo sea cero
6. Falta el aviso al activar "vende contra saldo" con saldo en cero

## Lo que falta y no es código

- [ ] **La tabla de costos del cliente** — mientras siga en cero, la utilidad que ve es igual al ingreso
- [ ] Precios para el tipo de cliente Revendedor
- [ ] Capacidades reales de pantallas por cuenta
- [ ] Rotar la contraseña del admin (punto 9)
- [ ] Probar una restauración de respaldo de verdad, no solo configurarla
