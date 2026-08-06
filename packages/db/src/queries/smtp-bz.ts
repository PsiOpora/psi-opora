import { db } from "../client";
import { smtpBzSettings } from "../schema/smtp-bz";

export type SmtpBzSettings = typeof smtpBzSettings.$inferSelect;

export async function getSmtpBzSettings(): Promise<SmtpBzSettings | null> {
  if (!db) return null;
  const rows = await db.select().from(smtpBzSettings).limit(1);
  return rows[0] ?? null;
}

export async function upsertSmtpBzSettings(data: {
  apiKey?: string | null;
  senderEmail?: string | null;
  senderName?: string | null;
}): Promise<void> {
  if (!db) return;
  await db
    .insert(smtpBzSettings)
    .values({ id: "singleton", ...data })
    .onConflictDoUpdate({
      target: smtpBzSettings.id,
      set: { ...data, updatedAt: new Date() },
    });
}
