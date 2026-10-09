CREATE TABLE "yandex_metrika_deal_visitors" (
	"deal_id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"yclid" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yandex_metrika_goal_events" (
	"stage_goal_id" text NOT NULL,
	"deal_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "yandex_metrika_goal_events_stage_goal_id_deal_id_pk" PRIMARY KEY("stage_goal_id","deal_id")
);
--> statement-breakpoint
CREATE TABLE "yandex_metrika_stage_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"goal_id" text NOT NULL,
	"category_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "yandex_metrika_stage_goals_stage_goal_uq" UNIQUE("stage_id","goal_id")
);
--> statement-breakpoint
ALTER TABLE "yandex_metrika_goal_events" ADD CONSTRAINT "yandex_metrika_goal_events_stage_goal_id_yandex_metrika_stage_goals_id_fk" FOREIGN KEY ("stage_goal_id") REFERENCES "public"."yandex_metrika_stage_goals"("id") ON DELETE cascade ON UPDATE no action;