-- CreateTable
CREATE TABLE "Turno" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Festivo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "nombre" TEXT NOT NULL,
    "generado" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Festivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Turno_empresaId_usuarioId_idx" ON "Turno"("empresaId", "usuarioId");

-- CreateIndex
CREATE INDEX "Turno_empresaId_inicio_idx" ON "Turno"("empresaId", "inicio");

-- CreateIndex
CREATE INDEX "Festivo_empresaId_idx" ON "Festivo"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Festivo_empresaId_fecha_key" ON "Festivo"("empresaId", "fecha");

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Festivo" ADD CONSTRAINT "Festivo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
