-- CreateTable
CREATE TABLE "ReporteSemanal" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "cargoId" TEXT,
    "semanaInicio" TIMESTAMP(3) NOT NULL,
    "pendientes" TEXT NOT NULL,
    "fallas" TEXT NOT NULL,
    "oportunidades" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReporteSemanal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReporteSemanal_empresaId_semanaInicio_idx" ON "ReporteSemanal"("empresaId", "semanaInicio");

-- CreateIndex
CREATE INDEX "ReporteSemanal_empresaId_cargoId_semanaInicio_idx" ON "ReporteSemanal"("empresaId", "cargoId", "semanaInicio");

-- CreateIndex
CREATE UNIQUE INDEX "ReporteSemanal_empresaId_usuarioId_semanaInicio_key" ON "ReporteSemanal"("empresaId", "usuarioId", "semanaInicio");

-- AddForeignKey
ALTER TABLE "ReporteSemanal" ADD CONSTRAINT "ReporteSemanal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReporteSemanal" ADD CONSTRAINT "ReporteSemanal_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
