# Guía de despliegue — Fase 2 a producción

**Fecha:** 8 de octubre de 2026
**Qué se despliega:** 9 commits sobre `main`, con 5 migraciones.
**Dónde:** API y PostgreSQL en Railway · Web en Vercel.

> Esta guía es para **este** despliegue. El montaje de la infraestructura ya está en `DEPLOYMENT.md` y no se repite acá.

---

## 1. Lo primero: no son tres ramas, es una cadena

```
main (1dd955e)
 └── feat/perfil-mensajes-diagnostico   +6 commits
      └── feat/promociones              +7 commits  (contiene la anterior)
           └── feat/saldo-revendedores  +9 commits  (contiene las dos anteriores)
```

`feat/saldo-revendedores` ya tiene todo. No hay nada que mezclar entre ramas y no puede haber conflictos entre ellas.

**Entonces: un solo PR, de `feat/saldo-revendedores` a `main`.**

Tres PRs encadenados serían tres merges y, como `main` despliega solo, **tres despliegues a producción** — tres ventanas de riesgo, tres veces que se cae la sesión de todo el mundo, para aislar unos bloques que de todos modos van en orden. Y poder revertir un bloque suelto no se pierde: los commits siguen separados, `git revert` funciona igual sobre `main`.

```bash
gh pr create --base main --head feat/saldo-revendedores \
  --title "Fase 2: perfil, plantillas, diagnóstico, códigos, promociones y saldo" \
  --body "9 commits, 5 migraciones. Detalle y hallazgos en PROMPTS-FASE-2.md."
```

Las otras dos ramas quedan contenidas en el merge; se borran después.

---

## 2. Lo que tu cliente va a notar, lo quiera o no

Tres cambios visibles que no son features. Conviene avisarle **antes**, no después.

### 2.1 — A todo el mundo se le cae la sesión

`versionSesion` entra en el JWT y `contexto.ts` lo compara contra la base en cada petición. Los tokens que están vivos ahora no lo traen, así que **todas las sesiones abiertas quedan inválidas en el momento del despliegue**. Todos vuelven al login.

No se pierde nada y se arregla entrando otra vez. Pero si pasa a mitad de una venta y nadie avisó, se ve como que el sistema se cayó.

**Despliega cuando no estén vendiendo**, y avísale antes.

### 2.2 — El tipo de cliente "Promoción" se desactiva solo

La migración `20261007175656` corre un `UPDATE` sobre datos reales: desactiva el TipoCliente llamado "Promoción" en toda empresa que lo tenga.

Es a propósito —ahora "Promoción" es una clase de paquete y tener las dos cosas confunde al vendedor— pero tiene una consecuencia que el cliente va a ver: **esa columna y sus precios desaparecen de la matriz de precios.** No se borran, quedan inalcanzables.

Antes de desplegar vale una pregunta concreta: **¿le estaba vendiendo a alguien con el precio de "Promoción"?** Si la respuesta es sí, hay que explicarle que esos precios ahora se arman marcando un paquete como promoción.

### 2.3 — La barra de saldo no le aparece a nadie todavía

`usaSaldo` entra en `false` para todos, así que **ningún usuario cambia de comportamiento**. Eso es deliberado: nadie se queda sin vender por el despliegue. Tu cliente tiene que ir a Usuarios y marcar a mano quiénes son revendedores, y cargarles saldo.

Hasta que lo haga, el módulo de saldo está invisible y el sistema se comporta igual que hoy.

---

## 3. Antes de tocar nada

- [ ] **Respaldo de la base, tomado hoy.** Son 5 migraciones sobre datos reales de un cliente, una de ellas un `UPDATE`. Y la restauración **nunca se ha probado de verdad** (sigue abierto en `CIERRE-PRE-PRODUCCION.md`). Mínimo: snapshot en Railway antes de mergear.
- [ ] Confirmar que `CLAVE_CIFRADO` y `JWT_SECRET` de producción están guardadas fuera de Railway. No cambian en este despliegue, pero si algo sale mal y hay que recrear el servicio, sin `CLAVE_CIFRADO` las contraseñas de las cuentas son irrecuperables.
- [ ] Avisarle al cliente: ventana de unos minutos, y que van a tener que volver a entrar.

---

## 4. El orden importa: API primero, web después

El Dockerfile del API ya hace lo correcto:

```
CMD ["sh", "-c", "npx prisma migrate deploy && bun run src/index.ts"]
```

Las migraciones corren en cada arranque, son idempotentes, y el contenedor no acepta tráfico hasta que terminan. Eso está bien resuelto.

**El problema es el otro lado.** Railway construye una imagen Docker e instala dependencias: tarda minutos. Vercel construye un Next.js: tarda mucho menos. Si los dos arrancan con el mismo merge, **el web nuevo sale al aire antes que el API nuevo** y por unos minutos va a pedirle a la API vieja campos que todavía no existen — `esPromocion`, `celularCliente`, el saldo. Pantallas rotas mientras dura.

Dos formas de evitarlo, elige una:

**(a) La cuidadosa.** En Vercel, pausa los despliegues automáticos del proyecto antes de mergear. Mergeas, dejas que Railway termine, verificas salud, y recién ahí reanudas Vercel o disparas el despliegue del web a mano.

**(b) La barata.** Mergeas y aceptas la ventana, desplegando a una hora en que nadie esté vendiendo. Con el aviso del punto 2.1 ya dado, es defendible.

Yo iría por la (a) la primera vez, porque es la primera vez que este sistema recibe migraciones con un cliente adentro.

---

## 5. Verificación, en este orden

1. **API arriba:** `curl https://<tu-api>.up.railway.app/salud` → `{"ok":true}`.
2. **Migraciones aplicadas:** en los logs de Railway del arranque tiene que verse `migrate deploy` aplicando las 5 y terminando sin error. Si se queda a la mitad, no reintentes a ciegas — mira la sección correspondiente de `DEPLOYMENT.md`.
3. **Entrar como el admin del cliente.** Vas a tener que loguearte otra vez (punto 2.1). Que el panel cargue.
4. **El diagnóstico de empresa**, que para eso se construyó: que diga que la empresa puede vender.
5. **Una venta de prueba real**, de unidad, y anularla después. Es el camino que toca todo: asignación de pantallas, código de compra, mensaje.
6. **Mirar `/panel/mensajes`:** que las dos plantillas sigan ahí.
7. **Matriz de precios:** confirmar que la columna "Promoción" desapareció y que las otras dos quedaron intactas.

---

## 6. Si algo sale mal

**Las 5 migraciones son aditivas salvo el `UPDATE`.** Eso significa que **el código viejo funciona contra el esquema nuevo**: columnas de más no le molestan a nadie. Así que revertir es seguro y rápido:

```bash
git revert --no-commit <sha>..<sha>   # o revertir el merge
git push origin main
```

Railway reconstruye con el código anterior y la base se queda como está. No hay que deshacer migraciones, y **no se debe intentar**: `migrate deploy` es de un solo sentido.

Lo único que un revert de código **no** deshace es el `UPDATE` del punto 2.2. Si hay que volver atrás, el tipo de cliente "Promoción" se reactiva desde la pantalla de tipos de cliente, a mano. Treinta segundos.

---

## 7. Lo que queda abierto después de este despliegue

De `PROMPTS-FASE-2.md`, bloque F2.4 — ninguno bloquea el despliegue, pero el primero es lo primero que ve tu cliente:

- La pantalla de login está fuera del sistema de diseño: el botón sale **negro** en vez del rojo de marca.
- En oscuro, el ítem activo del menú es un bloque casi blanco.
- La tabla de usuarios se desborda y la fila pierde su nombre al cargar saldo.
- La pestaña "Promoción" se puede abrir sin haber promociones.
- La utilidad se muestra en verde aunque el costo sea cero y la cifra no sea real.
- Falta el aviso al activar "Vende contra saldo" sobre alguien con saldo en cero.

Y lo de siempre, que no es código: **los costos siguen en cero.** Es la dificultad principal que tu cliente describió en su documento original y el sistema sigue sin poder responderla. Después de este despliegue, pedírselos es lo que más valor agrega.
