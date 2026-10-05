-- Precio sirve tanto para plataformas individuales como para paquetes.
-- plataformaId y paqueteId son ambos nullable en el esquema de Prisma porque
-- Prisma no expresa CHECK arbitrarios; esta migración manual asegura que
-- exactamente uno de los dos esté presente en cada fila.
ALTER TABLE "Precio"
  ADD CONSTRAINT "precio_plataforma_xor_paquete"
  CHECK (("plataformaId" IS NULL) <> ("paqueteId" IS NULL));
