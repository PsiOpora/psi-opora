ALTER TABLE "bot_messages" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "bot_messages_updated_idx" ON "bot_messages" USING btree ("messenger","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "bot_messages_external_idx" ON "bot_messages" USING btree ("external_id");