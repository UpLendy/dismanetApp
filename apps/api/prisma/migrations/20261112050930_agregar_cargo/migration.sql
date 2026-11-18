-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "cargoId" TEXT;

-- CreateTable
CREATE TABLE "Cargo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cargo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cargo_empresaId_idx" ON "Cargo"("empresaId");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "Cargo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cargo" ADD CONSTRAINT "Cargo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mismo patrón que 20260930010000_indices_unicos_parciales_catalogo: nombre
-- único solo entre cargos ACTIVOS de una misma empresa. Un índice único
-- sobre toda la tabla impediría reutilizar el nombre de un cargo desactivado
-- (R3: los cargos se desactivan, nunca se borran).
CREATE UNIQUE INDEX "cargo_empresaId_nombre_activo_key"
  ON "Cargo" ("empresaId", "nombre")
  WHERE "activo" = true;
