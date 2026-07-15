import { desc, eq } from "drizzle-orm";
import { db } from "../client";
import { broadcastRecipients, broadcasts } from "../schema/broadcast";

export type Broadcast = typeof broadcasts.$inferSelect;
export type BroadcastRecipientRow = typeof broadcastRecipients.$inferSelect;
export type NewBroadcastRecipient = typeof broadcastRecipients.$inferInsert;

export async function createBroadcast(data: {
  id: string;
  stageId: string;
  stageName?: string;
  channel: string;
  message: string;
}): Promise<void> {
  if (!db) return;
  await db.insert(broadcasts).values({ ...data, status: "running" });
}

export async function finishBroadcast(
  id: string,
  data: {
    status: "done" | "error";
    totalDeals?: number;
    sentCount?: number;
    skippedCount?: number;
    failedCount?: number;
    error?: string;
  },
): Promise<void> {
  if (!db) return;
  await db
    .update(broadcasts)
    .set({ ...data, finishedAt: new Date() })
    .where(eq(broadcasts.id, id));
}

export async function insertBroadcastRecipients(
  rows: NewBroadcastRecipient[],
): Promise<void> {
  if (!db || rows.length === 0) return;
  await db.insert(broadcastRecipients).values(rows);
}

export async function listBroadcasts(limit = 30): Promise<Broadcast[]> {
  if (!db) return [];
  return db
    .select()
    .from(broadcasts)
    .orderBy(desc(broadcasts.startedAt))
    .limit(limit);
}

export async function getBroadcast(id: string): Promise<Broadcast | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(broadcasts)
    .where(eq(broadcasts.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listBroadcastRecipients(
  broadcastId: string,
): Promise<BroadcastRecipientRow[]> {
  if (!db) return [];
  return db
    .select()
    .from(broadcastRecipients)
    .where(eq(broadcastRecipients.broadcastId, broadcastId))
    .orderBy(broadcastRecipients.contactName);
}
