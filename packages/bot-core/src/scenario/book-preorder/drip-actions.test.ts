import { beforeEach, describe, expect, mock, test } from "bun:test";

const withBookPreorderOrderLock = mock(<T>(_id: string, fn: () => Promise<T>) =>
	fn(),
);
const tryMoveBookPreorderDealStage = mock(() => Promise.resolve());
const markBookPreorderAwaitingPayment = mock(() => Promise.resolve(true));
const markBookPreorderDeclined = mock(() => Promise.resolve(true));
const appendDealComment = mock(() => Promise.resolve());

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
	appendDealComment,
	tryMoveBookPreorderDealStage,
}));

mock.module("@psi-opora/db/queries", () => ({
	withBookPreorderOrderLock,
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
		withBookPreorderOrderLock.mockClear();
		markBookPreorderAwaitingPayment.mockReset();
		markBookPreorderAwaitingPayment.mockResolvedValue(true);
		markBookPreorderDeclined.mockReset();
		markBookPreorderDeclined.mockResolvedValue(true);
		appendDealComment.mockClear();
		order.status = "reserved";
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

			expect(withBookPreorderOrderLock).toHaveBeenCalledWith(
				"telegram:7",
				expect.any(Function),
			);
			expect(markBookPreorderAwaitingPayment).toHaveBeenCalledWith(
				"telegram:7",
				{},
				"reserved",
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

			expect(markBookPreorderDeclined).toHaveBeenCalledWith(
				"telegram:7",
				"reserved",
			);
			expect(tryMoveBookPreorderDealStage).toHaveBeenCalledWith(
				"telegram",
				42,
				"declined",
			);
		},
	);

	test.each(["pay", "buy2480", "cancel", "stop"] as const)(
		"%s skips Bitrix and the success reply when the conditional update loses a race",
		async (action) => {
			markBookPreorderAwaitingPayment.mockResolvedValue(false);
			markBookPreorderDeclined.mockResolvedValue(false);
			const result = await handleBookPreorderDripCallback(
				"telegram",
				7,
				undefined,
				{ action, orderNo: 1001 },
				DEFAULT_SCENARIO_TEXTS,
			);
			expect(result).toEqual({
				text: DEFAULT_SCENARIO_TEXTS.bp_drip_already_settled_reply,
			});
			expect(tryMoveBookPreorderDealStage).not.toHaveBeenCalled();
			expect(appendDealComment).not.toHaveBeenCalled();
		},
	);

	test.each(["paid", "declined", "awaiting_payment", "cancelled"])(
		"stale buttons cannot change a %s order",
		async (status) => {
			order.status = status;
			for (const action of ["pay", "buy2480", "cancel", "stop"] as const) {
				await handleBookPreorderDripCallback(
					"telegram",
					7,
					undefined,
					{ action, orderNo: 1001 },
					DEFAULT_SCENARIO_TEXTS,
				);
			}
			expect(markBookPreorderAwaitingPayment).not.toHaveBeenCalled();
			expect(markBookPreorderDeclined).not.toHaveBeenCalled();
			expect(tryMoveBookPreorderDealStage).not.toHaveBeenCalled();
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
