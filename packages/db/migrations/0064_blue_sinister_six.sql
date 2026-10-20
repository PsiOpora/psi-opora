CREATE TABLE "postbox_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"api_key" text,
	"key_id" text,
	"sender_email" text,
	"sender_name" text,
	"updated_at" timestamp DEFAULT now()
);
