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
  entities: jsonb("entities").$type<Record<string, number>>(),
  objectKey: text("object_key"),
  sizeBytes: integer("size_bytes"),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
});
