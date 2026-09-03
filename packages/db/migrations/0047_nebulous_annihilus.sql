CREATE TABLE "yandex_metrika_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"counter_id" text,
	"oauth_token" text,
	"goal_id" text DEFAULT 'consultation_booked',
	"bitrix_client_id_field" text,
	"updated_at" timestamp DEFAULT now()
);
