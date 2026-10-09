# Estado de producción

**Proyecto:** Sistema Interno de Gestión — DISMANET
**En producción desde:** 6 de octubre de 2026
**Último despliegue:** 8 de octubre de 2026 — toda la fase 2
**Infraestructura:** API y PostgreSQL en Railway · Web en Vercel

> Este documento era la lista de cierre previa al despliegue. Ahora el sistema está en producción, así que pasa a ser la lista de lo que sigue abierto con usuarios reales adentro. Lo resuelto queda registrado para no volver a discutirlo.

---

## Despliegue del 8 de octubre

Nueve commits, cinco migraciones, todo verde. Entró de un solo merge a `main`.

| Bloque | Qué quedó vivo |
|---|---|
| Perfil, plantillas y diagnóstico | Perfil propio con cambio de contraseña (cierra el punto 1.2), edición de plantillas en `/panel/mensajes` (cierra el 1.3), diagnóstico de empresa, validación de `Origin`. |
| F2.1 | Códigos de compra para sorteos, celular del cliente opcional, tema claro por defecto con selector. |
| F2.2 | Promociones como bandera de paquete. Desactivó el TipoCliente "Promoción" en la empresa del cliente. |
| F2.3 | Saldo de revendedores con bloqueo de fila y ledger de movimientos. |

**Lo que el despliegue hizo y hay que tener presente:**

- **Se cayeron todas las sesiones abiertas**, por `versionSesion`. Esperado, de una sola vez.
- **La columna de precios "Promoción" desapareció de la matriz.** Los precios no se borraron, quedaron inalcanzables. Si el cliente le vendía a alguien con ese precio, ahora se arma marcando un paquete como promoción.
- **Nadie cambió de comportamiento por el saldo.** Todos los usuarios entraron con `usaSaldo = false`. El cliente tiene que marcar a mano quiénes son revendedores y cargarles saldo; hasta entonces el módulo está invisible.

---

## Resuelto en el despliegue

| Tema | Cómo se resolvió |
|---|---|
| **Cookie entre dominios distintos** | Proxy nativo de Next.js en `next.config.ts`: el navegador habla solo con el dominio de Vercel y Vercel retransmite a Railway. Mejor que las alternativas que se habían planteado, porque elimina el problema en vez de mitigarlo. |
| Builds cancelados por URLs sin protocolo | Autocompletado de `https://` en `next.config.ts`, `lib/api.ts` y `lib/sesion.ts`. |
| Datos de prueba en producción | Seed modificado para no inyectar cuentas, pantallas ni plataformas de ejemplo en producción. Purgadas 128 pantallas, 64 cuentas, usuarios de prueba y precios asociados. |
| `/panel/empresas` accesible por ADMIN | Bloqueada por layout de Next.js, no solo oculta en el menú. Un ADMIN no puede listar ni entrar a empresas ajenas ni escribiendo la URL. |

---

## 1. Abierto — prioridad alta

### 1.1 — ¿La cookie volvió a `SameSite=Lax`?

**Verificar hoy.** El proxy hace que todo el tráfico del navegador sea del mismo origen, así que `SameSite=None` ya no es necesario. Si la variable `SAME_SITE_COOKIE_SESION` sigue en `None`, la exposición a CSRF que motivó el cambio **sigue abierta sin ninguna razón técnica que la justifique**: cualquier página que un empleado abra con sesión activa puede disparar ventas o anulaciones a su nombre.

Es un cambio de una variable de entorno. Comprobarlo con las herramientas del navegador: la cookie `dismanet_sesion` debe decir `SameSite=Lax`.

Como defensa en profundidad, validar el encabezado `Origin` en toda petición que cambie estado, contra una lista blanca. Barato y no depende de la configuración de la cookie.

### 1.2 — El único administrador no puede cambiar su propia contraseña

Figuraba como "nice to have". Con el sistema en producción dejó de serlo.

La contraseña de `admin@dismanet.com` fue fijada por el proveedor y viajó por canales de mensajería. El cliente **no tiene forma de cambiarla**: la gestión de usuarios la hace un ADMIN sobre otros usuarios, y él es el único ADMIN.

Dos consecuencias prácticas:
- El proveedor conserva indefinidamente acceso a un sistema que guarda las credenciales de streaming del cliente.
- Si la contraseña se filtra por donde se envió, no hay remedio desde la aplicación.

Resolver con una pantalla de perfil propio: cambiar contraseña exigiendo la actual, y cambiar correo. Mientras tanto, rotar esa contraseña por un canal seguro.

### 1.3 — ¿Corrió el prompt 12?

Confirmar que la empresa de producción tiene sus dos `PlantillaMensaje`. Sin ellas no se puede vender, y es el error que apareció justo antes del cambio de herramienta.

Confirmar también si quedó la pantalla de edición de plantillas, o si las plantillas solo existen porque las puso el seed.

### 1.4 — Cuatro verificaciones que nunca se reportaron

Vienen de la entrega 8 y se pidieron dos veces sin respuesta. Ahora corren en producción con datos reales:

| # | Qué | Riesgo si está mal |
|---|---|---|
| a | El `tx` de la transacción conserva el filtro por empresa | R1 apagada en todo el camino de la venta |
| b | La consulta cruda de bloqueo nunca toma una pantalla de otra empresa | Fuga entre clientes |
| c | **El reintento del código de compra, probado forzando la colisión** | Una venta real falla con error técnico mientras el cliente espera |
| d | Al día 29, la pantalla de Netflix de un combo de 30 días está libre | Inventario bloqueado de más, dinero sin vender |

La (c) sigue siendo la más probable: con seis dígitos aleatorios, ninguna prueba hecha hasta ahora ejecutó esa rama.

---

## 2. Abierto — depende del cliente

| Dato | Consecuencia de no tenerlo |
|---|---|
| **Tabla de costos** | La utilidad se registra igual al precio completo. El panel muestra ganancias infladas. Es la dificultad principal que el cliente describió en su documento original. |
| **Precios de Revendedor y Promoción** | El vendedor no puede venderle a revendedores. |
| **Capacidades reales de pantallas por cuenta** | El inventario del sistema no es el del negocio. Se puede vender lo que no existe. |
| **P1: ¿las cuentas tienen vencimiento propio?** | Hoy se puede vender 3 meses en una pantalla a la que le quedan 10 días. La lógica está aislada en una función para que el arreglo toque un solo lugar. |
| Duración individual de Prime Video y Max | No se venden sueltas, solo en combo. |

---

## 3. Operación

- [ ] `JWT_SECRET` y `CLAVE_CIFRADO` de producción distintas de las de desarrollo
- [ ] `CLAVE_CIFRADO` guardada en un gestor de contraseñas, fuera del repositorio. **Si se pierde, las contraseñas de las cuentas y los pines son irrecuperables**
- [ ] Respaldos automáticos activos **y una restauración probada de verdad**, no solo configurada
- [ ] Monitoreo del endpoint de salud
- [ ] Rotada la contraseña del administrador del cliente

---

## 4. Lo que el sistema no hace

Para la conversación con el cliente, no para el código. Todo esto quedó fuera del MVP por acuerdo y es el contenido de la evolución mensual:

garantías y reemplazos · buscador global de correos · pines de recarga · pagos de cuentas · dashboard de rentabilidad con gráficos · métricas comparativas por empleado · bitácora de auditoría · alertas automáticas · días perdidos · reportes exportables · proveedores · envío automático por WhatsApp · recuperación de contraseña por correo · app móvil nativa

---

## 5. Orden sugerido

1. Verificar `SameSite` (minutos)
2. Confirmar las plantillas de la empresa de producción (minutos)
3. Cerrar las cuatro verificaciones de la entrega 8, empezando por el reintento del código
4. Pantalla de perfil propio y rotación de la contraseña del cliente
5. Pedirle al cliente los costos y los precios por tipo de cliente
6. Probar una restauración de respaldo
