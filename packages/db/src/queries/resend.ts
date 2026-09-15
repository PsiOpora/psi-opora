import { db } from "../client";
import { resendSettings } from "../schema/resend";

export type ResendSettings = typeof resendSettings.$inferSelect;

export async function getResendSettings(): Promise<ResendSettings | null> {
	if (!db) return null;
	const rows = await db.select().from(resendSettings).limit(1);
	return rows[0] ?? null;
}

export async function upsertResendSettings(data: {
	apiKey?: string | null;
	senderEmail?: string | null;
	senderName?: string | null;
}): Promise<void> {
	if (!db) return;
	await db
		.insert(resendSettings)
		.values({ id: "singleton", ...data })
		.onConflictDoUpdate({
			target: resendSettings.id,
			set: { ...data, updatedAt: new Date() },
		});
}
