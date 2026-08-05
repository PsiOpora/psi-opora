import { db } from "../client";
import { rusenderSettings } from "../schema/rusender";

export type RusenderSettings = typeof rusenderSettings.$inferSelect;

export async function getRusenderSettings(): Promise<RusenderSettings | null> {
  if (!db) return null;
  const rows = await db.select().from(rusenderSettings).limit(1);
  return rows[0] ?? null;
}

export async function upsertRusenderSettings(data: {
  apiKey?: string | null;
  keyId?: string | null;
  senderEmail?: string | null;
  senderName?: string | null;
}): Promise<void> {
  if (!db) return;
  await db
    .insert(rusenderSettings)
    .values({ id: "singleton", ...data })
    .onConflictDoUpdate({
      target: rusenderSettings.id,
      set: { ...data, updatedAt: new Date() },
    });
}
