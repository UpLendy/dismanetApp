-- AlterTable
ALTER TABLE "Paquete" ADD COLUMN     "esPromocion" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "esPromocion" BOOLEAN NOT NULL DEFAULT false;
