CREATE TABLE "bot_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"messenger" text NOT NULL,
	"user_id" text NOT NULL,
	"assigned_operator_id" text,
	"assigned_operator_name" text,
	"last_read_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_messages" ADD COLUMN "operator_id" text;--> statement-breakpoint
CREATE INDEX "bot_conversations_messenger_idx" ON "bot_conversations" USING btree ("messenger");