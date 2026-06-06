import { Client } from "pg";
import { env } from "../config/env";
import { pgConnectionConfig } from "../db/pg-config";

const client = new Client(pgConnectionConfig);
const dbSchema = env.DB_SCHEMA;

try {
  await client.connect();
  const schemaResult = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists",
    [dbSchema],
  );
  if (!schemaResult.rows[0]?.exists) {
    throw new Error(
      `El esquema ${dbSchema} no existe. Provisiona los esquemas desde crm-infra antes de ejecutar crm-media db:push.`,
    );
  }
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = '${dbSchema}'
          AND t.typname = 'media_kind'
      ) THEN
        CREATE TYPE "${dbSchema}"."media_kind" AS ENUM ('avatar', 'document');
      END IF;
    END
    $$;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${dbSchema}"."media_assets" (
      "id" uuid PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "kind" "${dbSchema}"."media_kind" NOT NULL,
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
    ON "${dbSchema}"."media_assets" ("user_id", "kind", "avatar_version", "width");
  `);
} finally {
  await client.end();
}
