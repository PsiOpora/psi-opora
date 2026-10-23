CREATE TABLE "yandex_metrika_messenger_visitors" (
	"messenger" text NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text,
	"yclid" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "yandex_metrika_messenger_visitors_messenger_user_id_pk" PRIMARY KEY("messenger","user_id")
);
