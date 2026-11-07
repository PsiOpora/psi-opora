CREATE TABLE "scheduled_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text,
	"kind" text NOT NULL,
	"messenger" text NOT NULL,
	"user_id" text,
	"entity" text,
	"entity_id" text,
	"line_id" text,
	"connector_id" text,
	"text" text NOT NULL,
	"attachment" jsonb,
	"operator_id" text,
	"operator_name" text,
	"send_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "scheduled_messages_due_idx" ON "scheduled_messages" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "scheduled_messages_dialog_idx" ON "scheduled_messages" USING btree ("messenger","user_id","status");--> statement-breakpoint
CREATE INDEX "scheduled_messages_entity_idx" ON "scheduled_messages" USING btree ("entity","entity_id","status");