-- MOD-MEDIA-007: size_bytes debe ser bigint (>2GB en el futuro).
-- Ejecutar una vez en entornos existentes antes o después de db:push / migrate.
ALTER TABLE schema_media.media_assets
  ALTER COLUMN size_bytes TYPE bigint USING size_bytes::bigint;
