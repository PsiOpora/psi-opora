import { db } from "../client";
import { yandexMetrikaSettings } from "../schema/yandex-metrika";

export type YandexMetrikaSettings = typeof yandexMetrikaSettings.$inferSelect;

export async function getYandexMetrikaSettings(): Promise<YandexMetrikaSettings | null> {
	if (!db) return null;
	const rows = await db.select().from(yandexMetrikaSettings).limit(1);
	return rows[0] ?? null;
}

export async function upsertYandexMetrikaSettings(data: {
	counterId?: string | null;
	oauthToken?: string | null;
	goalId?: string | null;
	bitrixClientIdField?: string | null;
}): Promise<void> {
	if (!db) return;
	await db
		.insert(yandexMetrikaSettings)
		.values({ id: "singleton", ...data })
		.onConflictDoUpdate({ target: yandexMetrikaSettings.id, set: data });
}
