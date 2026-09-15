import type { BitrixApi } from "@psi-opora/bitrix-client";
import { getBitrixCrmLink } from "@psi-opora/db/queries";
import { getContactPhone, type RawContact } from "../../broadcast-send";

type GetCrmLink = typeof getBitrixCrmLink;

function phoneDigits(value: string): string {
	const digits = value.replace(/\D/g, "");
	return digits.length === 11 && digits.startsWith("8")
		? `7${digits.slice(1)}`
		: digits;
}

/**
 * Старые первые исходящие диалоги Telegram Personal хранят в userId телефон,
 * а не Telegram ID. Если ключ связан с CRM-контактом и совпадает с его
 * телефоном, повторную отправку нужно снова адресовать как phone; воркер
 * вернёт канонический Telegram ID и дальнейшие сообщения смогут идти по ID.
 */
export async function resolveTelegramPersonalTarget(
	api: BitrixApi | null,
	userId: string,
	getLink: GetCrmLink = getBitrixCrmLink,
): Promise<{ kind: "phone" | "id"; value: string }> {
	if (!api) return { kind: "id", value: userId };

	const link = await getLink("telegram-personal", userId).catch(() => null);
	if (!link?.contactId) return { kind: "id", value: userId };

	const contact = await api
		.call<RawContact>("crm.contact.get", { id: link.contactId })
		.catch(() => null);
	const phone = contact ? getContactPhone(contact) : undefined;
	if (phone && phoneDigits(phone) === phoneDigits(userId)) {
		return { kind: "phone", value: phone };
	}
	return { kind: "id", value: userId };
}
