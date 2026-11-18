-- CreateEnum
CREATE TYPE "ModoComision" AS ENUM ('PORCENTAJE_VENTA', 'FIJO_POR_PANTALLA');

-- CreateEnum
CREATE TYPE "AmbitoUmbral" AS ENUM ('TOTAL', 'POR_PLATAFORMA');

-- CreateEnum
CREATE TYPE "PeriodoUmbral" AS ENUM ('DIA', 'MES');

-- CreateTable
CREATE TABLE "ConfiguracionComision" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "modo" "ModoComision" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "umbralCantidad" INTEGER NOT NULL,
    "umbralAmbito" "AmbitoUmbral" NOT NULL,
    "umbralPeriodo" "PeriodoUmbral" NOT NULL,
    "vigenteDesde" TIMESTAMP(3) NOT NULL,
    "creadaPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfiguracionComision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConfiguracionComision_empresaId_vigenteDesde_idx" ON "ConfiguracionComision"("empresaId", "vigenteDesde");

-- AddForeignKey
ALTER TABLE "ConfiguracionComision" ADD CONSTRAINT "ConfiguracionComision_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracionComision" ADD CONSTRAINT "ConfiguracionComision_creadaPorId_fkey" FOREIGN KEY ("creadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
