import { db } from "../client";
import { postboxSettings } from "../schema/postbox";

export type PostboxSettings = typeof postboxSettings.$inferSelect;

export async function getPostboxSettings(): Promise<PostboxSettings | null> {
	if (!db) return null;
	const rows = await db.select().from(postboxSettings).limit(1);
	return rows[0] ?? null;
}

export async function upsertPostboxSettings(data: {
	apiKey?: string | null;
	keyId?: string | null;
	senderEmail?: string | null;
	senderName?: string | null;
}): Promise<void> {
	if (!db) return;
	await db
		.insert(postboxSettings)
		.values({ id: "singleton", ...data })
		.onConflictDoUpdate({
			target: postboxSettings.id,
			set: { ...data, updatedAt: new Date() },
		});
}
