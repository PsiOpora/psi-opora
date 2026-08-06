CREATE TABLE "smtp_bz_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"api_key" text,
	"sender_email" text,
	"sender_name" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "resend_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"api_key" text,
	"sender_email" text,
	"sender_name" text,
	"updated_at" timestamp DEFAULT now()
);
