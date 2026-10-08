-- CreateEnum
CREATE TYPE "TipoMovimientoSaldo" AS ENUM ('CARGA', 'CONSUMO', 'DEVOLUCION', 'AJUSTE');

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "saldo" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "usaSaldo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MovimientoSaldo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tipo" "TipoMovimientoSaldo" NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "saldoResultante" DECIMAL(14,2) NOT NULL,
    "ventaId" TEXT,
    "nota" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoSaldo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MovimientoSaldo_empresaId_idx" ON "MovimientoSaldo"("empresaId");

-- CreateIndex
CREATE INDEX "MovimientoSaldo_usuarioId_idx" ON "MovimientoSaldo"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoSaldo_empresaId_ventaId_tipo_key" ON "MovimientoSaldo"("empresaId", "ventaId", "tipo");

-- AddForeignKey
ALTER TABLE "MovimientoSaldo" ADD CONSTRAINT "MovimientoSaldo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoSaldo" ADD CONSTRAINT "MovimientoSaldo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoSaldo" ADD CONSTRAINT "MovimientoSaldo_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoSaldo" ADD CONSTRAINT "MovimientoSaldo_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
