-- Evita nombres duplicados entre entidades de catálogo ACTIVAS de una misma
-- empresa (ej. dos Plataforma "Netflix" en la misma empresa). Prisma no
-- expresa índices únicos parciales en su DSL de esquema, así que esta
-- migración es manual.
--
-- El índice es PARCIAL (WHERE activa/activo = true) a propósito: R3 exige
-- que las entidades de catálogo se desactiven, nunca se borren. Si el índice
-- fuera único sobre toda la tabla, desactivar "Netflix" y luego crear una
-- Plataforma nueva también llamada "Netflix" fallaría por colisión con la
-- fila desactivada — un índice parcial permite reutilizar el nombre mientras
-- la fila anterior sigue existiendo solo con fines históricos.
CREATE UNIQUE INDEX "plataforma_empresaId_nombre_activa_key"
  ON "Plataforma" ("empresaId", "nombre")
  WHERE "activa" = true;

CREATE UNIQUE INDEX "duracion_empresaId_nombre_activa_key"
  ON "Duracion" ("empresaId", "nombre")
  WHERE "activa" = true;

CREATE UNIQUE INDEX "tipoCliente_empresaId_nombre_activo_key"
  ON "TipoCliente" ("empresaId", "nombre")
  WHERE "activo" = true;

CREATE UNIQUE INDEX "paquete_empresaId_nombre_activo_key"
  ON "Paquete" ("empresaId", "nombre")
  WHERE "activo" = true;
