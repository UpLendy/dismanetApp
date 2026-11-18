-- CreateTable
CREATE TABLE "ConfiguracionComisionPlataforma" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "configuracionId" TEXT NOT NULL,
    "plataformaId" TEXT NOT NULL,
    "comisiona" BOOLEAN NOT NULL DEFAULT true,
    "modo" "ModoComision",
    "valor" DECIMAL(14,2),
    "umbralCantidad" INTEGER,

    CONSTRAINT "ConfiguracionComisionPlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConfiguracionComisionPlataforma_empresaId_configuracionId_idx" ON "ConfiguracionComisionPlataforma"("empresaId", "configuracionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionComisionPlataforma_empresaId_configuracionId_p_key" ON "ConfiguracionComisionPlataforma"("empresaId", "configuracionId", "plataformaId");

-- AddForeignKey
ALTER TABLE "ConfiguracionComisionPlataforma" ADD CONSTRAINT "ConfiguracionComisionPlataforma_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracionComisionPlataforma" ADD CONSTRAINT "ConfiguracionComisionPlataforma_configuracionId_fkey" FOREIGN KEY ("configuracionId") REFERENCES "ConfiguracionComision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfiguracionComisionPlataforma" ADD CONSTRAINT "ConfiguracionComisionPlataforma_plataformaId_fkey" FOREIGN KEY ("plataformaId") REFERENCES "Plataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
