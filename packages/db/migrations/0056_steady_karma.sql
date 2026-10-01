ALTER TABLE "bot_conversations" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "bot_conversations" ADD COLUMN "deleted_by_operator_id" text;