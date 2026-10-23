ALTER TABLE "yandex_metrika_deal_visitors" ADD COLUMN "visits_summary_status" text;--> statement-breakpoint
ALTER TABLE "yandex_metrika_deal_visitors" ADD COLUMN "visits_summarized_at" timestamp;--> statement-breakpoint
ALTER TABLE "yandex_metrika_settings" ADD COLUMN "bitrix_visit_deal_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;