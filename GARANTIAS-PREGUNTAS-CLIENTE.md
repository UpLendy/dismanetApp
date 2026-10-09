# Garantías — lo que hay que preguntarle al cliente

**Para:** la conversación con DISMANET, no para el código.
**Por qué existe este documento:** el módulo de garantías lleva toda la fase 2 marcado como "bloqueado por la especificación del cliente", pero nunca se le mandaron las preguntas. Estas son.

> Se pueden mandar tal cual, por WhatsApp o correo. Están en su idioma, no en el nuestro.

---

## Lo que creemos entender

Vende una pantalla de Netflix por 30 días. Al día 8 el comprador escribe: no entra, le cambiaron la clave, lo sacaron. Hay que darle otra pantalla, de otra cuenta, por los días que le quedaban.

Eso es la garantía. Las preguntas de abajo son todo lo que no sabemos de ese momento.

---

## Las preguntas, por orden de importancia

### 1. Cuando una cuenta se cae, ¿se cae para todos a la vez?

Si a una cuenta de Netflix le cambian la contraseña, **las cinco pantallas de esa cuenta dejan de servir al mismo tiempo**, y son cinco clientes distintos.

- ¿Pasa así en la práctica, o lo normal es que falle una sola pantalla?
- Si se cae la cuenta entera, ¿quiere reemplazar las cinco de un clic, o las va atendiendo una por una según le vayan escribiendo?

**Por qué importa:** es la diferencia entre una pantalla de "reemplazar esta venta" y una de "esta cuenta murió, reubicar a todos sus compradores". Es el punto que más cambia el tamaño del trabajo.

### 2. ¿El reemplazo hereda los días que quedaban, o arranca de nuevo?

Compró 30 días, se le cayó al día 8.

- ¿La pantalla nueva le vence en la fecha original —le quedan 22 días— o le empiezan 30 días nuevos?

**Por qué importa:** cambia el inventario. Si arranca de nuevo, cada garantía le regala días y el sistema tiene que contarlos.

### 3. ¿Hasta cuándo hay garantía?

- ¿Toda la duración comprada, o solo los primeros días? Si es un límite, ¿cuántos?
- ¿Hay tope de reemplazos por compra, o los que hagan falta?
- ¿Es distinto para un revendedor que para un cliente normal?

### 4. ¿Qué hace cuando no hay con qué reemplazar?

Se le cayó la cuenta, el comprador reclama, y **no hay ninguna pantalla libre de esa plataforma**.

- ¿Queda anotado como pendiente y se resuelve cuando entre inventario?
- ¿Le ofrece otra plataforma?
- ¿Le devuelve el dinero?

**Por qué importa:** es lo que más va a pasar en la práctica y es lo que ningún sistema de garantías suele resolver. Si no lo definimos, el vendedor va a quedar trabado con el cliente al teléfono.

### 5. ¿Quién puede dar una garantía?

- ¿El vendedor que hizo la venta, cualquier vendedor, o solo usted?
- Si un revendedor pide garantía de algo que él vendió, ¿la registra él mismo?

### 6. ¿La garantía le cuesta algo a alguien?

- Al comprador no, asumimos. ¿Correcto?
- A un **revendedor con saldo**: ¿se le descuenta otra vez? Asumimos que **no**.
- Para sus números: la venta le costó una pantalla, y con la garantía le costó dos. ¿Quiere que la ganancia de esa venta refleje ese segundo costo, o prefiere ver las garantías aparte?

**Por qué importa:** la venta vieja no se puede modificar —es historia— así que el costo del reemplazo tiene que vivir en otro lado. Saber dónde lo quiere ver define cómo se guarda.

### 7. ¿Qué le llega al comprador?

- ¿Un mensaje de WhatsApp nuevo con los datos de la cuenta nueva?
- ¿El mismo formato de siempre, o uno distinto que diga que es un reemplazo?

### 8. ¿Por qué se cayó?

¿Quiere anotar el motivo de cada garantía? Por ejemplo: cambiaron la contraseña · sacaron el perfil · cuenta caída · PIN cambiado · no carga en su país · otro.

Con eso el sistema le podría decir **qué proveedor le está dando más problemas**, que es información para negociar o para dejar de comprarle a alguien.

### 9. ¿La pantalla dañada qué pasa?

Cuando reemplaza, la pantalla que falló:

- ¿Queda marcada como inservible y sale del inventario hasta que usted la arregle?
- ¿O la cuenta entera se desactiva?

Si no se marca, el sistema la va a volver a vender mañana y el problema se repite con otro comprador.

---

## Nota comercial — conviene decidirlo antes de construir

La estimación es **~28 horas**. Su acuerdo mensual incluye 10 horas, así que garantías ocupa cerca de tres meses de horas incluidas.

Tres caminos, y vale la pena elegir antes de empezar:

1. **Repartirlo en tres meses** dentro de la mensualidad, entregando por partes.
2. **Cotizarlo aparte** como un alcance adicional, y entregarlo completo en una sola vez.
3. **Hacer una versión mínima primero** —registrar la garantía y entregar la pantalla de reemplazo, sin reportes ni motivos ni reubicación masiva— que cabe en un mes y resuelve el 80% del dolor. El resto queda para cuando se sepa si hace falta.

La 3 es la que yo propondría, por la misma razón que funcionó en todo este proyecto: entregar lo mínimo que sirve y dejar que el uso real diga qué falta. Y la respuesta a la pregunta 1 puede cambiar bastante la estimación en cualquiera de los tres casos.

---

## Lo que no hace falta preguntarle

Ya está resuelto por cómo quedó construido el sistema, y conviene no abrirlo:

- **La venta original nunca se modifica.** Una garantía no edita la venta: agrega un hecho nuevo. Igual que la anulación y que los movimientos de saldo.
- **La pantalla de reemplazo se asigna con el mismo mecanismo que una venta normal**, así que dos garantías simultáneas no pueden entregar la misma pantalla.
- **El histórico de la garantía guarda copia** del correo y la contraseña entregados, como hace la venta.
