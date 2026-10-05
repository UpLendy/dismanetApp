# Guía de prueba — MVP Módulo de Ventas

Para recorrer el sistema completo y encontrar lo que esté mal antes de mostrárselo al cliente.

---

## 1. Levantar

Todo ya está configurado: `apps/api/.env` y `apps/web/.env.local` existen con sus claves, y las dependencias están instaladas.

**Terminal 1 — base de datos y arranque del API**

```bash
cd ~/Documents/work/dismanet/dismanet-app

docker compose up -d                 # Postgres 16 en localhost:5435

cd apps/api
npx prisma generate                  # con Node, no con Bun
npx prisma migrate deploy
cd ../..
bun run seed                         # carga el catálogo real de DISMANET

bun run dev:api                      # http://localhost:3001
```

Comprobar antes de seguir: `curl http://localhost:3001/salud` debe responder `{"ok":true}`.

**Terminal 2 — web**

```bash
cd ~/Documents/work/dismanet/dismanet-app
bun run dev:web                      # http://localhost:3000
```

### Si algo falla

| Síntoma | Causa probable |
|---|---|
| El API no conecta a la base | Docker no levantó. `docker compose ps` debe mostrar el contenedor arriba. |
| `migrate deploy` dice que hay migraciones pendientes y falla | Base en estado raro. `docker compose down -v` borra el volumen y se empieza de cero. |
| El login da error de red desde el navegador | El API no está corriendo, o CORS. Mirar la consola del navegador. |
| Dice que faltan credenciales del seed | Alguna variable `SEED_*` quedó vacía en `apps/api/.env`. |

---

## 2. Usuarios

| Rol | Correo | Contraseña |
|---|---|---|
| SUPER_ADMIN | `admin@plataforma.local` | la de `SEED_SUPERADMIN_PASSWORD` en `apps/api/.env` |
| ADMIN | `admin@dismanet.local` | `DismanetAdmin#2026` |
| VENDEDOR | `vendedor@dismanet.local` | `DismanetVendedor#2026` |

---

## 3. Recorrido

Marcar lo que funcione. Lo que no, anotarlo con lo que esperabas ver.

### Acceso
- [ ] Entrar como ADMIN. Lleva al panel.
- [ ] Cerrar sesión. Vuelve a login.
- [ ] Entrar como VENDEDOR. **Debe llevar a /vender, no al panel.**
- [ ] Como VENDEDOR, escribir `/panel` en la barra de direcciones. Debe rebotar a /vender.
- [ ] Contraseña incorrecta: mensaje genérico, sin decir si el correo existe.

### Catálogo (como ADMIN)
- [ ] Plataformas: están las 16 del catálogo real.
- [ ] Crear una plataforma con un nombre que ya existe. Debe dar error claro, no pantalla rota.
- [ ] Duraciones: están las 7. Al crear una en MESES, la vista previa muestra el cálculo de vencimiento.
- [ ] Desactivar una duración. Debe avisar cuántos precios quedan inservibles antes de confirmar.

### Paquetes
- [ ] Están los 6 combos.
- [ ] Abrir **"Básico 1"** y mirar la matriz de excepciones. En la fila de **30 días**, Netflix debe decir **28 días** y Disney+ Premium "igual a la vendida". **Es la verificación más importante de esta pantalla.**
- [ ] Cambiar una celda a "igual a la vendida" y volver a ponerla. Debe guardar bien en ambos sentidos.
- [ ] Intentar dejar un paquete activo sin plataformas. Debe rechazarlo.

### Precios
- [ ] Pestaña Unidades: seleccionar Netflix. Deben aparecer 7.900 / 10.900 / 11.400 en 14, 28 y 30 días.
- [ ] **Debe haber un aviso visible de que hay precios con costo en cero.** Hoy están todos así.
- [ ] Pestaña Paquetes: seleccionar "Básico 1" a 30 días. Al lado del costo debe mostrar la suma de componentes.
- [ ] Escribir un costo muy distinto a esa suma. Debe marcarse en advertencia **sin bloquear el guardado**.
- [ ] Vaciar una celda y recargar: esa combinación ya no debe ser vendible.

### Cuentas
- [ ] Crear una cuenta de Netflix. Debe generar 5 pantallas con perfiles A–E y PIN de 4 dígitos.
- [ ] Editar un perfil y un PIN antes de guardar.
- [ ] En el detalle, "Ver credenciales" revela correo y contraseña. **Sin ese clic no deben verse.**
- [ ] Bajar la capacidad con una pantalla ocupada: debe rechazar diciendo cuál y hasta cuándo.
- [ ] Subir la capacidad: genera las faltantes sin renumerar las existentes.

### Vender (como VENDEDOR) — lo que de verdad importa
- [ ] **Venta unitaria:** cliente normal → 30 días → Netflix → VENDER.
- [ ] Sale el mensaje con código de compra, fecha en letras, perfil, PIN, correo y contraseña.
- [ ] El botón de copiar funciona. Pegarlo en WhatsApp y ver que se lee bien.
- [ ] **Venta de paquete:** cliente normal → 30 días → "Básico 1" → VENDER.
- [ ] El mensaje lista **dos cuentas**, cada una con su duración: Netflix 28 días, Disney+ 30 días.
- [ ] En ninguna pantalla del vendedor aparecen costos, utilidades ni márgenes.
- [ ] Agotar el inventario de una plataforma vendiendo varias veces. Al acabarse, no debe ser seleccionable.

### Listado (como ADMIN)
- [ ] Aparecen las ventas que acabas de hacer, con costo y utilidad.
- [ ] Buscar por el código de compra de una venta. La encuentra.
- [ ] Totales de hoy: número de ventas, ingresos, costos y utilidad. **La utilidad va a verse inflada porque los costos están en cero — es lo esperado hoy.**
- [ ] Anular una venta. La pantalla debe quedar libre y poder venderse otra vez enseguida.

### Aislamiento entre empresas
- [ ] Como SUPER_ADMIN, crear una segunda empresa con su propio admin.
- [ ] Entrar con ese admin nuevo. **No debe ver nada de DISMANET**: ni plataformas, ni cuentas, ni ventas.
- [ ] Volver como admin de DISMANET y confirmar que tampoco ve nada de la otra.

---

## 4. Qué anotar

Para cada cosa que falle, anotar: en qué pantalla, qué hiciste, qué esperabas y qué pasó. Con eso convierto cada una en una corrección concreta.

Vale la pena separar dos tipos:

- **Está roto** — da error, no guarda, muestra datos equivocados.
- **Está feo o confuso** — funciona pero no se entiende, sobran clics, el texto no es claro.

Los primeros se arreglan ya. Los segundos conviene juntarlos y decidir cuáles valen la pena antes de que el cliente lo vea.
