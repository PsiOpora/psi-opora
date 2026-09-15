import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const backupCredentials = pgTable("backup_credentials", {
	id: text("id").primaryKey().default("singleton"),
	s3Endpoint: text("s3_endpoint"),
	s3Region: text("s3_region").default("ru-central1"),
	s3Bucket: text("s3_bucket"),
	s3AccessKeyId: text("s3_access_key_id"),
	s3SecretAccessKey: text("s3_secret_access_key"),
	updatedAt: timestamp("updated_at").defaultNow(),
});

export const backupRuns = pgTable("backup_runs", {
	id: text("id").primaryKey(),
	status: text("status").notNull(), // running | success | error
	objectKey: text("object_key"), // legacy: путь к единому файлу (старый формат)
	manifestKey: text("manifest_key"), // путь к manifest.json нового формата
	prefix: text("prefix"), // префикс папки бэкапа в S3
	entities: jsonb("entities"), // Record<string, BackupEntityResult>
	totalBytes: integer("total_bytes"),
	errors: jsonb("errors"), // Array<{ entity: string; error: string }>
	error: text("error"), // фатальная ошибка запуска
	entitiesTotal: integer("entities_total"), // сколько сущностей будет выгружено
	entitiesDone: integer("entities_done"), // сколько уже выгружено
	currentEntity: text("current_entity"), // какая сущность выгружается сейчас
	startedAt: timestamp("started_at").defaultNow(),
	finishedAt: timestamp("finished_at"),
});
