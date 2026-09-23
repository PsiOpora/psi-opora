ALTER TABLE "yandex_metrika_settings" ALTER COLUMN "goal_id" SET DEFAULT 'free_consultation_booked';--> statement-breakpoint
ALTER TABLE "ad_credentials" ADD COLUMN "yandex_client_login" text;