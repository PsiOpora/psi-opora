import type { Purchase } from "@psi-opora/db/queries";

/**
 * Сопоставление оплаты с клиентом/сделкой/покупкой. Чистая логика: всё, что
 * ходит в БД и Bitrix, приходит через `MatchDeps` (в тестах — заглушки).
 *
 * Эквайринг — точное: OrderId платежа = id нашей покупки. Переводы на счёт —
 * по подсказкам в назначении платежа (номер сделки, телефон); если подсказок
 * нет или они неоднозначны — оплата уходит в очередь ручного разбора, а не
 * приписывается наугад.
 */

export interface MatchDeps {
	getPurchase(id: string): Promise<Purchase | null>;
	getDealContactId(dealId: string): Promise<string | null>;
	listPendingPurchasesByContact(contactId: string): Promise<Purchase[]>;
	/** Контакты Bitrix с таким телефоном (crm.duplicate.findbycomm). */
	findContactIdsByPhone(phone: string): Promise<string[]>;
}

export type MatchResult =
	| { status: "unmatched" }
	| {
			status: "matched";
			contactId: string;
			dealId?: string;
			purchaseId?: string;
	  };

export interface PurposeHints {
	dealId?: string;
	phones: string[];
}

// \w в JS не матчит кириллицу — окончания слов задаём диапазоном явно.
const DEAL_RE = /(?:сделк[а-яё]*|заказ[а-яё]*|#)\s*№?\s*(\d{1,9})/i;
const PHONE_RE =
	/(?:\+?7|8)[\s\-()]*(\d{3})[\s\-()]*(\d{3})[\s-]*(\d{2})[\s-]*(\d{2})/g;

/** Номер сделки и телефоны (в виде 7XXXXXXXXXX) из назначения платежа. */
export function extractHints(purpose: string | null | undefined): PurposeHints {
	const text = purpose ?? "";
	const phones = new Set<string>();
	for (const m of text.matchAll(PHONE_RE)) {
		phones.add(`7${m[1]}${m[2]}${m[3]}${m[4]}`);
	}
	return { dealId: DEAL_RE.exec(text)?.[1], phones: [...phones] };
}

/** Оплата эквайринга: OrderId — id покупки (или, запасной путь, id сделки). */
export async function matchAcquiringPayment(
	deps: MatchDeps,
	orderId: string,
): Promise<MatchResult> {
	const purchase = await deps.getPurchase(orderId);
	if (purchase) {
		return {
			status: "matched",
			contactId: purchase.contactId,
			dealId: purchase.dealId ?? undefined,
			purchaseId: purchase.id,
		};
	}
	if (/^\d+$/.test(orderId)) {
		const contactId = await deps.getDealContactId(orderId);
		if (contactId) return { status: "matched", contactId, dealId: orderId };
	}
	return { status: "unmatched" };
}

/** Среди ожидающих оплаты покупок клиента — единственная подходящая по сумме. */
function pickPurchase(
	pending: Purchase[],
	amountKopecks: number,
	dealId?: string,
): Purchase | undefined {
	const byDeal = dealId ? pending.filter((p) => p.dealId === dealId) : pending;
	const exact = byDeal.filter((p) => p.amountKopecks === amountKopecks);
	if (exact.length === 1) return exact[0];
	if (exact.length === 0 && byDeal.length === 1) return byDeal[0];
	return undefined;
}

/** Перевод на счёт: подсказки из назначения платежа. */
export async function matchAccountPayment(
	deps: MatchDeps,
	input: { purpose: string | null; amountKopecks: number },
): Promise<MatchResult> {
	const hints = extractHints(input.purpose);

	if (hints.dealId) {
		const contactId = await deps.getDealContactId(hints.dealId);
		if (contactId) {
			const pending = await deps.listPendingPurchasesByContact(contactId);
			const purchase = pickPurchase(pending, input.amountKopecks, hints.dealId);
			return {
				status: "matched",
				contactId,
				dealId: hints.dealId,
				purchaseId: purchase?.id,
			};
		}
	}

	const contactIds = new Set<string>();
	for (const phone of hints.phones) {
		for (const id of await deps.findContactIdsByPhone(phone)) {
			contactIds.add(id);
		}
	}
	// Больше одного контакта на телефон — неоднозначно, отдаём человеку.
	if (contactIds.size === 1) {
		const [contactId] = [...contactIds] as [string];
		const pending = await deps.listPendingPurchasesByContact(contactId);
		const purchase = pickPurchase(pending, input.amountKopecks);
		return {
			status: "matched",
			contactId,
			dealId: purchase?.dealId ?? undefined,
			purchaseId: purchase?.id,
		};
	}

	return { status: "unmatched" };
}

/**
 * Расчёты банка с вами по эквайрингу приходят на счёт одним зачислением
 * («Операции по интернет-эквайрингу приходят одним платежом») — эти деньги
 * уже учтены уведомлениями эквайринга, второй раз их считать нельзя.
 */
export function isAcquiringSettlement(purpose: string | null): boolean {
	return /эквайринг|т-?касс|tinkoff\s*kassa/i.test(purpose ?? "");
}
