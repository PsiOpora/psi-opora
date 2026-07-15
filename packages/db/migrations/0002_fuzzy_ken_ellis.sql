CREATE TABLE "broadcast_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"broadcast_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"contact_name" text,
	"deal_id" text,
	"deal_title" text,
	"messenger" text,
	"messenger_user_id" text,
	"status" text NOT NULL,
	"error" text,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" text PRIMARY KEY NOT NULL,
	"stage_id" text NOT NULL,
	"stage_name" text,
	"channel" text NOT NULL,
	"message" text NOT NULL,
	"status" text NOT NULL,
	"total_deals" integer,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now(),
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_recipients_broadcast_idx" ON "broadcast_recipients" USING btree ("broadcast_id");