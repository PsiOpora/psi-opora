CREATE TABLE "client_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"messenger" text NOT NULL,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"operator_id" text,
	"operator_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_conversations" ADD COLUMN "tags" jsonb;--> statement-breakpoint
CREATE INDEX "client_notes_dialog_idx" ON "client_notes" USING btree ("messenger","user_id","created_at");