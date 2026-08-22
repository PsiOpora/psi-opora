CREATE TABLE "deal_dictionaries" (
	"type" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp DEFAULT now(),
	CONSTRAINT "deal_dictionaries_type_id_pk" PRIMARY KEY("type","id")
);
