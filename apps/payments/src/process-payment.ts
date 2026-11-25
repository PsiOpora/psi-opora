import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import {
	getContactPaymentTotals,
	getPaymentSettings,
	getPurchase,
	markPaymentBitrixSynced,
	type Payment,
	type PaymentSettings,
	setPurchaseStatus,
	sumPaidKopecksByPurchase,
} from "@psi-opora/db/queries";

/**
 * Доводит записанную оплату до конца: статус покупки + отражение в Bitrix
 * (поля контакта/сделки, стадия, комментарий). Идемпотентно — безопасно
 * вызывать повторно: bitrixSyncedAt ставится только после полного успеха,
 * поэтому упавшую оплату подхватит тикер повторов (server.ts).
 */

const rub = (kopecks: number): string =>
	`${(kopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

/** Покупка оплачена, когда действующие оплаты покрывают её цену. */
async function applyToPurchase(payment: Payment): Promise<{
	paidKopecks: number;
	fullyPaid: boolean;
} | null> {
	if (!payment.purchaseId) return null;
	const purchase = await getPurchase(payment.purchaseId);
	if (!purchase) return null;
	const paidKopecks = await sumPaidKopecksByPurchase(purchase.id);
	const fullyPaid = paidKopecks >= purchase.amountKopecks;
	if (fullyPaid && purchase.status !== "paid") {
		await setPurchaseStatus(purchase.id, "paid", payment.paidAt);
	} else if (!fullyPaid && purchase.status === "paid") {
		// Возврат снизил оплаченную сумму ниже цены.
		await setPurchaseStatus(
			purchase.id,
			paidKopecks === 0 ? "refunded" : "pending",
			null,
		);
	}
	return { paidKopecks, fullyPaid };
}

function describePayment(payment: Payment, totalKopecks: number): string {
	const head =
		payment.status === "refunded"
			? `↩️ Возврат по оплате Т-Банка: ${rub(payment.amountKopecks)}`
			: `💰 Оплата Т-Банка: ${rub(payment.amountKopecks)}`;
	const lines = [head];
	if (payment.payerName) lines.push(`Плательщик: ${payment.payerName}`);
	if (payment.purpose) lines.push(`Назначение: ${payment.purpose}`);
	lines.push(`Всего оплачено клиентом: ${rub(totalKopecks)}`);
	return lines.join("\n");
}

async function updateCrm(
	api: NonNullable<ReturnType<typeof resolveBitrixApi>>,
	settings: PaymentSettings | null,
	payment: Payment,
	contactId: string,
	purchase: { paidKopecks: number; fullyPaid: boolean } | null,
	totals: Awaited<ReturnType<typeof getContactPaymentTotals>>,
): Promise<void> {
	const contactFields: Record<string, string> = {};
	if (settings?.contactTotalField) {
		contactFields[settings.contactTotalField] = (
			totals.totalKopecks / 100
		).toFixed(2);
	}
	if (settings?.contactLastPaidField && totals.lastPaidAt) {
		contactFields[settings.contactLastPaidField] =
			totals.lastPaidAt.toISOString();
	}
	if (Object.keys(contactFields).length > 0) {
		await api.call("crm.contact.update", {
			id: contactId,
			fields: contactFields,
		});
	}

	if (payment.dealId && purchase) {
		const dealFields: Record<string, string> = {};
		if (settings?.dealPaidField) {
			dealFields[settings.dealPaidField] = (purchase.paidKopecks / 100).toFixed(
				2,
			);
		}
		if (purchase.fullyPaid && settings?.dealPaidStageId) {
			dealFields.STAGE_ID = settings.dealPaidStageId;
		}
		if (Object.keys(dealFields).length > 0) {
			await api.call("crm.deal.update", {
				id: payment.dealId,
				fields: dealFields,
			});
		}
	}

	// Комментарий — последним: поля обновляются идемпотентно, и повтор после
	// сбоя не плодит дубли комментариев.
	await api.call("crm.timeline.comment.add", {
		fields: {
			ENTITY_ID: Number(payment.dealId ?? contactId),
			ENTITY_TYPE: payment.dealId ? "deal" : "contact",
			COMMENT: describePayment(payment, totals.totalKopecks),
		},
	});
}

export async function processPayment(payment: Payment): Promise<void> {
	if (!payment.contactId || payment.matchStatus === "ignored") return;

	const purchase = await applyToPurchase(payment);

	const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
	if (!api) {
		throw new Error("нет клиента Bitrix24 (BITRIX_MEMBER_ID / OAuth)");
	}
	const [settings, totals] = await Promise.all([
		getPaymentSettings(),
		getContactPaymentTotals(payment.contactId),
	]);
	await updateCrm(api, settings, payment, payment.contactId, purchase, totals);
	await markPaymentBitrixSynced(payment.id);
}
