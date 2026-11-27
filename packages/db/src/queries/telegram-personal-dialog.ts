import type { Database } from "../client.types";
import {
	getBitrixCrmLink,
	listBitrixCrmLinksByContactIds,
} from "./bitrix-crm-links";
import { listBotMessages } from "./bot-messages";

/**
 * Локальный ключ диалога для личного Telegram. Первое сообщение часто
 * отправляется по телефону или username, а MTProto-апдейты и Открытая линия
 * оперируют canonical user ID собеседника. Если оба ключа уже привязаны к
 * одному CRM-контакту и под старым ключом есть переписка этого же
 * номера-коннектора, продолжаем писать в старый диалог — иначе ответы
 * попадали бы в новый thread с числовым ID и не отображались в уже открытом
 * диалоге.
 */
export async function resolveTelegramPersonalDialogUserId(
	db: Database,
	canonicalUserId: string,
	connectorId: string,
): Promise<string> {
	try {
		const canonicalLink = await getBitrixCrmLink(
			db,
			"telegram-personal",
			canonicalUserId,
		);
		if (!canonicalLink?.portalKey) return canonicalUserId;

		const links = await listBitrixCrmLinksByContactIds(
			db,
			canonicalLink.portalKey,
			[canonicalLink.contactId],
		);
		const candidates = links
			.filter(
				(link) =>
					link.messenger === "telegram-personal" &&
					link.userId !== canonicalUserId,
			)
			.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

		let best: { userId: string; lastMessageAt: number } | null = null;
		for (const candidate of candidates) {
			const [existing] = await listBotMessages(
				db,
				"telegram-personal",
				candidate.userId,
				1,
				connectorId,
			);
			if (
				existing &&
				(!best || existing.createdAt.getTime() > best.lastMessageAt)
			) {
				best = {
					userId: candidate.userId,
					lastMessageAt: existing.createdAt.getTime(),
				};
			}
		}
		if (best) return best.userId;
	} catch (error) {
		console.error(
			`[telegram-personal-dialog] не удалось сопоставить ключ диалога ${canonicalUserId}: ${(error as Error).message}`,
		);
	}
	return canonicalUserId;
}
