# Subir garantías y el pulido — 9 de octubre

**Qué entra:** el módulo de garantías (F2.5) y los ocho arreglos del pulido (F2.4).
**Riesgo:** el más bajo de los tres despliegues. Una sola migración y es `CREATE TABLE`.

---

## Lo que cambia respecto al despliegue anterior

| | 8 de octubre | Hoy |
|---|---|---|
| Migraciones | 5, una tocaba datos | **1, solo crea una tabla** |
| Sesiones | se cayeron todas | **nadie pierde la sesión** |
| Datos existentes | se desactivó un tipo de cliente | **nada se toca** |

Nadie va a tener que volver a entrar, y ninguna fila existente cambia. Es un despliegue aditivo puro.

---

## Lo único que hay que avisarle al cliente antes

**Sus vendedores van a ver un menú nuevo: "Pantallas vendidas".** Y ahí ven **todas** las pantallas entregadas por todos, con el correo y la contraseña de cada cuenta — no solo las suyas.

Es lo que él pidió, y tiene sentido: quien contesta la llamada del comprador no siempre es quien vendió, y para revisar si la cuenta sirve necesita entrar. Pero es una ampliación real de lo que ve un empleado, y conviene que la sepa por ti y no por un vendedor preguntando.

Lo que **no** se amplió: sus vendedores siguen sin ver costo, utilidad ni margen, y el celular del comprador se sigue viendo solo en las ventas propias.

---

## Pasos

**1. Correr todo** (toqué `dialogo.tsx` y la pantalla de garantías después de la última corrida):

```
cd apps/api && bun test && npx tsc --noEmit
cd ../web && bun test && npx tsc --noEmit
```

**2. Commitear.** Dos commits, para que garantías se pueda revertir sin arrastrar el pulido:

```
cd ~/Documents/work/dismanet/dismanet-app

git add apps/api/src/lib/garantias.ts apps/api/src/lib/garantias.test.ts \
        apps/api/src/routes/garantias.ts apps/api/src/routes/garantias.test.ts \
        apps/api/prisma/migrations/20261009000233_agregar_garantia \
        apps/api/prisma/schema.prisma apps/api/src/index.ts \
        "apps/web/app/(protegido)/(vendedor)/pantallas-vendidas" \
        apps/web/lib/nav.ts PROMPT-F2.5-GARANTIAS.md GARANTIAS-PREGUNTAS-CLIENTE.md
git commit -m "feat: garantias con vista de pantallas vendidas y reemplazo por pantalla"

git add -A
git commit -m "fix: pulido de F2.4, login al sistema de diseno y anidamiento invalido en Dialogo"
```

**3. Pausar los despliegues automáticos en Vercel.** Railway tarda minutos construyendo la imagen; Vercel tarda segundos. Si salen a la vez, el web nuevo pide `/garantias/...` a una API que todavía no la tiene.

**4. Empujar:**

```
git push
```

**5. Esperar a Railway** y verificar:

```
curl https://<tu-api>.up.railway.app/salud
```

En los logs del arranque tiene que verse `migrate deploy` aplicando `20261009000233_agregar_garantia`.

**6. Reanudar Vercel** y dejar que despliegue el web.

**7. Probar tú, antes de avisarle a él:**

- [ ] Entra como ADMIN — **sin tener que volver a loguearte**, esa es la señal de que no se cayeron las sesiones
- [ ] "Pantallas vendidas" aparece en el menú y lista las pantallas entregadas
- [ ] Abre "Reemplazar" en una fila vigente: el diálogo sale bien, con el campo de motivo
- [ ] Haz un reemplazo de verdad y copia el mensaje: debe decir "Reemplazo de pantalla" y traer solo la plataforma reemplazada
- [ ] La fila queda como "Reemplazada" y ya no ofrece el botón
- [ ] Entra como VENDEDOR: ve el menú nuevo, **no** ve "Pérdida asumida" en el detalle
- [ ] El login ya sale con el botón rojo de la marca, no negro

**Si algo sale mal:** revierte el merge y empuja. La migración solo crea una tabla, así que el código anterior funciona igual contra la base nueva — no hay nada que deshacer en la base.

---

## Para mandarle al cliente

> Ya está arriba la primera versión de **garantías**.
>
> **Dónde:** menú "Pantallas vendidas", arriba de Ventas. Ahí sale una fila por cada pantalla que han entregado.
>
> **Cómo funciona:** cuando un comprador llama diciendo que la cuenta no sirve, buscas su pantalla —por código de compra o por el correo de la cuenta— revisas, y si de verdad no sirve le das a **Reemplazar**. El sistema le entrega otra pantalla de la misma plataforma por los días que le quedaban, te genera el mensaje de WhatsApp para enviárselo, y saca del inventario la pantalla dañada para que no se vuelva a vender.
>
> Puedes anotar el motivo si quieres, es opcional.
>
> **Lo que cambia para tus vendedores:** ahora ven todas las pantallas entregadas, no solo las suyas, con los datos de la cuenta. Es necesario para que cualquiera pueda atender una llamada, pero quería que lo supieras. Siguen sin ver precios de costo ni ganancias.
>
> **Lo que todavía no hace, a propósito:** si se cae una cuenta entera, hay que reemplazar una por una, no todas de un golpe. Y si no hay ninguna pantalla libre de esa plataforma, te avisa pero no deja nada anotado pendiente. Las dos cosas se pueden agregar; quise sacar primero lo mínimo que resuelve la llamada del comprador.
>
> **Lo que me falta de ti:** la tabla de costos. Mientras siga en cero, la ganancia que ves es igual a la venta — el sistema no sabe cuánto te costó, así que no te puede decir cuánto ganaste. Es lo que más valor agrega de todo lo que queda pendiente.

---

## Lo que queda abierto después de esto

- `--secundario-suave` sigue claro en modo oscuro: avisos de info, pastillas y tarjetas de acceso se ven como bloques claros sobre fondo negro. Media hora, necesita un `--secundario-texto` nuevo.
- La tabla de "Pantallas vendidas" se desborda igual que se desbordaba la de usuarios: hay que desplazarla para alcanzar los botones.
- Los costos del cliente, que no son código.
- Rotar la contraseña del admin.
- Probar una restauración de respaldo de verdad.
