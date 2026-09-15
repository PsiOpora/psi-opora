ALTER TABLE "bot_messages" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD COLUMN "media_s3_key" text;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD COLUMN "media_mime_type" text;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD COLUMN "media_duration_sec" integer;