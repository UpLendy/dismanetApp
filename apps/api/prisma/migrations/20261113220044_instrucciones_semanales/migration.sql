-- CreateEnum
CREATE TYPE "TipoArchivoInstruccion" AS ENUM ('IMAGEN', 'VIDEO');

-- CreateTable
CREATE TABLE "Instruccion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "semanaInicio" TIMESTAMP(3) NOT NULL,
    "cargoId" TEXT,
    "publicada" BOOLEAN NOT NULL DEFAULT false,
    "creadaPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadaEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instruccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstruccionArchivo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "instruccionId" TEXT NOT NULL,
    "tipo" "TipoArchivoInstruccion" NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "duracionSegundos" INTEGER,
    "orden" INTEGER NOT NULL,
    "subidoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstruccionArchivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstruccionCumplimiento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "instruccionId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "completadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstruccionCumplimiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Instruccion_empresaId_semanaInicio_idx" ON "Instruccion"("empresaId", "semanaInicio");

-- CreateIndex
CREATE INDEX "Instruccion_empresaId_cargoId_idx" ON "Instruccion"("empresaId", "cargoId");

-- CreateIndex
CREATE INDEX "InstruccionArchivo_empresaId_instruccionId_idx" ON "InstruccionArchivo"("empresaId", "instruccionId");

-- CreateIndex
CREATE INDEX "InstruccionCumplimiento_empresaId_instruccionId_idx" ON "InstruccionCumplimiento"("empresaId", "instruccionId");

-- CreateIndex
CREATE UNIQUE INDEX "InstruccionCumplimiento_instruccionId_usuarioId_key" ON "InstruccionCumplimiento"("instruccionId", "usuarioId");

-- AddForeignKey
ALTER TABLE "Instruccion" ADD CONSTRAINT "Instruccion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instruccion" ADD CONSTRAINT "Instruccion_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "Cargo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instruccion" ADD CONSTRAINT "Instruccion_creadaPorId_fkey" FOREIGN KEY ("creadaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstruccionArchivo" ADD CONSTRAINT "InstruccionArchivo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstruccionArchivo" ADD CONSTRAINT "InstruccionArchivo_instruccionId_fkey" FOREIGN KEY ("instruccionId") REFERENCES "Instruccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstruccionArchivo" ADD CONSTRAINT "InstruccionArchivo_subidoPorId_fkey" FOREIGN KEY ("subidoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstruccionCumplimiento" ADD CONSTRAINT "InstruccionCumplimiento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstruccionCumplimiento" ADD CONSTRAINT "InstruccionCumplimiento_instruccionId_fkey" FOREIGN KEY ("instruccionId") REFERENCES "Instruccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstruccionCumplimiento" ADD CONSTRAINT "InstruccionCumplimiento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
