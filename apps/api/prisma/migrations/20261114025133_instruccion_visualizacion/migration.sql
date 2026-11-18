-- CreateTable
CREATE TABLE "InstruccionVisualizacion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "archivoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tramos" JSONB NOT NULL,
    "segundosVistos" INTEGER NOT NULL DEFAULT 0,
    "primerReporte" TIMESTAMP(3) NOT NULL,
    "ultimoReporte" TIMESTAMP(3) NOT NULL,
    "completadoEn" TIMESTAMP(3),

    CONSTRAINT "InstruccionVisualizacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstruccionVisualizacion_empresaId_archivoId_idx" ON "InstruccionVisualizacion"("empresaId", "archivoId");

-- CreateIndex
CREATE UNIQUE INDEX "InstruccionVisualizacion_archivoId_usuarioId_key" ON "InstruccionVisualizacion"("archivoId", "usuarioId");

-- AddForeignKey
ALTER TABLE "InstruccionVisualizacion" ADD CONSTRAINT "InstruccionVisualizacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstruccionVisualizacion" ADD CONSTRAINT "InstruccionVisualizacion_archivoId_fkey" FOREIGN KEY ("archivoId") REFERENCES "InstruccionArchivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstruccionVisualizacion" ADD CONSTRAINT "InstruccionVisualizacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
