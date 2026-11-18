# F6.3 — Horas adicionales y festivas

Tercera entrega del bloque de empleados. Depende de F6.2 (turnos y
festivos). Cubre el punto 4 del cliente: *"espacio para que cada empleado
registre sus horas adicionales y festivas, contabilizadas por hora"*.

## Parte 0 — Dos límites que definen la entrega

### 0.1 Esto es un REGISTRO, no una nómina

El cliente lo confirmó explícitamente: quiere llevar la cuenta, no liquidar
el pago. Su contador sigue haciendo la nómina.

Entonces: **no calcules recargos legales. Ninguno.** Nada de multiplicar por
1,75, ni por 2,0, ni aplicar porcentajes de ley. El sistema reporta *cuántas
horas* y *de qué tipo de día*, y ahí se detiene.

Tampoco clasifiques horas nocturnas. La ventana legal de la jornada nocturna
en Colombia cambió en los últimos años y no voy a fijar un horario de memoria
en un dato que alguien puede terminar usando para pagar. Si el contador del
cliente lo pide después, se agrega con la ventana que él indique.

Lo que sí se clasifica es objetivo y sale de datos propios: **si el día es
festivo o domingo**, usando la tabla `Festivo` de F6.2.

### 0.2 Quién registra horas: planta, no revendedores

Un `VENDEDOR` en este sistema es un **revendedor externo** (lleva saldo
prepago, rol-driven). No tiene turno laboral.

En F6.2 el calendario quedó visible desde `VENDEDOR` — eso fue un error del
documento anterior, mío. En esta entrega:

- `/horas-adicionales` es **EMPLEADO en adelante**, nunca VENDEDOR.
- Cambia también el `rolMinimo` de "Calendario" en `apps/web/lib/nav.ts` de
  `VENDEDOR` a `EMPLEADO`, y la guarda de `routes/turnos.ts:79` de
  `Rol.VENDEDOR` a `Rol.EMPLEADO`.
- Ajusta la prueba de `app-compuesta.test.ts` que hoy afirma que un VENDEDOR
  lista `/turnos`: ahora debe recibir 403.

Si esto rompe más pruebas de las esperadas, para y dime antes de ajustarlas
en masa.

## Parte 1 — Modelo

```prisma
enum EstadoHoraAdicional {
  PENDIENTE
  APROBADA
  RECHAZADA
}

model HoraAdicional {
  id            String   @id @default(cuid())
  empresaId     String
  usuarioId     String
  inicio        DateTime
  fin           DateTime
  motivo        String?
  estado        EstadoHoraAdicional @default(PENDIENTE)
  revisadaPorId String?
  revisadaEn    DateTime?
  createdAt     DateTime @default(now())
}
```

`inicio` y `fin` como instantes absolutos, **por la misma razón que `Turno`**:
un bloque de 20:00 a 02:00 cruza la medianoche y puede cruzar de un día
ordinario a uno festivo.

El enum es nuevo completo, así que va en la misma migración que la tabla —
la regla de separar archivos aplica a *agregar valores a un enum existente*,
no a crear uno.

## Parte 2 — Reglas

- `fin > inicio`; duración máxima 24 horas. Mismos límites que `Turno`.
- **No puede solaparse con un `Turno` del mismo usuario.** Si estabas de
  turno, esas horas no son adicionales. 409 `SOLAPA_CON_TURNO`, nombrando el
  turno.
- **No puede solaparse con otra `HoraAdicional` del mismo usuario** que no
  esté `RECHAZADA`. 409 `SOLAPA_CON_HORA_ADICIONAL`.
- Las dos comprobaciones van **bajo `bloquearUsuarioParaTurno`**, el bloqueo
  que ya existe en `lib/bloqueo-usuario.ts`. Sin él, dos envíos simultáneos
  leen "libre" los dos e insertan solapado — exactamente la carrera que esa
  función se agregó para cerrar en F6.2.
- Solo se puede editar o borrar mientras esté `PENDIENTE`. Una vez aprobada
  o rechazada es un hecho registrado, no un borrador.

### Reparto de horas por día

Un bloque que cruza la medianoche aporta sus horas a cada día por separado,
y cada día se clasifica por su cuenta: 20:00–02:00 de un sábado a un domingo
aporta 4 horas ordinarias y 2 dominicales.

**Reutiliza la lógica de recorte por día que ya escribiste en F6.2**
(`lib/turnos.ts`). No la copies ni la reimplementes: si hay que extraerla a
una función compartida, extráela.

## Parte 3 — Rutas

Prefijo `/horas-adicionales`, **EMPLEADO en adelante**.

- `POST /` — cada quien registra **las suyas**. Un ADMIN puede registrar
  para cualquiera de su empresa; los demás roles, solo para sí mismos, y el
  `usuarioId` del body no puede ampliar eso.
- `GET /?desde=&hasta=&estado=` — ADMIN ve las de toda la empresa; los demás,
  solo las propias, sin que un parámetro pueda ampliarlo (mismo patrón que
  `GET /turnos` de F6.2).
- `PATCH /:id` y `DELETE /:id` — solo si está `PENDIENTE`; propias, o
  cualquiera si es ADMIN.
- `PATCH /:id/aprobar` y `PATCH /:id/rechazar` — **solo ADMIN**. Guardan
  `revisadaPorId` y `revisadaEn`.
- `GET /resumen?desde=&hasta=` — por usuario: horas ordinarias y horas
  dominicales/festivas, **contando solo las `APROBADA`**, más el número de
  `PENDIENTE` para que el ADMIN sepa qué le falta revisar.

### Sobre el flujo de aprobación

El cliente no lo pidió: pidió "un espacio para registrar". Lo agrego a
propósito y lo señalo para que pueda vetarlo. Un registro de horas que nadie
valida, en un sistema donde esas horas se van a conversar con el contador,
es una cifra que cualquiera puede inflar. Son dos rutas y un enum.

## Parte 4 — Las horas adicionales NO entran en el pozo de comisiones

Decisión explícita, para que quede escrita antes de que exista el cálculo:
la comisión se reparte por **horas de turno del calendario**, como lo dijo
el cliente, y las horas adicionales **no** suman a ese denominador.

Si sumaran, cualquiera podría agrandar su tajada del pozo registrándose
horas a sí mismo. Déjalo como comentario en el modelo, para que el día que
se escriba el cálculo de comisiones nadie lo "arregle" sumándolas.

## Parte 5 — Frontend

Página `panel/horas-adicionales`, entrada en el sidebar en OPERACIÓN con
`rolMinimo: "EMPLEADO"`.

- **Empleado**: formulario para registrar un bloque (fecha, hora de inicio,
  hora de fin, motivo opcional) y la lista de los suyos con su estado.
  Mientras esté pendiente puede editarlo o borrarlo.
- **ADMIN**: la lista de todos, filtrable por estado, con los botones de
  aprobar y rechazar, y el resumen de horas por persona del rango.
- Los días festivos del bloque se muestran marcados, usando la misma fuente
  que el calendario.
- El 409 de solapamiento muestra con qué choca, no un error genérico.

## Parte 6 — Pruebas

- Solapamiento con un turno propio: 409. Con un turno de **otro** usuario:
  válido.
- Solapamiento con otra hora adicional propia no rechazada: 409. Si la otra
  está `RECHAZADA`: válido.
- Bloque 20:00 sábado – 02:00 domingo: 4 horas ordinarias y 2 dominicales en
  el resumen.
- Un bloque en una fecha de la tabla `Festivo` cuenta como festiva.
- `fin <= inicio` y duración > 24h: rechazados.
- Editar o borrar una `APROBADA`: 409.
- Un EMPLEADO no puede registrar horas para otro usuario ni listar las
  ajenas, aunque mande el `usuarioId` por body o por query.
- Un EMPLEADO recibe 403 en aprobar y rechazar.
- Un VENDEDOR recibe 403 en **todas** las rutas, incluidas las de `/turnos`
  tras el cambio de la parte 0.2.
- El resumen cuenta solo `APROBADA` e informa aparte las `PENDIENTE`.
- R1 en todo: nada cruza empresas.

## Lo que NO entra

Metas diarias, comisiones, reportes semanales por cargo, estadísticas por
empleado, instrucciones con video. Ningún cálculo de recargo legal ni
clasificación de jornada nocturna.

## Al terminar

Reporta la lista de archivos tocados **verificada contra `git status`**, y
pruebas antes y después. Si el cambio de VENDEDOR a EMPLEADO de la parte 0.2
rompe pruebas que no sean la de `app-compuesta.test.ts`, dilo en vez de
ajustarlas por tu cuenta.
