-- CreateTable
CREATE TABLE "CostoPlataforma" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "plataformaId" TEXT NOT NULL,
    "duracionId" TEXT NOT NULL,
    "costo" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CostoPlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostoPlataforma_empresaId_idx" ON "CostoPlataforma"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "CostoPlataforma_empresaId_plataformaId_duracionId_key" ON "CostoPlataforma"("empresaId", "plataformaId", "duracionId");

-- AddForeignKey
ALTER TABLE "CostoPlataforma" ADD CONSTRAINT "CostoPlataforma_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostoPlataforma" ADD CONSTRAINT "CostoPlataforma_plataformaId_fkey" FOREIGN KEY ("plataformaId") REFERENCES "Plataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostoPlataforma" ADD CONSTRAINT "CostoPlataforma_duracionId_fkey" FOREIGN KEY ("duracionId") REFERENCES "Duracion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
