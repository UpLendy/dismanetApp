/*
  Warnings:

  - Added the required column `actualizadaEn` to the `PlantillaMensaje` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PlantillaMensaje" ADD COLUMN     "actualizadaEn" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Precio" ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true;
