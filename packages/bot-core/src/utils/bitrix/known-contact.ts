import { getBitrixCrmLink } from "@psi-opora/db/queries";
import { z } from "zod";
import { isValidEmail, parsePhoneNumber } from "../validation";
import { bitrixPost } from "./client";
import {
	CONSENT_PDN_DATE_FIELD,
	CONSENT_PDN_FLAG_FIELD,
} from "./consent-fields";
import { resolveOpenLineDialog } from "./openline";

/** Контактные данные, уже сохранённые в Bitrix24 для этого клиента. */
export interface KnownBitrixContact {
	name?: string;
	phone?: string;
	email?: string;
	/** В карточке контакта уже отмечено согласие на обработку ПДн (флаг или
	 * дата согласия) — сценарий не показывает экран согласия повторно. */
	consentGranted?: boolean;
	/** Дата согласия из карточки (ISO), если она там заполнена. */
	consentAt?: string;
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

// Пользовательское поле-флажок Bitrix отдаёт как "1"/"0" (в некоторых
// ответах — числом/boolean/"Y"); всё остальное считаем «не отмечено».
const consentFlagSchema = z
	.union([z.literal("1"), z.literal(1), z.literal(true), z.literal("Y")])
	.transform(() => true as const);

// Дата-время согласия: Bitrix отдаёт ISO со смещением ("…+03:00") либо
// пустую строку, если поле не заполнено.
const consentDateSchema = z
	.string()
	.transform((value) => {
		const date = new Date(value);
		return value.trim() && !Number.isNaN(date.getTime())
			? date.toISOString()
			: undefined;
	})
	.pipe(z.string());

const BitrixContactSchema = z.object({
	NAME: z.string().trim().min(1).optional().catch(undefined),
	PHONE: phoneSchema.optional().catch(undefined),
	EMAIL: emailSchema.optional().catch(undefined),
	[CONSENT_PDN_FLAG_FIELD]: consentFlagSchema.optional().catch(undefined),
	[CONSENT_PDN_DATE_FIELD]: consentDateSchema.optional().catch(undefined),
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
	const consentAt = parsed.data[CONSENT_PDN_DATE_FIELD];
	// Отметкой считаем и флажок, и заполненную дату согласия: бот пишет их
	// вместе (см. buildConsentFields), но оператор мог заполнить только одно.
	const consentGranted =
		parsed.data[CONSENT_PDN_FLAG_FIELD] === true || Boolean(consentAt);
	if (!name && !phone && !email && !consentGranted) return null;
	return {
		name,
		phone,
		email,
		...(consentGranted ? { consentGranted, consentAt } : {}),
	};
}

/**
 * Ищет клиента, уже известного в Bitrix24, по мессенджеру — до того, как
 * сценарий бота покажет экран согласия на ПДн и начнёт спрашивать
 * имя/телефон/email (см. proceedAfterConsent в scenario/engine.ts): если
 * контакт уже есть в CRM, найденные поля подставляются в анкету вместо
 * повторного вопроса, а при отметке о согласии в карточке (consentGranted)
 * экран согласия не показывается вовсе.
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
