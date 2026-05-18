import { Client } from "pg";
import { env } from "../config/env";

const client = new Client({ connectionString: env.DATABASE_URL });

try {
  await client.connect();
  await client.query('CREATE SCHEMA IF NOT EXISTS "schema_media"');
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'schema_media'
          AND t.typname = 'media_kind'
      ) THEN
        CREATE TYPE "schema_media"."media_kind" AS ENUM ('avatar', 'document');
      END IF;
    END
    $$;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "schema_media"."media_assets" (
      "id" uuid PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "kind" "schema_media"."media_kind" NOT NULL,
      "avatar_version" integer,
      "width" integer,
      "bucket" text NOT NULL,
      "object_key" text NOT NULL,
      "original_name" text NOT NULL,
      "mime_type" text NOT NULL,
      "size_bytes" bigint NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_kind_version_width"
    ON "schema_media"."media_assets" ("user_id", "kind", "avatar_version", "width");
  `);
} finally {
  await client.end();
}
