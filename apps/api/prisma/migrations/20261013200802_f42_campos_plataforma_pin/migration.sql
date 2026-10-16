-- AlterTable
ALTER TABLE "Cuenta" ADD COLUMN     "codigo" TEXT,
ADD COLUMN     "enlace" TEXT,
ADD COLUMN     "usuario" TEXT,
ALTER COLUMN "correo" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Plataforma" ADD COLUMN     "usaCodigo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "usaCorreo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "usaEnlace" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "usaUsuario" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "VentaDetalle" ADD COLUMN     "codigoCuenta" TEXT,
ADD COLUMN     "enlaceCuenta" TEXT,
ADD COLUMN     "usuarioCuenta" TEXT,
ALTER COLUMN "correoCuenta" DROP NOT NULL;
