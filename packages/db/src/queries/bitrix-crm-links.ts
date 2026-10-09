import { and, eq, inArray, sql } from "drizzle-orm";
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
		portalKey: string;
		messenger: string;
		userId: string;
		contactId: string;
		dealId?: string;
	},
): Promise<void> {
	if (!entry.portalKey.trim()) throw new Error("Missing Bitrix portal key");
	if (!db) return;
	const id = makeId(entry.messenger, entry.userId);
	await db
		.insert(bitrixCrmLinks)
		.values({
			id,
			portalKey: entry.portalKey,
			messenger: entry.messenger,
			userId: entry.userId,
			contactId: entry.contactId,
			dealId: entry.dealId,
		})
		.onConflictDoUpdate({
			target: bitrixCrmLinks.id,
			set: {
				portalKey: entry.portalKey,
				contactId: entry.contactId,
				// Ранняя фиксация контакта (например, после email) не должна
				// стирать уже привязанную сделку в том же портале.
				// При смене/уточнении портала старый ID сделки недостоверен.
				dealId:
					entry.dealId !== undefined
						? entry.dealId
						: sql`case when ${bitrixCrmLinks.portalKey} = ${entry.portalKey} then ${bitrixCrmLinks.dealId} else null end`,
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

/** Диалоги, привязанные к любому из контактов Bitrix — для поиска дублей клиента. */
export async function listBitrixCrmLinksByContactIds(
	db: Database,
	portalKey: string,
	contactIds: string[],
): Promise<BitrixCrmLink[]> {
	if (!db || !portalKey || contactIds.length === 0) return [];
	return db
		.select()
		.from(bitrixCrmLinks)
		.where(
			and(
				eq(bitrixCrmLinks.portalKey, portalKey),
				inArray(bitrixCrmLinks.contactId, contactIds),
			),
		);
}
