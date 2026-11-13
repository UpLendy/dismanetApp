-- CreateEnum
CREATE TYPE "EstadoHoraAdicional" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "HoraAdicional" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "estado" "EstadoHoraAdicional" NOT NULL DEFAULT 'PENDIENTE',
    "revisadaPorId" TEXT,
    "revisadaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoraAdicional_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HoraAdicional_empresaId_usuarioId_idx" ON "HoraAdicional"("empresaId", "usuarioId");

-- CreateIndex
CREATE INDEX "HoraAdicional_empresaId_inicio_idx" ON "HoraAdicional"("empresaId", "inicio");

-- CreateIndex
CREATE INDEX "HoraAdicional_empresaId_estado_idx" ON "HoraAdicional"("empresaId", "estado");

-- AddForeignKey
ALTER TABLE "HoraAdicional" ADD CONSTRAINT "HoraAdicional_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoraAdicional" ADD CONSTRAINT "HoraAdicional_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoraAdicional" ADD CONSTRAINT "HoraAdicional_revisadaPorId_fkey" FOREIGN KEY ("revisadaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
