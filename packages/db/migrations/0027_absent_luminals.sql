CREATE TABLE "max_personal_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"open_line_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"phone" text NOT NULL,
	"session_encrypted" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "max_personal_accounts_member_line_idx" UNIQUE("member_id","open_line_id","connector_id")
);
--> statement-breakpoint
CREATE INDEX "max_personal_accounts_member_idx" ON "max_personal_accounts" USING btree ("member_id");