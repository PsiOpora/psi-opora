import { beforeEach, describe, expect, mock, test } from "bun:test";

const tryMoveBookPreorderDealStage = mock(() => Promise.resolve());
const markBookPreorderAwaitingPayment = mock(() => Promise.resolve());
const markBookPreorderDeclined = mock(() => Promise.resolve());

const order = {
	id: "telegram:7",
	orderNo: 1001,
	messenger: "telegram",
	userId: "7",
	chatId: null,
	status: "reserved",
	dealId: 42,
	phone: null,
	email: null,
};

mock.module("../../utils/bitrix", () => ({
	appendDealComment: () => Promise.resolve(),
	tryMoveBookPreorderDealStage,
}));

mock.module("@psi-opora/db/queries", () => ({
	getBookPreorderOrderByOrderNo: () => Promise.resolve(order),
	markBookPreorderAwaitingPayment,
	markBookPreorderDeclined,
	recordBookPreorderDripAnyClick: () => Promise.resolve(),
	recordBookPreorderDripDeferred: () => Promise.resolve(),
}));

mock.module("../../utils/prodamus", () => ({
	buildProdamusPaymentUrl: () => "https://pay.example.test/order",
}));

const { DEFAULT_SCENARIO_TEXTS } = await import("../texts");
const { handleBookPreorderDripCallback } = await import("./drip-actions");

describe("book preorder drip callbacks", () => {
	beforeEach(() => {
		tryMoveBookPreorderDealStage.mockClear();
		markBookPreorderAwaitingPayment.mockClear();
		markBookPreorderDeclined.mockClear();
	});

	/** Проверяет перевод сделки в «Ждёт оплаты» по кнопке «Оплатить». */
	test.each(["pay", "buy2480"] as const)(
		"%s moves the deal to awaiting payment",
		async (action) => {
			await handleBookPreorderDripCallback(
				"telegram",
				7,
				undefined,
				{ action, orderNo: 1001 },
				DEFAULT_SCENARIO_TEXTS,
			);

			expect(markBookPreorderAwaitingPayment).toHaveBeenCalledWith(
				"telegram:7",
				{},
			);
			expect(tryMoveBookPreorderDealStage).toHaveBeenCalledWith(
				"telegram",
				42,
				"awaitingPayment",
			);
		},
	);

	/** Проверяет перевод сделки в «Сделка провалена» при отказе. */
	test.each(["cancel", "stop"] as const)(
		"%s moves the deal to declined",
		async (action) => {
			await handleBookPreorderDripCallback(
				"telegram",
				7,
				undefined,
				{ action, orderNo: 1001 },
				DEFAULT_SCENARIO_TEXTS,
			);

			expect(markBookPreorderDeclined).toHaveBeenCalledWith("telegram:7");
			expect(tryMoveBookPreorderDealStage).toHaveBeenCalledWith(
				"telegram",
				42,
				"declined",
			);
		},
	);

	test("defer leaves the deal stage untouched", async () => {
		await handleBookPreorderDripCallback(
			"telegram",
			7,
			undefined,
			{ action: "defer", orderNo: 1001 },
			DEFAULT_SCENARIO_TEXTS,
		);

		expect(tryMoveBookPreorderDealStage).not.toHaveBeenCalled();
	});
});
