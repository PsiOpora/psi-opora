CREATE TABLE "client_merge_dismissals" (
	"id" text PRIMARY KEY NOT NULL,
	"key_a" text NOT NULL,
	"key_b" text NOT NULL,
	"dismissed_by_operator_id" text,
	"dismissed_by_operator_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "client_merge_dismissals_key_a_idx" ON "client_merge_dismissals" USING btree ("key_a");--> statement-breakpoint
CREATE INDEX "client_merge_dismissals_key_b_idx" ON "client_merge_dismissals" USING btree ("key_b");