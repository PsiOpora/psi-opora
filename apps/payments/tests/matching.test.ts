import { expect, test } from "bun:test";
import type { Purchase } from "@psi-opora/db/queries";
import {
	extractHints,
	isAcquiringSettlement,
	type MatchDeps,
	matchAccountPayment,
	matchAcquiringPayment,
} from "../src/matching";

function purchase(over: Partial<Purchase>): Purchase {
	return {
		id: "p1",
		contactId: "c1",
		dealId: "10",
		productId: null,
		title: "Пакет 5 сессий",
		kind: "package",
		amountKopecks: 1_000_000,
		sessionsTotal: 5,
		sessionsUsed: 0,
		status: "pending",
		paidAt: null,
		expiresAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...over,
	};
}

function deps(over: Partial<MatchDeps> = {}): MatchDeps {
	return {
		getPurchase: async () => null,
		getDealContactId: async () => null,
		listPendingPurchasesByContact: async () => [],
		findContactIdsByPhone: async () => [],
		...over,
	};
}

test("extractHints: сделка и телефоны в разных форматах", () => {
	expect(extractHints("Оплата по сделке №4521, Иванов").dealId).toBe("4521");
	expect(extractHints("заказ 77").dealId).toBe("77");
	expect(extractHints("оплата").dealId).toBeUndefined();
	expect(
		extractHints("+7 (916) 123-45-67 и 8 916 765 43 21").phones.sort(),
	).toEqual(["79161234567", "79167654321"]);
});

test("эквайринг: OrderId = id покупки", async () => {
	const r = await matchAcquiringPayment(
		deps({ getPurchase: async () => purchase({}) }),
		"p1",
	);
	expect(r).toEqual({
		status: "matched",
		contactId: "c1",
		dealId: "10",
		purchaseId: "p1",
	});
});

test("эквайринг: числовой OrderId — запасной путь через сделку", async () => {
	const r = await matchAcquiringPayment(
		deps({ getDealContactId: async () => "c9" }),
		"555",
	);
	expect(r).toEqual({ status: "matched", contactId: "c9", dealId: "555" });
});

test("эквайринг: неизвестный OrderId — неразобранная", async () => {
	expect(await matchAcquiringPayment(deps(), "abc")).toEqual({
		status: "unmatched",
	});
});

test("счёт: сделка из назначения + покупка по сумме", async () => {
	const r = await matchAccountPayment(
		deps({
			getDealContactId: async () => "c1",
			listPendingPurchasesByContact: async () => [
				purchase({ id: "a", amountKopecks: 500_000 }),
				purchase({ id: "b", amountKopecks: 1_000_000 }),
			],
		}),
		{ purpose: "Оплата по сделке 10", amountKopecks: 1_000_000 },
	);
	expect(r).toMatchObject({
		status: "matched",
		contactId: "c1",
		purchaseId: "b",
	});
});

test("счёт: телефон однозначно указывает на контакт", async () => {
	const r = await matchAccountPayment(
		deps({ findContactIdsByPhone: async () => ["c7"] }),
		{ purpose: "за консультацию +7 916 123-45-67", amountKopecks: 100 },
	);
	expect(r).toEqual({
		status: "matched",
		contactId: "c7",
		dealId: undefined,
		purchaseId: undefined,
	});
});

test("счёт: телефон у нескольких контактов — на ручной разбор", async () => {
	const r = await matchAccountPayment(
		deps({ findContactIdsByPhone: async () => ["c1", "c2"] }),
		{ purpose: "+79161234567", amountKopecks: 100 },
	);
	expect(r).toEqual({ status: "unmatched" });
});

test("счёт: двусмысленные покупки одной суммы — покупка не выбирается", async () => {
	const r = await matchAccountPayment(
		deps({
			getDealContactId: async () => "c1",
			listPendingPurchasesByContact: async () => [
				purchase({ id: "a", dealId: "10" }),
				purchase({ id: "b", dealId: "10" }),
			],
		}),
		{ purpose: "сделка 10", amountKopecks: 1_000_000 },
	);
	expect(r).toMatchObject({ status: "matched", purchaseId: undefined });
});

test("счёт без подсказок — неразобранная", async () => {
	expect(
		await matchAccountPayment(deps(), { purpose: "Оплата", amountKopecks: 1 }),
	).toEqual({ status: "unmatched" });
});

test("расчёты по эквайрингу распознаются и не считаются второй раз", () => {
	expect(isAcquiringSettlement("Перечисление по договору эквайринга")).toBe(
		true,
	);
	expect(isAcquiringSettlement("Оплата консультации")).toBe(false);
});
