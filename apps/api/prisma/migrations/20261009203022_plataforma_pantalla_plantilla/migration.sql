-- CreateTable
CREATE TABLE "PlataformaPantalla" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "plataformaId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "perfil" TEXT,
    "pin" TEXT,

    CONSTRAINT "PlataformaPantalla_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlataformaPantalla_empresaId_idx" ON "PlataformaPantalla"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "PlataformaPantalla_plataformaId_numero_key" ON "PlataformaPantalla"("plataformaId", "numero");

-- AddForeignKey
ALTER TABLE "PlataformaPantalla" ADD CONSTRAINT "PlataformaPantalla_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlataformaPantalla" ADD CONSTRAINT "PlataformaPantalla_plataformaId_fkey" FOREIGN KEY ("plataformaId") REFERENCES "Plataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
