# F6.6 — Cálculo de comisiones

Depende de F6.2 (turnos) y F6.5 (configuración y simulador). Es la entrega
que convierte la política en una cifra por persona.

**Esta entrega calcula y muestra. No congela ni paga.** Ver la Parte 5.

## Parte 1 — La regla, completa

Todas estas decisiones ya las tomó el cliente; no las replantees:

- **Un solo pozo.** No hay bolsa separada para ventas y otra para soporte.
- **Se reparte proporcionalmente a las horas de turno**, sin importar el
  cargo. Quien estuvo de turno participa, aunque no haya vendido nada.
- **Solo horas de `Turno`.** Las `HoraAdicional` **no** entran en el
  denominador: si entraran, cualquiera agrandaría su tajada registrándose
  horas a sí mismo. Ya quedó escrito así en F6.3.
- **Solo empleados.** Un `VENDEDOR` es revendedor externo, no tiene turnos.
- **Nada de porcentaje de utilidad**: se descartó en F6.5 porque filtra la
  utilidad a quien no debe verla (R4).

## Parte 2 — El pozo se comparte con el simulador, no se reimplementa

`lib/comisiones.ts` ya calcula, en `simularComisiones`, qué pantallas
comisionan y cuánto aporta cada una, con el umbral, el ámbito, el período y
el orden determinista.

**Extrae de ahí la parte que decide "esta pantalla comisiona y aporta $X" y
úsala en las dos**, en vez de escribir el cálculo por segunda vez. Una
segunda implementación de la regla del dinero es exactamente cómo se
desincroniza — es la misma lección de R5 y de F4.12, y en este proyecto ya
pasó tres veces.

Lo que cambia respecto al simulador es que aquí los parámetros salen de la
`ConfiguracionComision` **vigente**, no del query.

Si no hay configuración guardada, las rutas responden con un resultado vacío
y una marca de "sin configurar", no un error.

## Parte 3 — El reparto

Para cada pantalla que comisiona se conoce su aporte y su **día Bogotá**
(el de `Venta.fechaVenta`). Agrupa los aportes por día: ese es el pozo de
ese día.

El pozo de un día se reparte entre los usuarios con **horas de turno en ese
día**, proporcionalmente. Las horas salen de la lógica de recorte que ya
existe en `lib/turnos.ts` — reutilízala, no la copies. Un turno nocturno
22:00–06:00 aporta 2 horas a un día y 6 al siguiente, así que participa en
los pozos de los dos días en esa proporción.

Si en un día hubo pozo pero **nadie tuvo turno**, ese pozo queda sin
repartir. Repórtalo aparte como `pozoSinRepartir` — no lo escondas y no lo
repartas entre quienes no estuvieron.

### Redondeo: la suma tiene que cuadrar

Repartir un pozo por horas da fracciones. Usa `Prisma.Decimal` en todo el
cálculo, redondea cada tajada a **pesos enteros**, y asigna el residuo del
redondeo a la persona con más horas de ese día.

La invariante es que **la suma de las tajadas de un día es exactamente el
pozo de ese día**, sin un peso de más ni de menos. Esto va con prueba
propia: es la clase de error que nadie nota hasta que alguien suma a mano.

## Parte 4 — Cerrado contra provisional

- Un día está **cerrado** cuando su día Bogotá ya terminó (`finDiaBogota`
  del día es menor que ahora).
- El día en curso es **provisional**.

Un día cerrado con umbral mensual también es definitivo, y vale la pena
entender por qué: las pantallas se ordenan cronológicamente, así que una
venta de hoy **no puede** cambiar si una pantalla del día 3 fue absorbida
por el umbral. El pasado no se mueve. Déjalo comentado.

Lo que sí cambia en vivo es **la tajada del día en curso**: si entra alguien
más a turno, el denominador crece y la cifra de los demás baja. Por eso
tiene que ir marcada como provisional en la respuesta y en la pantalla, con
ese texto. Si no, el primer día que una cifra baje sola vas a tener un
problema con los empleados.

## Parte 5 — Lo que esta entrega NO hace

**No congela nada y no registra pagos.** La comisión se calcula al leer.

La consecuencia hay que decirla: si el ADMIN **edita un turno del pasado**,
las cifras de días ya cerrados cambian. Eso es correcto mientras esto sea
información, y deja de serlo el día que se pague con estos números — ahí
hará falta un paso de liquidación que congele el periodo con la
configuración vigente (por eso `ConfiguracionComision` guarda versiones).

Escríbelo como comentario en la cabecera del módulo, para que quien venga
después sepa que la ausencia de congelado es deliberada y no un olvido.

## Parte 6 — Rutas

Prefijo `/comisiones` (el que ya existe).

- `GET /comisiones/mias?desde=&hasta=` — **EMPLEADO en adelante**, siempre
  las propias, sin que un parámetro pueda pedir las de otro. Devuelve el
  total **cerrado** del rango, el **provisional** de hoy aparte, y el detalle
  por día con sus horas y su tajada.
- `GET /comisiones/resumen?desde=&hasta=` — **solo ADMIN**. Por usuario:
  horas, tajada cerrada y provisional. Más el pozo total del rango, el
  `pozoSinRepartir`, y cuántas pantallas comisionaron.

## Parte 7 — Frontend

- **Empleado**: en `panel/comisiones` o en su propia entrada, su comisión del
  mes con el cerrado en grande y el provisional de hoy claramente aparte y
  rotulado como tal. Tabla por día con horas y tajada.
- **ADMIN**: el resumen del periodo por persona, con el pozo y, si hay
  `pozoSinRepartir`, un aviso visible — significa que se vendió en días sin
  nadie de turno.

La pantalla del empleado **no muestra el precio de venta ni el pozo total**:
con el modo porcentaje y su propia tajada podría despejar cifras que no le
corresponden. Solo sus horas y su comisión.

## Parte 8 — Pruebas

- **La suma de las tajadas de un día es exactamente el pozo de ese día**, con
  horas que no dividen exacto (3 personas, 7 horas repartidas) y con montos
  que obligan a redondear.
- Proporcionalidad: 8h y 4h reparten 2/3 y 1/3.
- Alguien sin turno ese día no recibe nada, aunque haya vendido.
- Un turno nocturno reparte comisión en los dos días, en proporción a las
  horas de cada uno.
- Día con ventas y sin nadie de turno: todo el pozo va a `pozoSinRepartir` y
  nadie recibe.
- Un día cerrado **no cambia** cuando se registra una venta nueva hoy, con
  umbral mensual.
- El provisional de hoy **baja** cuando entra otra persona a turno (es el
  comportamiento esperado, con prueba que lo fije).
- Las `HoraAdicional` no cambian ninguna tajada.
- Un `VENDEDOR` recibe 403; un `EMPLEADO` recibe 403 en `/resumen`.
- `GET /comisiones/mias` con un `usuarioId` ajeno por query devuelve las
  propias, nunca las del otro.
- Sin configuración guardada: resultado vacío marcado, no un 500.
- R1: nada cruza empresas.

## Al terminar

Reporta la lista de archivos tocados **verificada contra `git status`**,
pruebas antes y después, y **qué función concreta quedó compartida entre el
simulador y el cálculo**, con su archivo y línea, para poder verificar que no
hay dos implementaciones de la regla del dinero.
