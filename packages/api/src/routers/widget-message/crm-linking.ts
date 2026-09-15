import { upsertBitrixCrmLink } from "@psi-opora/db/queries";

export interface WidgetCrmLink {
	messenger: string;
	userId: string;
	contactId: string;
	canonicalTelegramUserId?: string;
}

type UpsertCrmLink = typeof upsertBitrixCrmLink;

/**
 * Сохраняет исходный адрес канала (телефон/username/ID) и, если воркер
 * Telegram Personal смог его определить, канонический Telegram user ID.
 */
export async function persistWidgetCrmLinks(
	link: WidgetCrmLink,
	upsert: UpsertCrmLink = upsertBitrixCrmLink,
): Promise<void> {
	const userIds = new Set([
		link.userId,
		...(link.messenger === "telegram-personal" && link.canonicalTelegramUserId
			? [link.canonicalTelegramUserId]
			: []),
	]);
	await Promise.all(
		[...userIds].map((userId) =>
			upsert({
				messenger: link.messenger,
				userId,
				contactId: link.contactId,
			}),
		),
	);
}
