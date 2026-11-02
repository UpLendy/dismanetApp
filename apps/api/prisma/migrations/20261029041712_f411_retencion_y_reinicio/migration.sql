-- AlterTable
ALTER TABLE "Pantalla" ADD COLUMN     "liberadaEn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReinicioCuenta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "pantallasLiberadas" INTEGER NOT NULL,
    "pantallasConVentaVigente" INTEGER NOT NULL,
    "codigosCompraAfectados" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReinicioCuenta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReinicioCuenta_empresaId_idx" ON "ReinicioCuenta"("empresaId");

-- CreateIndex
CREATE INDEX "ReinicioCuenta_cuentaId_idx" ON "ReinicioCuenta"("cuentaId");

-- AddForeignKey
ALTER TABLE "ReinicioCuenta" ADD CONSTRAINT "ReinicioCuenta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReinicioCuenta" ADD CONSTRAINT "ReinicioCuenta_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReinicioCuenta" ADD CONSTRAINT "ReinicioCuenta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
