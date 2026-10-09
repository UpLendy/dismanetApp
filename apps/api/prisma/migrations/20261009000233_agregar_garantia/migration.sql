-- CreateTable
CREATE TABLE "Garantia" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "ventaDetalleOriginalId" TEXT NOT NULL,
    "ventaDetalleReemplazoId" TEXT NOT NULL,
    "motivo" TEXT,
    "costoAsumido" DECIMAL(14,2) NOT NULL,
    "mensajeGenerado" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Garantia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Garantia_ventaDetalleOriginalId_key" ON "Garantia"("ventaDetalleOriginalId");

-- CreateIndex
CREATE UNIQUE INDEX "Garantia_ventaDetalleReemplazoId_key" ON "Garantia"("ventaDetalleReemplazoId");

-- CreateIndex
CREATE INDEX "Garantia_empresaId_idx" ON "Garantia"("empresaId");

-- AddForeignKey
ALTER TABLE "Garantia" ADD CONSTRAINT "Garantia_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Garantia" ADD CONSTRAINT "Garantia_ventaDetalleOriginalId_fkey" FOREIGN KEY ("ventaDetalleOriginalId") REFERENCES "VentaDetalle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Garantia" ADD CONSTRAINT "Garantia_ventaDetalleReemplazoId_fkey" FOREIGN KEY ("ventaDetalleReemplazoId") REFERENCES "VentaDetalle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Garantia" ADD CONSTRAINT "Garantia_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
