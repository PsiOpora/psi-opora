import { desc, eq } from "drizzle-orm";
import { db } from "../client";
import { backupCredentials, backupRuns } from "../schema/backup";

export type BackupCredentials = typeof backupCredentials.$inferSelect;
export type BackupRun = typeof backupRuns.$inferSelect;
export type NewBackupRun = typeof backupRuns.$inferInsert;

// ── Credentials ────────────────────────────────────────────────────────────

export async function getBackupCredentials(): Promise<BackupCredentials | null> {
  if (!db) return null;
  const rows = await db.select().from(backupCredentials).limit(1);
  return rows[0] ?? null;
}

export async function upsertBackupCredentials(data: {
  s3Endpoint?: string | null;
  s3Region?: string | null;
  s3Bucket?: string | null;
  s3AccessKeyId?: string | null;
  s3SecretAccessKey?: string | null;
}): Promise<void> {
  if (!db) return;
  await db
    .insert(backupCredentials)
    .values({ id: "singleton", ...data })
    .onConflictDoUpdate({
      target: backupCredentials.id,
      set: { ...data, updatedAt: new Date() },
    });
}

// ── Runs ─────────────────────────────────────────────────────────────────

export async function createBackupRun(id: string): Promise<void> {
  if (!db) return;
  await db.insert(backupRuns).values({ id, status: "running" });
}

export interface BackupEntityResult {
  name: string;
  file: string;
  method: string;
  count: number;
  sizeBytes: number;
  durationMs: number;
  error?: string;
}

export interface BackupRunError {
  entity: string;
  error: string;
}

export async function finishBackupRun(
  id: string,
  data: {
    status: "success" | "error";
    manifestKey?: string;
    prefix?: string;
    entities?: Record<string, BackupEntityResult>;
    totalBytes?: number;
    errors?: BackupRunError[];
    objectKey?: string;
    sizeBytes?: number;
    error?: string;
  },
): Promise<void> {
  if (!db) return;
  await db
    .update(backupRuns)
    .set({
      ...data,
      objectKey: data.manifestKey ?? data.objectKey,
      finishedAt: new Date(),
    })
    .where(eq(backupRuns.id, id));
}

export async function listBackupRuns(limit = 20): Promise<BackupRun[]> {
  if (!db) return [];
  return db
    .select()
    .from(backupRuns)
    .orderBy(desc(backupRuns.startedAt))
    .limit(limit);
}
