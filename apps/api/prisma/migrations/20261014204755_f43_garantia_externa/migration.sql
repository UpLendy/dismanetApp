-- DropForeignKey
ALTER TABLE "Garantia" DROP CONSTRAINT "Garantia_ventaDetalleOriginalId_fkey";

-- DropForeignKey
ALTER TABLE "Venta" DROP CONSTRAINT "Venta_tipoClienteId_fkey";

-- AlterTable
ALTER TABLE "Garantia" ADD COLUMN     "celularExterno" TEXT,
ADD COLUMN     "esExterna" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "plataformaExternaId" TEXT,
ALTER COLUMN "ventaDetalleOriginalId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "esExterna" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "tipoClienteId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_tipoClienteId_fkey" FOREIGN KEY ("tipoClienteId") REFERENCES "TipoCliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Garantia" ADD CONSTRAINT "Garantia_ventaDetalleOriginalId_fkey" FOREIGN KEY ("ventaDetalleOriginalId") REFERENCES "VentaDetalle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Garantia" ADD CONSTRAINT "Garantia_plataformaExternaId_fkey" FOREIGN KEY ("plataformaExternaId") REFERENCES "Plataforma"("id") ON DELETE SET NULL ON UPDATE CASCADE;
