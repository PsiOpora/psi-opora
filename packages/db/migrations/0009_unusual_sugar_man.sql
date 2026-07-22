CREATE TABLE "bot_connectors" (
	"messenger" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"open_line_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"webhook_configured_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_users" (
	"id" text PRIMARY KEY NOT NULL,
	"messenger" text NOT NULL,
	"user_id" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"name" text,
	"username" text,
	"language_code" text,
	"is_premium" boolean,
	"is_bot" boolean,
	"bio" text,
	"avatar_url" text,
	"photo_file_id" text,
	"source" text,
	"campaign" text,
	"raw_profile" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_personal_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"open_line_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"phone" text NOT NULL,
	"api_id" text NOT NULL,
	"api_hash_encrypted" text NOT NULL,
	"session_encrypted" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_personal_accounts_member_line_idx" UNIQUE("member_id","open_line_id")
);
--> statement-breakpoint
CREATE INDEX "bot_users_messenger_idx" ON "bot_users" USING btree ("messenger");--> statement-breakpoint
CREATE INDEX "telegram_personal_accounts_member_idx" ON "telegram_personal_accounts" USING btree ("member_id");