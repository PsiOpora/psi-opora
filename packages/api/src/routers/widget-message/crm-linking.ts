import { upsertBitrixCrmLink } from "@psi-opora/db/queries";

export interface WidgetCrmLink {
	portalKey: string;
	messenger: string;
	userId: string;
	contactId: string;
	canonicalTelegramUserId?: string;
	/** ID личного чата MAX, который воркер вычислил по телефону. */
	canonicalMaxChatId?: string;
}

type UpsertCrmLink = typeof upsertBitrixCrmLink;

/**
 * Сохраняет исходный адрес канала (телефон/username/ID) и, если воркер
 * Telegram/MAX Personal смог его определить, канонический Telegram user ID /
 * ID личного чата MAX.
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
		...(link.messenger === "max-personal" && link.canonicalMaxChatId
			? [link.canonicalMaxChatId]
			: []),
	]);
	await Promise.all(
		[...userIds].map((userId) =>
			upsert({
				portalKey: link.portalKey,
				messenger: link.messenger,
				userId,
				contactId: link.contactId,
			}),
		),
	);
}
