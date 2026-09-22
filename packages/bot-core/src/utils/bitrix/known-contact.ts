import { getBitrixCrmLink } from "@psi-opora/db/queries";
import { z } from "zod";
import { isValidEmail, parsePhoneNumber } from "../validation";
import { bitrixPost } from "./client";
import { resolveOpenLineDialog } from "./openline";

/** Контактные данные, уже сохранённые в Bitrix24 для этого клиента. */
export interface KnownBitrixContact {
	name?: string;
	phone?: string;
	email?: string;
}

const firstCommValueSchema = z
	.array(z.object({ VALUE: z.string() }).passthrough())
	.transform((values) => values[0]?.VALUE)
	.pipe(z.string());

const phoneSchema = firstCommValueSchema
	.transform((value) => parsePhoneNumber(value))
	.pipe(z.string());

const emailSchema = firstCommValueSchema
	.transform((value) => value.trim())
	.refine(isValidEmail);

const BitrixContactSchema = z.object({
	NAME: z.string().trim().min(1).optional().catch(undefined),
	PHONE: phoneSchema.optional().catch(undefined),
	EMAIL: emailSchema.optional().catch(undefined),
});

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
	const parsed = BitrixContactSchema.safeParse(contact);
	if (!parsed.success) return null;
	const { NAME: name, PHONE: phone, EMAIL: email } = parsed.data;
	if (!name && !phone && !email) return null;
	return { name, phone, email };
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
		const dialog = await resolveOpenLineDialog(messenger, userId, chatId).catch(
			(err: unknown) => {
				logLookupError(err);
				return null;
			},
		);
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
