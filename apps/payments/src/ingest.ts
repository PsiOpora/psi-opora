import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import {
	getDealContactId,
	getPurchase,
	insertPaymentIfNew,
	listPendingPurchasesByContact,
	markPaymentRefunded,
	type NewPaymentEntry,
	type Payment,
} from "@psi-opora/db/queries";
import {
	type MatchDeps,
	type MatchResult,
	matchAccountPayment,
	matchAcquiringPayment,
} from "./matching";
import { processPayment } from "./process-payment";

const findbycommResultSchema = (value: unknown): string[] => {
	const contact = (value as { CONTACT?: unknown } | null)?.CONTACT;
	return Array.isArray(contact) ? contact.map(String) : [];
};

/** Реальные зависимости сопоставления: БД платформы + поиск по телефону в Bitrix. */
export const matchDeps: MatchDeps = {
	getPurchase,
	getDealContactId,
	listPendingPurchasesByContact,
	async findContactIdsByPhone(phone) {
		const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
		if (!api) return [];
		const result = await api.call<unknown>("crm.duplicate.findbycomm", {
			type: "PHONE",
			values: [`+${phone}`],
			entity_type: "CONTACT",
		});
		return findbycommResultSchema(result);
	},
};

type IngestInput = Omit<
	NewPaymentEntry,
	"matchStatus" | "contactId" | "dealId" | "purchaseId"
>;

function toEntry(input: IngestInput, match: MatchResult): NewPaymentEntry {
	return match.status === "matched"
		? {
				...input,
				matchStatus: "matched",
				contactId: match.contactId,
				dealId: match.dealId,
				purchaseId: match.purchaseId,
			}
		: { ...input, matchStatus: "unmatched" };
}

/** Запись + доведение до Bitrix; сбой Bitrix не теряет оплату — её повторит тикер. */
async function finish(payment: Payment): Promise<void> {
	try {
		await processPayment(payment);
	} catch (err) {
		console.error(
			`[payments] не удалось отразить оплату ${payment.id} в Bitrix: ${(err as Error).message}`,
		);
	}
}

/** Оплата эквайринга (CONFIRMED). Повторное уведомление — не дубль. */
export async function ingestAcquiringPayment(
	input: IngestInput & { orderId: string },
): Promise<void> {
	const { orderId, ...rest } = input;
	const match = await matchAcquiringPayment(matchDeps, orderId);
	const payment = await insertPaymentIfNew(toEntry(rest, match));
	// null — дубль: догонять недоделанное умеет тикер, здесь ничего не делаем.
	if (payment) await finish(payment);
	if (match.status === "unmatched") {
		console.error(
			`[payments] оплата эквайринга без покупки: OrderId=${orderId}, PaymentId=${input.externalId}`,
		);
	}
}

/** Зачисление на счёт: привязка по подсказкам, иначе — в очередь разбора. */
export async function ingestAccountPayment(input: IngestInput): Promise<void> {
	const match = await matchAccountPayment(matchDeps, {
		purpose: input.purpose ?? null,
		amountKopecks: input.amountKopecks,
	});
	const payment = await insertPaymentIfNew(toEntry(input, match));
	if (payment) await finish(payment);
}

/** Возврат по эквайрингу: оплата выходит из итогов, Bitrix пересчитывается. */
export async function ingestAcquiringRefund(paymentId: string): Promise<void> {
	const payment = await markPaymentRefunded("tbank_acquiring", paymentId);
	if (payment) await finish(payment);
}
