import { and, eq } from "drizzle-orm";
import type { Database } from "../client.types";
import { bitrixCrmLinks } from "../schema/bitrix-crm-links";

export type BitrixCrmLink = typeof bitrixCrmLinks.$inferSelect;

function makeId(messenger: string, userId: string): string {
	return `${messenger}:${userId}`;
}

/** Запоминает контакт/сделку Bitrix, которые бот создал для этого диалога. */
export async function upsertBitrixCrmLink(
	db: Database,
	entry: {
		messenger: string;
		userId: string;
		contactId: string;
		dealId?: string;
	},
): Promise<void> {
	if (!db) return;
	const id = makeId(entry.messenger, entry.userId);
	await db
		.insert(bitrixCrmLinks)
		.values({
			id,
			messenger: entry.messenger,
			userId: entry.userId,
			contactId: entry.contactId,
			dealId: entry.dealId,
		})
		.onConflictDoUpdate({
			target: bitrixCrmLinks.id,
			set: {
				contactId: entry.contactId,
				// Ранняя фиксация контакта (например, после email) не должна
				// стирать уже привязанную сделку.
				...(entry.dealId !== undefined ? { dealId: entry.dealId } : {}),
				updatedAt: new Date(),
			},
		});
}

export async function getBitrixCrmLink(
	db: Database,
	messenger: string,
	userId: string,
): Promise<BitrixCrmLink | null> {
	if (!db) return null;
	const [row] = await db
		.select()
		.from(bitrixCrmLinks)
		.where(
			and(
				eq(bitrixCrmLinks.messenger, messenger),
				eq(bitrixCrmLinks.userId, userId),
			),
		)
		.limit(1);
	return row ?? null;
}
