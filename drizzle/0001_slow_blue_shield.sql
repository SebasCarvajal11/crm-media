CREATE TABLE "schema_media"."file_reputation" (
	"sha256" varchar(64) PRIMARY KEY NOT NULL,
	"status" varchar(20) NOT NULL,
	"virus_name" text,
	"size_bytes" bigint,
	"mime_type" text,
	"scanned_by" varchar(50) DEFAULT 'clamav' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
