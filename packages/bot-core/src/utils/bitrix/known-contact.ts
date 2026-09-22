import { getBitrixCrmLink } from "@psi-opora/db/queries";
import { bitrixPost } from "./client";
import { resolveOpenLineDialog } from "./openline";

/** Контактные данные, уже сохранённые в Bitrix24 для этого клиента. */
export interface KnownBitrixContact {
	name?: string;
	phone?: string;
	email?: string;
}

function firstCommValue(value: unknown): string | undefined {
	if (!Array.isArray(value)) return undefined;
	const entry = value[0] as { VALUE?: unknown } | undefined;
	return typeof entry?.VALUE === "string" ? entry.VALUE : undefined;
}

function logLookupError(err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	console.error(`[bitrix] ошибка поиска известного контакта: ${message}`);
}

async function fetchKnownContact(
	messenger: string,
	contactId: number,
): Promise<KnownBitrixContact | null> {
	const contact = await bitrixPost<Record<string, unknown>>(
		"crm.contact.get",
		{ id: contactId },
		messenger,
	);
	if (!contact) return null;
	const name = typeof contact.NAME === "string" ? contact.NAME.trim() : "";
	const phone = firstCommValue(contact.PHONE);
	const email = firstCommValue(contact.EMAIL);
	if (!name && !phone && !email) return null;
	return { name: name || undefined, phone, email };
}

/**
 * Ищет клиента, уже известного в Bitrix24, по мессенджеру — до того, как
 * сценарий бота начнёт спрашивать имя/телефон/email (см. ветку consent_agree
 * в scenario/engine.ts): если контакт уже есть в CRM, найденные поля
 * подставляются в анкету вместо повторного вопроса.
 *
 * Источники, в порядке проверки:
 *  1. bitrix_crm_links — контакт, который бот уже создавал для этого
 *     messenger+userId раньше (самый частый случай — клиент пишет снова).
 *  2. Диалог Открытой линии (resolveOpenLineDialog) — контакт мог быть
 *     создан трекером линии или другим каналом того же чата ещё до того,
 *     как появилась запись в bitrix_crm_links.
 *
 * Поиск по телефону отдельно не делаем: на этом шаге бот ещё не знает
 * телефон клиента — иначе не пришлось бы его спрашивать.
 *
 * Ошибки Bitrix не пробрасываются — при сбое сценарий просто спросит данные
 * как обычно.
 */
export async function resolveKnownContact(params: {
	messenger: string;
	userId: number;
	chatId?: number;
}): Promise<KnownBitrixContact | null> {
	const { messenger, userId, chatId } = params;

	const link = await getBitrixCrmLink(messenger, String(userId)).catch(
		() => null,
	);
	if (link) {
		const known = await fetchKnownContact(
			messenger,
			Number(link.contactId),
		).catch((err: unknown) => {
			logLookupError(err);
			return null;
		});
		if (known) return known;
	}

	if (chatId) {
		const dialog = await resolveOpenLineDialog(messenger, userId, chatId);
		if (dialog?.contactId) {
			const known = await fetchKnownContact(messenger, dialog.contactId).catch(
				(err: unknown) => {
					logLookupError(err);
					return null;
				},
			);
			if (known) return known;
		}
	}

	return null;
}
