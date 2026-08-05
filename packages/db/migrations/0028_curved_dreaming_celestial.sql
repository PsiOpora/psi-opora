CREATE TABLE "email_provider_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"provider" text DEFAULT 'rusender' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rusender_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"api_key" text,
	"key_id" text,
	"sender_email" text,
	"sender_name" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD COLUMN "provider" text DEFAULT 'unisender' NOT NULL;