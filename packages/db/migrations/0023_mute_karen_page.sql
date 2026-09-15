ALTER TABLE "bot_messages" ADD COLUMN "bitrix_message_id" integer;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD COLUMN "bitrix_external_id" text;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD COLUMN "deleted_by_operator_id" text;