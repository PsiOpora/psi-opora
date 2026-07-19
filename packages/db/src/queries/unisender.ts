import { db } from "../client";
import { unisenderSettings } from "../schema/unisender";

export type UnisenderSettings = typeof unisenderSettings.$inferSelect;

export async function getUnisenderSettings(): Promise<UnisenderSettings | null> {
  if (!db) return null;
  const rows = await db.select().from(unisenderSettings).limit(1);
  return rows[0] ?? null;
}

export async function upsertUnisenderSettings(data: {
  apiKey?: string | null;
  senderEmail?: string | null;
  senderName?: string | null;
}): Promise<void> {
  if (!db) return;
  await db
    .insert(unisenderSettings)
    .values({ id: "singleton", ...data })
    .onConflictDoUpdate({
      target: unisenderSettings.id,
      set: { ...data, updatedAt: new Date() },
    });
}
