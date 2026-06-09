import { Client } from "pg";
import { env } from "../config/env";
import { pgConnectionConfig } from "../db/pg-config";
import { ensureAuditLogPartitions } from "../db/scripts/ensure-audit-log-partitions";

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
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${dbSchema}"."audit_logs" (
      "id" bigserial NOT NULL,
      "actor_sub" uuid,
      "actor_email" varchar(255),
      "actor_role" varchar(20),
      "action" varchar(120) NOT NULL,
      "resource_type" varchar(80) NOT NULL,
      "resource_id" varchar(255),
      "ip_address" varchar(45),
      "user_agent" varchar(500),
      "correlation_id" uuid,
      "details" jsonb,
      "created_at" timestamp DEFAULT now() NOT NULL,
      PRIMARY KEY ("id", "created_at")
    ) PARTITION BY RANGE (created_at);
  `);
  await ensureAuditLogPartitions(client as any);
} finally {
  await client.end();
}
