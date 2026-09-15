CREATE TABLE "whatsapp_personal_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"open_line_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"phone" text NOT NULL,
	"session_name" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_personal_accounts_member_line_idx" UNIQUE("member_id","open_line_id"),
	CONSTRAINT "whatsapp_personal_accounts_session_idx" UNIQUE("session_name")
);
--> statement-breakpoint
CREATE INDEX "whatsapp_personal_accounts_member_idx" ON "whatsapp_personal_accounts" USING btree ("member_id");