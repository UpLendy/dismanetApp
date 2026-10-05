-- Migración de datos: una empresa creada desde la interfaz antes de este
-- cambio nació SIN plantillas de mensaje y SIN tipos de cliente (solo el seed
-- de DISMANET las traía), así que no podía vender ni registrar un precio.
-- Este script les crea lo que les falta. Es idempotente: no toca empresas que
-- ya tienen lo suyo, ni pisa plantillas que un admin ya editó.
--
-- El texto de las plantillas es el del anexo B del PRD y es copia exacta de
-- src/lib/plantillas-default.ts (una prueba verifica que no se desalineen).
-- Si se edita el texto por defecto en el código, esta migración NO se
-- modifica: las migraciones aplicadas son inmutables.

-- Plantillas faltantes, por tipo exacto (UNIDAD / PAQUETE).
INSERT INTO "PlantillaMensaje" ("id", "empresaId", "tipo", "contenido", "actualizadaEn")
SELECT
  'c' || substr(md5(random()::text || clock_timestamp()::text || e."id" || 'UNIDAD'), 1, 24),
  e."id",
  'UNIDAD'::"TipoPlantilla",
  $plantilla$♥️ *{{plataforma}} ({{duracion}})* ♥️

*fecha*
{{fechaEnLetras}}

*CODIGO DE COMPRA*
{{codigoCompra}}

*PERFIL:*
{{perfil}}

*PIN:*
{{pin}}

*CORREO:*
{{correo}}

*CONTRASEÑA:*
{{clave}}

*POLITICAS DE USO* 🫵
❌*NO* cambiar nombres
❌*NO* cambiar pines
❌*NO* usar más de 1 dispositivo

*IMPORTANTE* tenemos segundo numero para soporte

*INSTAGRAM* 👇
https://www.instagram.com/dismanet.col

*¿Quieres un perfume?*
*disma perfumes* te lo tiene
*catalogo:* https://vercatalogo.com/dismanet/products$plantilla$,
  CURRENT_TIMESTAMP
FROM "Empresa" e
WHERE NOT EXISTS (
  SELECT 1 FROM "PlantillaMensaje" p WHERE p."empresaId" = e."id" AND p."tipo" = 'UNIDAD'::"TipoPlantilla"
);

INSERT INTO "PlantillaMensaje" ("id", "empresaId", "tipo", "contenido", "actualizadaEn")
SELECT
  'c' || substr(md5(random()::text || clock_timestamp()::text || e."id" || 'PAQUETE'), 1, 24),
  e."id",
  'PAQUETE'::"TipoPlantilla",
  $plantilla$♥️ *{{paquete}} ({{duracion}})* ♥️

*fecha*
{{fechaEnLetras}}

*CODIGO DE COMPRA*
{{codigoCompra}}

{{listaCuentas}}

*POLITICAS DE USO* 🫵
❌*NO* cambiar nombres
❌*NO* cambiar pines
❌*NO* usar más de 1 dispositivo

*IMPORTANTE* tenemos segundo numero para soporte

*INSTAGRAM* 👇
https://www.instagram.com/dismanet.col

*¿Quieres un perfume?*
*disma perfumes* te lo tiene
*catalogo:* https://vercatalogo.com/dismanet/products$plantilla$,
  CURRENT_TIMESTAMP
FROM "Empresa" e
WHERE NOT EXISTS (
  SELECT 1 FROM "PlantillaMensaje" p WHERE p."empresaId" = e."id" AND p."tipo" = 'PAQUETE'::"TipoPlantilla"
);

-- Tipos de cliente por defecto, solo para empresas que no tienen NINGUNO
-- (una empresa que ya tiene alguno, aunque lo haya renombrado o desactivado,
-- ya configuró lo suyo y se deja intacta).
INSERT INTO "TipoCliente" ("id", "empresaId", "nombre", "activo")
SELECT
  'c' || substr(md5(random()::text || clock_timestamp()::text || e."id" || t."nombre"), 1, 24),
  e."id",
  t."nombre",
  true
FROM "Empresa" e
CROSS JOIN (VALUES ('Cliente normal'), ('Revendedor'), ('Promoción')) AS t("nombre")
WHERE NOT EXISTS (SELECT 1 FROM "TipoCliente" tc WHERE tc."empresaId" = e."id");
