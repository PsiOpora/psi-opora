CREATE TABLE "client_identity_links" (
	"id" text PRIMARY KEY NOT NULL,
	"messenger" text NOT NULL,
	"user_id" text NOT NULL,
	"primary_messenger" text NOT NULL,
	"primary_user_id" text NOT NULL,
	"merged_by_operator_id" text,
	"merged_by_operator_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "client_identity_links_primary_idx" ON "client_identity_links" USING btree ("primary_messenger","primary_user_id");