-- Migración de datos (no de esquema): el tipo de cliente "Promoción" era
-- cómo el cliente expresaba precios promocionales antes de que esPromocion
-- existiera como bandera de Paquete/Venta. Queda obsoleto: si sigue activo,
-- el vendedor ve "Promoción" en dos lugares con dos significados distintos.
--
-- No se borra (R3): hay ventas históricas que lo referencian. Solo se
-- desactiva, y solo si existe y sigue activo — UPDATE sobre un WHERE que no
-- empareja ninguna fila no falla, así que es segura en una empresa nueva
-- que nunca tuvo este tipo de cliente, y correrla dos veces no cambia nada
-- la segunda vez.
UPDATE "TipoCliente"
SET activo = false
WHERE nombre = 'Promoción' AND activo = true;
