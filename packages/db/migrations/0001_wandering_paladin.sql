CREATE TABLE "backup_credentials" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"s3_endpoint" text,
	"s3_region" text DEFAULT 'ru-central1',
	"s3_bucket" text,
	"s3_access_key_id" text,
	"s3_secret_access_key" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"entities" jsonb,
	"object_key" text,
	"size_bytes" integer,
	"error" text,
	"started_at" timestamp DEFAULT now(),
	"finished_at" timestamp
);
