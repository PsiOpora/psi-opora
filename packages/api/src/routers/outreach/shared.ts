import { ORPCError } from "@orpc/server";
import {
	findRecentlyContactedOutreach,
	listMaxPersonalAccounts,
	listTelegramPersonalAccounts,
	listWhatsappPersonalAccounts,
} from "@psi-opora/db/queries";

/** Личный номер, доступный для рассылки, — для выбора в форме. */
export interface OutreachAccountOption {
	openLineId: string;
	connectorId: string;
	phone: string;
	/** connected — можно выбирать; остальные показываются неактивными. */
	status: string;
}

export function requireMember(memberId: string | null): string {
	if (!memberId) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Нет сессии Битрикс24 — обновите страницу",
		});
	}
	return memberId;
}

export async function loadAccountOptions(memberId: string) {
	const [max, telegram, whatsapp] = await Promise.all([
		listMaxPersonalAccounts(memberId),
		listTelegramPersonalAccounts(memberId),
		listWhatsappPersonalAccounts(memberId),
	]);
	const toOption = (row: {
		openLineId: string;
		connectorId: string;
		phone: string;
		status: string;
	}): OutreachAccountOption => ({
		openLineId: row.openLineId,
		connectorId: row.connectorId,
		phone: row.phone,
		status: row.status,
	});
	return {
		max: max.map(toOption),
		telegram: telegram.map(toOption),
		whatsapp: whatsapp.map(toOption),
	};
}

/**
 * Кому рассылка уже дошла за последние dedupDays дней: телефон — если
 * сообщение ушло в мессенджер (или могло уйти), email — если ушло письмо.
 * Возвращает проверку «контакт недавно получал рассылку».
 */
export async function recentlyContactedChecker(
	contacts: Array<{ phone: string | null; email: string | null }>,
	dedupDays: number | null | undefined,
): Promise<
	(contact: { phone: string | null; email: string | null }) => boolean
> {
	if (!dedupDays) return () => false;
	const since = new Date(Date.now() - dedupDays * 24 * 60 * 60 * 1000);
	const recent = await findRecentlyContactedOutreach({
		phones: contacts.map((c) => c.phone).filter((p): p is string => !!p),
		emails: contacts.map((c) => c.email).filter((e): e is string => !!e),
		since,
	});
	return (contact) =>
		(contact.phone !== null && recent.phones.has(contact.phone)) ||
		(contact.email !== null && recent.emails.has(contact.email));
}
