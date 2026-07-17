CREATE TABLE "bot_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"messenger" text NOT NULL,
	"user_id" text NOT NULL,
	"direction" text NOT NULL,
	"source" text DEFAULT 'scenario' NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_messages_user_idx" ON "bot_messages" USING btree ("messenger","user_id","created_at");
