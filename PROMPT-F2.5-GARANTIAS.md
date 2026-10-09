# Prompt F2.5 — Garantías

> **Estado:** listo para ejecutar.
> **Peso:** ~12 h (bajó de ~28 h al recortar el alcance con el cliente).
> **Verificable al terminar:** entra un vendedor, busca la pantalla que un comprador reclama, le da Reemplazar, y el comprador recibe un mensaje nuevo con otra cuenta por los días que le quedaban.

---

## Lo que el cliente definió

| Pregunta | Respuesta |
|---|---|
| ¿Reubicación masiva cuando se cae una cuenta entera? | **No.** Una a la vez, cuando el comprador llama. |
| ¿Hasta cuándo hay garantía? | Hasta que se acabe la duración comprada. |
| ¿Quién puede darla? | Vendedor y ADMIN. |
| ¿A quién le cuesta? | A la empresa. **No** al vendedor, **no** al comprador. Se refleja como pérdida. |
| ¿Qué mensaje recibe el comprador? | El mismo formato, diciendo que es un reemplazo. |
| ¿Motivo? | Opcional. |

---

## Dos cosas que hay que decidir con los ojos abiertos

### La vista nueva amplía lo que ve un vendedor

El cliente pidió que **todos los vendedores vean todas las pantallas vendidas**, no solo las suyas. Hoy un VENDEDOR solo ve sus propias ventas (`/ventas/mias`).

Es lo que pidió y tiene sentido —quien atiende la llamada no siempre es quien vendió— pero conviene saber qué implica: **cada vendedor va a poder ver el correo y la contraseña de todas las cuentas entregadas.** Para revisar si la cuenta sirve, los necesita. Pero es una ampliación real de acceso y no debe pasar sin que se note.

Lo que **no** se amplía: cifras financieras (R4 sigue intacto) y el celular del comprador, que sigue siendo visible solo para el autor de la venta.

### El vencimiento del reemplazo

El cliente no lo dijo. Se asume **heredar los días que quedaban**: compró 30, se le cayó al día 8, el reemplazo vence en la fecha original. Es lo coherente con que la pérdida la asuma la empresa y no se le regalen días al comprador. Si resulta que lo quiere distinto, es un cambio de una línea.

---

## El prompt

```
Lee CLAUDE.md, DISENO.md, PRD-MVP-Ventas.md y GUIA-DE-PRUEBA.md antes de
empezar. Las credenciales de desarrollo están en GUIA-DE-PRUEBA.md: úsalas,
no las pidas.

Antes de escribir código, lee lib/ventas.ts completa —en particular cómo se
asignan las pantallas con FOR UPDATE SKIP LOCKED y cómo se arma el mensaje— y
el modelo VentaDetalle. Una garantía entrega una pantalla igual que una venta,
así que reutiliza ese camino en vez de escribir uno nuevo.

## Qué es una garantía

El comprador llama: la cuenta no sirve. El vendedor revisa y, si es cierto, le
entrega otra pantalla de la misma plataforma por los días que le quedaban. La
pérdida la asume la empresa.

Una garantía es **por pantalla, no por venta**. Una venta de paquete entregó
tres pantallas; se puede caer solo la de Netflix.

## 1. Esquema

Un modelo nuevo, con empresaId como todos (R1):

    Garantia
      id, empresaId
      ventaDetalleOriginalId    -- la pantalla que falló
      ventaDetalleReemplazoId   -- la pantalla nueva que se entregó
      motivo?                   -- texto libre opcional
      costoAsumido  Decimal(14,2)  -- copia inmutable (ver abajo)
      mensajeGenerado  Text        -- copia inmutable (R3)
      creadoPorId, createdAt

**El reemplazo es un `VentaDetalle` nuevo sobre la MISMA venta**, no una
modificación del original. R3: el renglón original no se toca nunca — ni su
pantallaId, ni sus credenciales, ni su fechaVencimiento. La garantía es un
hecho nuevo que apunta a los dos.

`ventaDetalleOriginalId` lleva **restricción única**: una pantalla entregada no
se puede reemplazar dos veces. Si el reemplazo también falla, la garantía
siguiente es sobre el renglón de reemplazo, que es otro id. Manéjala con
`restriccionViolada()` además de validar antes (CLAUDE.md).

## 2. La pantalla dañada sale del inventario

Al reemplazar, la `Pantalla` que falló se marca `activa = false`.

Si no se hace, el sistema la vuelve a vender mañana y el problema se repite con
otro comprador — con la contraseña que ya no sirve. Verifica que
`pantallasDisponibles` excluya las inactivas; si no lo hace, eso es un bug
aparte y hay que decirlo.

No se desactiva la cuenta entera: el cliente dijo expresamente que no quiere
reubicación masiva.

## 3. Entregar el reemplazo

Dentro de una transacción, con el mismo mecanismo de la venta:

- Toma una pantalla libre de la **misma plataforma** con FOR UPDATE SKIP
  LOCKED. No escribas una variante nueva: usa `tomarPantallasDisponibles`.
- El `VentaDetalle` nuevo **hereda la fechaVencimiento del original**. No se
  recalcula desde hoy: el comprador recibe los días que le faltaban, no 30
  nuevos.
- Copia correo, contraseña, perfil y PIN de la cuenta nueva, como hace la
  venta (R3).
- Desactiva la pantalla dañada (punto 2).
- Si no hay ninguna pantalla libre de esa plataforma, **falla con un 409 claro**
  que lo diga con esas palabras. No encoles nada, no ofrezcas otra plataforma:
  el vendedor resuelve por fuera y vuelve cuando haya inventario.

**El saldo no se toca.** Ni se cobra al revendedor, ni se le devuelve nada. La
garantía no pasa por el camino del saldo en absoluto.

## 4. El costo, como pérdida

`costoAsumido` guarda el costo de esa plataforma en esa duración, al momento de
la garantía. Copia inmutable, igual que todo lo demás.

**No se modifica la utilidad de la venta original.** Es historia y no se edita
(R3). La pérdida se reporta aparte: la venta ganó lo que ganó, y la empresa
gastó además esto.

Hoy todos los costos están en cero, así que va a mostrar $0. La estructura
tiene que quedar bien igual, para cuando el cliente cargue sus costos.

## 5. El mensaje

Mismo formato de siempre, con una línea arriba que diga que es un reemplazo.

- Usa la plantilla que corresponda al tipo de la venta original (UNIDAD o
  PAQUETE), pero **solo con el bloque de la plataforma reemplazada** — el
  comprador no necesita que le reenvíen las otras dos cuentas que sí le
  funcionan.
- Se guarda en `Garantia.mensajeGenerado` (R3).
- Botón "Copiar mensaje" con confirmación visible, igual que al vender.

## 6. La vista nueva

Una entrada nueva en la barra lateral, visible para **VENDEDOR y ADMIN**:
"Pantallas vendidas", arriba de "Ventas".

Lista de **VentaDetalle**, no de Venta: una fila por pantalla entregada.

Columnas: plataforma, correo de la cuenta, perfil, comprador (código de
compra), vendedor, fecha de entrega, vencimiento, y estado (Vigente · Vencida ·
Reemplazada · De la venta anulada).

Filtros: plataforma, vendedor, código de compra, correo de la cuenta, y solo
vigentes. El vendedor que atiende la llamada normalmente tiene a la mano el
código de compra o el correo, así que esos dos tienen que buscar por fragmento.

Acción por fila: **"Reemplazar"**, con diálogo de confirmación que nombre la
plataforma y el comprador, y un campo de motivo opcional. Botón de contorno con
icono, no sólido (DISENO.md §2: la acción sólida de la pantalla es una sola).

No aparece el botón en filas ya reemplazadas, vencidas, o de ventas anuladas.

Las garantías hechas se ven en el detalle de la fila: cuándo, quién, motivo, y
a qué cuenta se movió.

### Lo que un VENDEDOR ve y lo que no

- **Sí** ve las pantallas vendidas por todos, con sus credenciales. Es lo que
  el cliente pidió: quien contesta la llamada no siempre es quien vendió, y
  para revisar si la cuenta sirve necesita entrar.
- **No** ve costo, utilidad, margen ni `costoAsumido` (R4). La exclusión se
  hace en el `select` de Prisma, no filtrando después.
- **No** ve el `celularCliente` de ventas que no son suyas. Esa regla ya
  existe y no cambia.

## 7. Verificación

- Las pruebas existentes pasan sin modificarse. `tsc --noEmit` limpio en ambas
  apps — cero errores, incluidos los de archivos de prueba.
- `app-compuesta.test.ts`: la ruta nueva, con el caso sin sesión y con los dos
  roles. Un VENDEDOR alcanza la vista; nadie sin sesión la alcanza.
- **R4 sobre el JSON crudo**: la respuesta para un VENDEDOR no contiene las
  cadenas "costo", "utilidad" ni "margen" en ninguna parte, ni el celular de
  una venta ajena.
- **R3**: tras una garantía, el VentaDetalle original conserva intactos su
  pantallaId, sus credenciales y su fechaVencimiento.
- **El reemplazo hereda el vencimiento**: vender a 30 días, reemplazar al día
  8, verificar que el renglón nuevo vence en la fecha original y no 30 días
  después.
- **La pantalla dañada no se vuelve a vender**: tras la garantía, no aparece
  en disponibilidad ni se puede asignar en una venta nueva.
- **Doble garantía bloqueada**: dos intentos de reemplazar el mismo renglón
  dan error de negocio, no 500, y solo se entrega una pantalla.
- **Sin inventario**: 409 con el mensaje claro, sin dejar nada a medias.
- **El saldo no se mueve**: garantía sobre una venta de un revendedor, su
  saldo queda idéntico y no aparece ningún MovimientoSaldo nuevo.
- Prueba de que el error llega a la pantalla, no solo de que el servidor lo
  devuelve (la regla que dejó el hallazgo 8 de la revisión en vivo).
- Recorre la vista nueva en claro y en oscuro.

## 8. Entregable

Reporta:
- Si `pantallasDisponibles` ya excluía las pantallas inactivas o hubo que
  arreglarlo.
- Cómo quedó el mensaje de reemplazo, con un ejemplo del texto real.
- Cualquier lugar donde hayas tenido que tocar el camino de la venta normal.
  Idealmente son cero: la garantía reutiliza, no modifica.
```
