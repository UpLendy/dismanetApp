-- AlterTable: columna nullable primero, se llena abajo y luego se exige NOT NULL.
ALTER TABLE "Venta" ADD COLUMN     "precioSugerido" DECIMAL(14,2);

-- Backfill (F4.4): antes de esta entrega no existía forma de descontar el
-- precio de venta, así que lo que se cobró ES el precio sugerido de catálogo
-- para todo lo histórico. No es un dato inventado.
UPDATE "Venta" SET "precioSugerido" = "precioVenta" WHERE "precioSugerido" IS NULL;

ALTER TABLE "Venta" ALTER COLUMN "precioSugerido" SET NOT NULL;

-- AlterTable: nullable y SIN backfill a propósito (F4.4). El precio/costo
-- por renglón de lo histórico no se puede reconstruir sin inventar datos;
-- se queda null y solo las ventas nuevas lo llenan.
ALTER TABLE "VentaDetalle" ADD COLUMN     "costo" DECIMAL(14,2),
ADD COLUMN     "precioSugerido" DECIMAL(14,2);
