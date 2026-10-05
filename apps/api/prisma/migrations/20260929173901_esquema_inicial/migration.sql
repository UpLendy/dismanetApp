-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'VENDEDOR');

-- CreateEnum
CREATE TYPE "UnidadDuracion" AS ENUM ('DIAS', 'MESES');

-- CreateEnum
CREATE TYPE "TipoVenta" AS ENUM ('UNIDAD', 'PAQUETE');

-- CreateEnum
CREATE TYPE "TipoPlantilla" AS ENUM ('UNIDAD', 'PAQUETE');

-- CreateTable
CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "nit" TEXT,
    "prefijoCodigo" VARCHAR(3) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaPorUsuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plataforma" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "nombreMensaje" TEXT,
    "condiciones" TEXT,
    "capacidadPantallas" INTEGER NOT NULL,
    "usaPerfilPin" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Plataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Duracion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "unidad" "UnidadDuracion" NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Duracion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoCliente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TipoCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paquete" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Paquete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaquetePlataforma" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "paqueteId" TEXT NOT NULL,
    "plataformaId" TEXT NOT NULL,
    "cantidadPantallas" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PaquetePlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaqueteDuracionPlataforma" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "paqueteId" TEXT NOT NULL,
    "duracionVendidaId" TEXT NOT NULL,
    "plataformaId" TEXT NOT NULL,
    "duracionRealId" TEXT NOT NULL,

    CONSTRAINT "PaqueteDuracionPlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Precio" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "plataformaId" TEXT,
    "paqueteId" TEXT,
    "duracionId" TEXT NOT NULL,
    "tipoClienteId" TEXT NOT NULL,
    "precioVenta" DECIMAL(14,2) NOT NULL,
    "costo" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "Precio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cuenta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "plataformaId" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "capacidadPantallas" INTEGER NOT NULL,
    "notas" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pantalla" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "perfil" TEXT,
    "pin" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Pantalla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "codigoCompra" TEXT NOT NULL,
    "tipoVenta" "TipoVenta" NOT NULL,
    "plataformaId" TEXT,
    "paqueteId" TEXT,
    "duracionId" TEXT NOT NULL,
    "tipoClienteId" TEXT NOT NULL,
    "nombreItem" TEXT NOT NULL,
    "nombreDuracion" TEXT NOT NULL,
    "cantidadDuracion" INTEGER NOT NULL,
    "unidadDuracion" "UnidadDuracion" NOT NULL,
    "nombreTipoCliente" TEXT NOT NULL,
    "precioVenta" DECIMAL(14,2) NOT NULL,
    "costo" DECIMAL(14,2) NOT NULL,
    "utilidad" DECIMAL(14,2) NOT NULL,
    "fechaVenta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaVencimientoMax" TIMESTAMP(3) NOT NULL,
    "mensajeGenerado" TEXT NOT NULL,
    "anulada" BOOLEAN NOT NULL DEFAULT false,
    "anuladaPorId" TEXT,
    "anuladaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VentaDetalle" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "pantallaId" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "plataformaId" TEXT NOT NULL,
    "nombrePlataforma" TEXT NOT NULL,
    "correoCuenta" TEXT NOT NULL,
    "passwordCuenta" TEXT NOT NULL,
    "perfil" TEXT,
    "pin" TEXT,
    "duracionId" TEXT NOT NULL,
    "cantidadDuracion" INTEGER NOT NULL,
    "unidadDuracion" "UnidadDuracion" NOT NULL,
    "fechaVencimiento" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VentaDetalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantillaMensaje" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" "TipoPlantilla" NOT NULL,
    "contenido" TEXT NOT NULL,

    CONSTRAINT "PlantillaMensaje_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Usuario_empresaId_idx" ON "Usuario"("empresaId");

-- CreateIndex
CREATE INDEX "Plataforma_empresaId_idx" ON "Plataforma"("empresaId");

-- CreateIndex
CREATE INDEX "Duracion_empresaId_idx" ON "Duracion"("empresaId");

-- CreateIndex
CREATE INDEX "TipoCliente_empresaId_idx" ON "TipoCliente"("empresaId");

-- CreateIndex
CREATE INDEX "Paquete_empresaId_idx" ON "Paquete"("empresaId");

-- CreateIndex
CREATE INDEX "PaquetePlataforma_empresaId_idx" ON "PaquetePlataforma"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "PaquetePlataforma_paqueteId_plataformaId_key" ON "PaquetePlataforma"("paqueteId", "plataformaId");

-- CreateIndex
CREATE INDEX "PaqueteDuracionPlataforma_empresaId_idx" ON "PaqueteDuracionPlataforma"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "PaqueteDuracionPlataforma_paqueteId_duracionVendidaId_plata_key" ON "PaqueteDuracionPlataforma"("paqueteId", "duracionVendidaId", "plataformaId");

-- CreateIndex
CREATE INDEX "Precio_empresaId_idx" ON "Precio"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Precio_empresaId_plataformaId_duracionId_tipoClienteId_key" ON "Precio"("empresaId", "plataformaId", "duracionId", "tipoClienteId");

-- CreateIndex
CREATE UNIQUE INDEX "Precio_empresaId_paqueteId_duracionId_tipoClienteId_key" ON "Precio"("empresaId", "paqueteId", "duracionId", "tipoClienteId");

-- CreateIndex
CREATE INDEX "Cuenta_empresaId_idx" ON "Cuenta"("empresaId");

-- CreateIndex
CREATE INDEX "Pantalla_empresaId_idx" ON "Pantalla"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Pantalla_cuentaId_numero_key" ON "Pantalla"("cuentaId", "numero");

-- CreateIndex
CREATE INDEX "Venta_empresaId_idx" ON "Venta"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_empresaId_codigoCompra_key" ON "Venta"("empresaId", "codigoCompra");

-- CreateIndex
CREATE INDEX "VentaDetalle_empresaId_idx" ON "VentaDetalle"("empresaId");

-- CreateIndex
CREATE INDEX "VentaDetalle_pantallaId_fechaVencimiento_idx" ON "VentaDetalle"("pantallaId", "fechaVencimiento");

-- CreateIndex
CREATE INDEX "PlantillaMensaje_empresaId_idx" ON "PlantillaMensaje"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "PlantillaMensaje_empresaId_tipo_key" ON "PlantillaMensaje"("empresaId", "tipo");

-- AddForeignKey
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_creadaPorUsuarioId_fkey" FOREIGN KEY ("creadaPorUsuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plataforma" ADD CONSTRAINT "Plataforma_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Duracion" ADD CONSTRAINT "Duracion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoCliente" ADD CONSTRAINT "TipoCliente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paquete" ADD CONSTRAINT "Paquete_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaquetePlataforma" ADD CONSTRAINT "PaquetePlataforma_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaquetePlataforma" ADD CONSTRAINT "PaquetePlataforma_paqueteId_fkey" FOREIGN KEY ("paqueteId") REFERENCES "Paquete"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaquetePlataforma" ADD CONSTRAINT "PaquetePlataforma_plataformaId_fkey" FOREIGN KEY ("plataformaId") REFERENCES "Plataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaqueteDuracionPlataforma" ADD CONSTRAINT "PaqueteDuracionPlataforma_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaqueteDuracionPlataforma" ADD CONSTRAINT "PaqueteDuracionPlataforma_paqueteId_fkey" FOREIGN KEY ("paqueteId") REFERENCES "Paquete"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaqueteDuracionPlataforma" ADD CONSTRAINT "PaqueteDuracionPlataforma_duracionVendidaId_fkey" FOREIGN KEY ("duracionVendidaId") REFERENCES "Duracion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaqueteDuracionPlataforma" ADD CONSTRAINT "PaqueteDuracionPlataforma_plataformaId_fkey" FOREIGN KEY ("plataformaId") REFERENCES "Plataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaqueteDuracionPlataforma" ADD CONSTRAINT "PaqueteDuracionPlataforma_duracionRealId_fkey" FOREIGN KEY ("duracionRealId") REFERENCES "Duracion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Precio" ADD CONSTRAINT "Precio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Precio" ADD CONSTRAINT "Precio_plataformaId_fkey" FOREIGN KEY ("plataformaId") REFERENCES "Plataforma"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Precio" ADD CONSTRAINT "Precio_paqueteId_fkey" FOREIGN KEY ("paqueteId") REFERENCES "Paquete"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Precio" ADD CONSTRAINT "Precio_duracionId_fkey" FOREIGN KEY ("duracionId") REFERENCES "Duracion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Precio" ADD CONSTRAINT "Precio_tipoClienteId_fkey" FOREIGN KEY ("tipoClienteId") REFERENCES "TipoCliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_plataformaId_fkey" FOREIGN KEY ("plataformaId") REFERENCES "Plataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pantalla" ADD CONSTRAINT "Pantalla_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pantalla" ADD CONSTRAINT "Pantalla_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_anuladaPorId_fkey" FOREIGN KEY ("anuladaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_plataformaId_fkey" FOREIGN KEY ("plataformaId") REFERENCES "Plataforma"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_paqueteId_fkey" FOREIGN KEY ("paqueteId") REFERENCES "Paquete"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_duracionId_fkey" FOREIGN KEY ("duracionId") REFERENCES "Duracion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_tipoClienteId_fkey" FOREIGN KEY ("tipoClienteId") REFERENCES "TipoCliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaDetalle" ADD CONSTRAINT "VentaDetalle_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaDetalle" ADD CONSTRAINT "VentaDetalle_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaDetalle" ADD CONSTRAINT "VentaDetalle_pantallaId_fkey" FOREIGN KEY ("pantallaId") REFERENCES "Pantalla"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaDetalle" ADD CONSTRAINT "VentaDetalle_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaDetalle" ADD CONSTRAINT "VentaDetalle_plataformaId_fkey" FOREIGN KEY ("plataformaId") REFERENCES "Plataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaDetalle" ADD CONSTRAINT "VentaDetalle_duracionId_fkey" FOREIGN KEY ("duracionId") REFERENCES "Duracion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantillaMensaje" ADD CONSTRAINT "PlantillaMensaje_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
