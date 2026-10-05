CREATE SCHEMA "schema_media";
--> statement-breakpoint
CREATE TYPE "schema_media"."media_kind" AS ENUM('avatar', 'document');--> statement-breakpoint
CREATE TABLE "schema_media"."audit_logs" (
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
	CONSTRAINT "audit_logs_id_created_at_pk" PRIMARY KEY("id","created_at")
);
--> statement-breakpoint
CREATE TABLE "schema_media"."media_assets" (
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
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_kind_version_width" ON "schema_media"."media_assets" USING btree ("user_id","kind","avatar_version","width");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_media_assets_object_key" ON "schema_media"."media_assets" USING btree ("object_key");