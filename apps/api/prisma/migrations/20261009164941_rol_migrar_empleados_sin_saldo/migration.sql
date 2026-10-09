-- Migración de datos (separada de la que agrega el valor del enum: Postgres
-- prohíbe referenciar un valor de enum nuevo dentro de la misma transacción
-- que lo agregó). Divide VENDEDOR en VENDEDOR (revendedor, sigue vendiendo
-- contra saldo) y EMPLEADO (planta, sin saldo). Un usuario que ya no usaba
-- saldo era, en la práctica, un empleado: pasa a ese rol. Idempotente y
-- segura sobre tablas vacías.
UPDATE "Usuario" SET rol = 'EMPLEADO' WHERE rol = 'VENDEDOR' AND "usaSaldo" = false;
