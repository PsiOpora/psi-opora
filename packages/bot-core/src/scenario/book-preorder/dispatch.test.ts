import { beforeEach, describe, expect, mock, test } from "bun:test";

const appendDealComment = mock(() => Promise.resolve());
const createBitrixTask = mock(() => Promise.resolve());

const moveBookPreorderDealStage = mock(() => Promise.resolve());
const markBookPreorderReserved = mock(() => Promise.resolve());

mock.module("../../utils/bitrix", () => ({
	appendDealComment,
	BOOK_PREORDER_CATEGORY_ID: 8,
	BOOK_PREORDER_STAGE_IDS: {
		awaitingPayment: "C8:PREPAYMENT_INVOICE",
		reserved: "C8:NEW",
	},
	createBitrixTask,
	moveBookPreorderDealStage,
}));

mock.module("@psi-opora/db/queries", () => ({
	markBookPreorderAwaitingPayment: () => Promise.resolve(),
	markBookPreorderDeclined: () => Promise.resolve(),
	markBookPreorderReserved,
	upsertBookPreorderOrder: () => Promise.resolve(null),
}));

mock.module("../../utils/consultation-deal", () => ({
	submitConsultationDeal: () => Promise.resolve(null),
}));

mock.module("../../utils/message-log", () => ({
	logBotMessage: () => Promise.resolve(),
}));

mock.module("../../utils/prodamus", () => ({
	buildProdamusPaymentUrl: () => "https://pay.example.test/order",
}));

const { DEFAULT_SCENARIO_TEXTS } = await import("../texts");
const { dispatchBookPreorderOutput } = await import("./dispatch");

describe("book preorder dispatch", () => {
	beforeEach(() => {
		appendDealComment.mockClear();
		createBitrixTask.mockClear();
		moveBookPreorderDealStage.mockClear();
		markBookPreorderReserved.mockClear();
	});

	test("comments on the deal and creates a linked task for manual payment confirmation", async () => {
		const reply = DEFAULT_SCENARIO_TEXTS.bp_manual_payment_check_reply;
		const sendMessage = mock(() => Promise.resolve());

		await dispatchBookPreorderOutput(
			{
				state: { step: "awaiting_payment", dealId: 42, orderNo: 1001 },
				messages: [{ text: reply }],
				manualPaymentCheck: true,
				awaitingInput: true,
			},
			{
				messenger: "telegram",
				userId: 7,
				sendMessage,
				texts: DEFAULT_SCENARIO_TEXTS,
			},
		);

		const comment =
			"Клиент написал «оплатил» — автоматическое подтверждение ещё не пришло, нужно проверить вручную.";
		expect(sendMessage).toHaveBeenCalledWith({ text: reply });
		expect(appendDealComment).toHaveBeenCalledWith("telegram", 42, comment);
		expect(createBitrixTask).toHaveBeenCalledWith("telegram", {
			title: "Проверить оплату предзаказа книги",
			description: comment,
			dealId: 42,
		});
	});

	test("moving payment deferred from awaiting_payment returns the deal and order to reserved", async () => {
		const reply = DEFAULT_SCENARIO_TEXTS.bp_pay_later_reply;
		const sendMessage = mock(() => Promise.resolve());

		await dispatchBookPreorderOutput(
			{
				state: {
					step: "done",
					paymentDeferred: true,
					dealId: 42,
					orderNo: 1001,
				},
				messages: [{ text: reply }],
				paymentDeferred: true,
				awaitingInput: false,
			},
			{
				messenger: "telegram",
				userId: 7,
				sendMessage,
				texts: DEFAULT_SCENARIO_TEXTS,
			},
		);

		expect(moveBookPreorderDealStage).toHaveBeenCalledWith(
			"telegram",
			42,
			"reserved",
		);
		expect(markBookPreorderReserved).toHaveBeenCalledWith("telegram:7");
		expect(appendDealComment).toHaveBeenCalledWith(
			"telegram",
			42,
			"Клиент выбрал «Оплата позже» — бронь остаётся в силе.",
		);
	});
});
