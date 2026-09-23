import { z } from "zod";

/**
 * Провайдеры сообщений CRM (messageservice.sender.add) — то, что Bitrix24
 * показывает в CRM → «Каналы для отправки сообщений»
 * (/crm/messagesender/connections/) и в «Написать клиенту»/роботах
 * «Отправить SMS». В отличие от коннекторов Открытых линий
 * (imconnector.register — только Контакт-центр), это единственный способ
 * для приложения попасть в этот список. Регистрируются кнопкой в дашборде
 * (apps/dashboard settings/connectors, message-sender-card.tsx) — коды
 * должны совпадать с MESSAGE_SENDER_PROVIDERS там.
 *
 * Только личные номера: бот (Telegram/MAX Bot API) не может написать
 * первым по номеру телефона, а у личного MAX нет подтверждённого способа
 * открыть диалог по номеру (см. resolveClientPhoneNumber в packages/max-userbot).
 */
export const MESSAGE_SENDER_CODES = {
	psiopora_wa_personal: "whatsapp-personal",
	psiopora_tg_personal: "telegram-personal",
} as const;

export type MessageSenderCode = keyof typeof MESSAGE_SENDER_CODES;

// CRM_OWNER_TYPE: 2 — сделка, 3 — контакт.
const OWNER_TYPE_DEAL = "2";
const OWNER_TYPE_CONTACT = "3";

const payloadSchema = z.object({
	code: z.enum(
		Object.keys(MESSAGE_SENDER_CODES) as [
			MessageSenderCode,
			...MessageSenderCode[],
		],
	),
	messageId: z.string().min(1),
	to: z.string().min(1),
	text: z.string().trim().min(1),
	memberId: z.string().min(1),
	contactId: z.string().regex(/^\d+$/).optional(),
	dealId: z.string().regex(/^\d+$/).optional(),
});

export type MessageSenderPayload = z.infer<typeof payloadSchema>;

function formString(form: FormData, key: string): string | undefined {
	const value = form.get(key);
	return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Разбирает запрос, который Bitrix24 шлёт в HANDLER провайдера
 * (application/x-www-form-urlencoded, PHP-скобки: `auth[member_id]`,
 * `bindings[0][OWNER_ID]`). Поля описаны в документации
 * messageservice.sender.add, раздел «Что приходит в обработчик».
 */
export function parseMessageSenderForm(
	form: FormData,
): MessageSenderPayload | null {
	let contactId: string | undefined;
	let dealId: string | undefined;
	for (let i = 0; ; i++) {
		const ownerType = formString(form, `bindings[${i}][OWNER_TYPE_ID]`);
		const ownerId = formString(form, `bindings[${i}][OWNER_ID]`);
		if (ownerType === undefined && ownerId === undefined) break;
		if (ownerType === OWNER_TYPE_CONTACT) contactId ??= ownerId;
		if (ownerType === OWNER_TYPE_DEAL) dealId ??= ownerId;
	}

	const parsed = payloadSchema.safeParse({
		code: formString(form, "code"),
		messageId: formString(form, "message_id"),
		to:
			formString(form, "message_to") ??
			formString(form, "properties[phone_number]"),
		text:
			formString(form, "message_body") ??
			formString(form, "properties[message_text]"),
		memberId: formString(form, "auth[member_id]"),
		contactId,
		dealId,
	});
	return parsed.success ? parsed.data : null;
}

/** Номер из CRM → цифры в международном формате. Российские номера часто
 * записаны как 8XXXXXXXXXX или без кода страны — WhatsApp/Telegram
 * понимают только 7XXXXXXXXXX. */
export function normalizePhoneDigits(phone: string): string | null {
	const trimmed = phone.trim();
	const international = trimmed.startsWith("+");
	let digits = trimmed.replace(/\D/g, "");
	if (!international && digits.length === 10 && digits.startsWith("9"))
		digits = `7${digits}`;
	if (!international && digits.length === 11 && digits.startsWith("8"))
		digits = `7${digits.slice(1)}`;
	return digits.length >= 10 && digits.length <= 15 ? digits : null;
}
