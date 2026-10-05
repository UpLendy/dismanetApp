# Lista de cierre antes de producción

**Proyecto:** Sistema Interno de Gestión — MVP del módulo de ventas
**Estado:** código completo, 271 pruebas en verde, 9 de 9 entregas
**Fecha:** 2 de octubre de 2026

> El MVP está terminado como código. No está listo para que DISMANET lo use. Esta lista es lo que falta entre una cosa y la otra, en orden de importancia.

---

## 1. Bloqueantes técnicos

### 1.1 — Cookie `SameSite=None` sin protección CSRF

**Riesgo: alto. Es lo primero que hay que resolver.**

La entrega 9 cambió la cookie de sesión a `SameSite=None; Secure` porque Vercel y Railway quedan en dominios distintos. Es correcto para que funcione, pero `SameSite=None` significa que **el navegador envía la cookie de sesión en peticiones originadas desde cualquier sitio web**.

Con autenticación por cookie y endpoints que cambian estado —vender, anular, crear usuarios— eso es una exposición a CSRF real: una página cualquiera que un empleado de DISMANET abra mientras tiene sesión puede disparar ventas o anulaciones en su nombre.

Dos salidas, en orden de preferencia:

1. **Mismo dominio registrable para ambos.** `app.dismanet.co` y `api.dismanet.co`. Permite volver a `SameSite=Lax` y el problema desaparece de raíz. Requiere un dominio propio y configurarlo en Vercel y Railway.
2. **Validar el encabezado `Origin`** en toda petición que cambie estado, contra una lista blanca de orígenes permitidos. Rechazar con 403 cualquier otro. Es barato, efectivo y no depende del dominio.

Si se toma la opción 2, debe ir con prueba: una petición POST con `Origin` ajeno recibe 403.

### 1.2 — Las cuatro verificaciones del punto 0 nunca se reportaron

Se pidieron en el prompt 9 y no aparecen en el reporte de la entrega 9, igual que no aparecieron en el de la 8. Pueden estar hechas; hay que confirmarlo una por una:

| # | Qué | Por qué importa |
|---|---|---|
| 0a | El `tx` de la transacción viene extendido con `empresaId`, y `cuentas.ts` salió de la lista blanca | Si quedó en `prismaRaw.$transaction`, R1 está apagada en todo el camino de la venta |
| 0b | La consulta de bloqueo nunca toma una pantalla de otra empresa; la lista blanca vigila `$queryRaw` | El SQL crudo es el único punto donde R1 no protege sola |
| 0c | **El reintento del código de compra probado forzando la colisión** | Con 6 dígitos y 30 ventas, esa rama casi con certeza nunca se ejecutó. Depende de detectar el P2002 con `restriccionViolada()` |
| 0d | Al día 29, la pantalla de Netflix de un combo de 30 días está libre y la de Disney+ no | Es lo que convierte R5 en inventario revendible |

La 0c es la más urgente: es una rama de código no ejercida en el camino crítico de la venta.

### 1.3 — Ninguna pantalla se ha probado en un navegador real

Todo se verificó por API, replicando con `curl` las llamadas que hace cada página. Eso valida el contrato, no la interacción: formularios, confirmaciones, selects y la matriz de excepciones de paquetes nunca recibieron un clic.

**Esto ya cobró su primera víctima.** La primera revisión visual encontró en minutos que el SUPER_ADMIN no tiene forma de seleccionar una empresa, y que todas sus pantallas la exigen: queda en un callejón sin salida que ninguna prueba automatizada detectó, porque todas las pruebas de API envían la cookie de empresa ya puesta. Corregido en el prompt 11.

La lección aplica hacia adelante: las pruebas por API no ven los caminos que el usuario no puede recorrer. Antes de que lo vea el cliente, recorrer todas las pantallas a mano, con cada rol.

### 1.4 — Formularios habilitados que no pueden funcionar

Patrón encontrado en la misma revisión: varias pantallas renderizan el formulario de alta completamente editable encima de un mensaje de error que dice que la operación no es posible. Se puede llenar y enviar, para que falle.

Regla, ya incorporada al prompt 11: **si una pantalla no puede funcionar, no se renderiza su formulario.** En su lugar va un estado vacío que nombre lo que falta y ofrezca la acción que lo resuelve.

Revisar que no quede ninguna otra pantalla con ese patrón.

---

## 2. Bloqueantes de datos — dependen del cliente

Ninguno impide desplegar. Todos impiden que el sistema sirva.

| Dato | Estado | Consecuencia de no tenerlo |
|---|---|---|
| **Tabla de costos por plataforma y duración** | Todos en 0 | La utilidad se registra igual al precio completo. El panel muestra ganancias infladas. Es literalmente la dificultad principal que el cliente describió en su documento. |
| **Precios para Revendedor y Promoción** | Solo existe "Cliente normal" | Dos tercios de la matriz vacía. El vendedor no puede vender a revendedores. |
| **Capacidad real de pantallas por cuenta** | Valores provisionales (Netflix 5, Disney+ 4, Max 3, Prime 3, Paramount+ 6) | El inventario que ve el sistema no es el real. Se puede vender lo que no existe, o quedarse sin vender lo que sí. |
| **Duración individual de Prime Video y Max** | "Por confirmar" en el catálogo | Esas dos no se pueden vender sueltas, solo en combo. |
| **P1: ¿las cuentas tienen vencimiento propio?** | Sin respuesta | Si lo tienen, hoy se puede vender 3 meses en una pantalla a la que le quedan 10 días. La lógica está aislada en una función para que el arreglo toque un solo lugar. |
| **P3: ¿hay promociones temporales con fechas?** | Sin respuesta | Si las hay, la matriz de precios necesita vigencia. |
| **Nombres y correos de los empleados** | Diferido | Se cargan el día del despliegue, cinco minutos. |

---

## 3. Despliegue real

`DEPLOYMENT.md` documenta el procedimiento completo y se verificó en Docker local, pero **no se ha creado ningún servicio real**. Falta:

- [ ] Crear el proyecto en Railway con Postgres, y el proyecto en Vercel
- [ ] Generar `JWT_SECRET` y `CLAVE_CIFRADO` de producción, distintas de las de desarrollo
- [ ] **Guardar `CLAVE_CIFRADO` en un gestor de contraseñas, fuera del repositorio.** Si se pierde, las contraseñas de las cuentas y los pines son irrecuperables
- [ ] Resolver el orden de dominios (la dependencia circular está documentada)
- [ ] Correr `prisma migrate deploy` y el seed con credenciales reales
- [ ] Verificar respaldos automáticos y **probar una restauración**, no solo confiar en que existen
- [ ] Cambiar las contraseñas sembradas antes de entregar accesos

---

## 4. Antes de mostrárselo al cliente

El sistema hace hoy: vender rápido en modo unidad y paquete, asignar cuenta y pantalla automáticamente, generar el mensaje de WhatsApp con código de compra, controlar inventario por pantallas, y mostrar ventas y totales al administrador.

El sistema **no** hace: garantías, pines de recarga, pagos de cuentas, dashboard de rentabilidad con gráficos, bitácora de auditoría, alertas, días perdidos ni reportes exportables. Todo eso estaba fuera del MVP por acuerdo y entra en la evolución mensual.

Conviene decirlo antes de la demostración, no después de que él pregunte por las garantías.

---

## 5. Orden recomendado

1. Resolver 1.1 (CSRF) y 1.2 (las cuatro verificaciones)
2. Recorrer las pantallas en navegador
3. Pedirle al cliente costos, precios por tipo de cliente y capacidades reales
4. Desplegar con datos reales
5. Capacitación y arranque
