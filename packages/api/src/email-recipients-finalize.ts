import type { EmailSuppressionReason } from "@psi-opora/db/queries";
import { isValidEmail, normalizeEmail } from "./schemas/email-lists";

/**
 * Чистая логика отбора получателей email-рассылки — без обращения к БД,
 * чтобы её можно было тестировать без моков модулей.
 */

export interface EmailRecipient {
	/** Ключ для выбора в предпросмотре: ID контакта CRM или ID строки списка. */
	key: string;
	/** ID контакта CRM — только для рассылки по стадии. */
	contactId: string | null;
	contactName: string;
	dealId: string | null;
	dealTitle: string | null;
	email: string | null;
	status: "pending" | "skipped";
	error?: string;
}

const SUPPRESSION_REASON_LABELS: Record<EmailSuppressionReason, string> = {
	unsubscribed: "отписался от рассылок",
	bounced: "адрес не существует (hard bounce)",
	complained: "пожаловался на спам",
	manual: "добавлен в стоп-лист вручную",
};

const INVALID_EMAIL_REASON = "некорректный email";
const DUPLICATE_EMAIL_REASON = "этот адрес уже есть среди получателей";

/**
 * Финальная проверка получателей перед отправкой: нормализует адреса,
 * пропускает некорректные, повторы одного адреса (письмо уходит один раз)
 * и адреса из глобального стоп-листа.
 */
export function finalizeEmailRecipients(
	recipients: EmailRecipient[],
	suppressions: Map<string, EmailSuppressionReason>,
): EmailRecipient[] {
	const seen = new Set<string>();
	return recipients.map((r) => {
		if (r.status !== "pending" || !r.email) return r;
		const email = normalizeEmail(r.email);
		if (!isValidEmail(email)) {
			return { ...r, email, status: "skipped", error: INVALID_EMAIL_REASON };
		}
		if (seen.has(email)) {
			return { ...r, email, status: "skipped", error: DUPLICATE_EMAIL_REASON };
		}
		seen.add(email);
		const suppression = suppressions.get(email);
		if (suppression) {
			return {
				...r,
				email,
				status: "skipped",
				error: `в стоп-листе: ${SUPPRESSION_REASON_LABELS[suppression] ?? suppression}`,
			};
		}
		return { ...r, email };
	});
}
