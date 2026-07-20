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
CREATE INDEX "bot_users_messenger_idx" ON "bot_users" USING btree ("messenger");