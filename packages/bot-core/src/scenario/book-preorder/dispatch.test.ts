import { beforeEach, describe, expect, mock, test } from "bun:test";

const appendDealComment = mock(() => Promise.resolve());
const createBitrixTask = mock(() => Promise.resolve());

const moveBookPreorderDealStage = mock(() => Promise.resolve());
const tryMoveBookPreorderDealStage = mock(() => Promise.resolve());
const markBookPreorderReserved = mock(() => Promise.resolve());
const upsertBookPreorderOrder = mock(() => Promise.resolve({ orderNo: 1001 }));
const submitConsultationDeal = mock(
	(_params: { stageId?: string }): Promise<number | null> =>
		Promise.resolve(77),
);

mock.module("../../utils/bitrix", () => ({
	appendDealComment,
	BOOK_PREORDER_CATEGORY_ID: 8,
	BOOK_PREORDER_STAGE_IDS: {
		newRequest: "C8:NEW",
		reserved: "C8:UC_0HJ3ZP",
		awaitingPayment: "C8:AMO_65CAC4EC",
		paid: "C8:EXECUTING",
		declined: "C8:LOSE",
	},
	createBitrixTask,
	moveBookPreorderDealStage,
	tryMoveBookPreorderDealStage,
}));

mock.module("@psi-opora/db/queries", () => ({
	withBookPreorderOrderLock: <T>(_id: string, fn: () => Promise<T>) => fn(),
	markBookPreorderAwaitingPayment: () => Promise.resolve(),
	saveYandexMetrikaDealVisitor: () => Promise.resolve(),
	markBookPreorderDeclined: () => Promise.resolve(),
	markBookPreorderReserved,
	upsertBookPreorderOrder,
}));

mock.module("../../utils/consultation-deal", () => ({
	submitConsultationDeal,
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
		tryMoveBookPreorderDealStage.mockClear();
		markBookPreorderReserved.mockClear();
		upsertBookPreorderOrder.mockClear();
		submitConsultationDeal.mockClear();
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

	/** Проверяет возврат сделки и заказа в бронь после отсрочки оплаты. */
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

	const deps = {
		messenger: "telegram",
		userId: 7,
		sendMessage: () => Promise.resolve(),
		texts: DEFAULT_SCENARIO_TEXTS,
	};

	/** Проверяет заведение сделки на «Новой заявке» до выбора брони/оплаты. */
	test("creates a deal on the new-request stage without an order row", async () => {
		const state = { step: "about_book" as const, name: "Ирина" };

		await dispatchBookPreorderOutput(
			{ state, messages: [], newRequest: true, awaitingInput: true },
			deps,
		);

		expect(submitConsultationDeal).toHaveBeenCalledTimes(1);
		expect(submitConsultationDeal.mock.calls[0]?.[0]).toMatchObject({
			stageId: "C8:NEW",
		});
		expect(upsertBookPreorderOrder).not.toHaveBeenCalled();
		expect(state).toMatchObject({ dealId: 77 });
	});

	/** Проверяет перевод сделки с «Новой заявки» вместо создания второй. */
	test("moves the existing new-request deal to reserved on reservation", async () => {
		await dispatchBookPreorderOutput(
			{
				state: { step: "reserved", dealId: 42 },
				messages: [],
				lead: { paymentChoice: "deferred" },
				awaitingInput: true,
			},
			deps,
		);

		expect(submitConsultationDeal).not.toHaveBeenCalled();
		expect(tryMoveBookPreorderDealStage).toHaveBeenCalledWith(
			"telegram",
			42,
			"reserved",
		);
		expect(upsertBookPreorderOrder).toHaveBeenCalledTimes(1);
		expect(upsertBookPreorderOrder.mock.calls[0]).toMatchObject([
			{ dealId: 42 },
		]);
	});

	/** Проверяет перевод на «Ждёт оплаты» ровно один раз при выдаче ссылки. */
	test("moves the existing deal to awaiting payment once when a link is sent", async () => {
		await dispatchBookPreorderOutput(
			{
				state: { step: "awaiting_payment", dealId: 42, email: "a@b.ru" },
				messages: [],
				lead: { email: "a@b.ru", paymentChoice: "immediate" },
				buildPaymentLink: true,
				awaitingInput: true,
			},
			deps,
		);

		expect(submitConsultationDeal).not.toHaveBeenCalled();
		expect(tryMoveBookPreorderDealStage).toHaveBeenCalledTimes(1);
		expect(tryMoveBookPreorderDealStage).toHaveBeenCalledWith(
			"telegram",
			42,
			"awaitingPayment",
		);
		expect(moveBookPreorderDealStage).not.toHaveBeenCalled();
	});

	/** Проверяет, что без выданной ссылки сделка не попадает в «Ждёт оплаты». */
	test("creates a failed-email lead on the reserved stage, not awaiting payment", async () => {
		await dispatchBookPreorderOutput(
			{
				state: { step: "done" },
				messages: [],
				lead: { paymentChoice: "immediate" },
				emailFailed: true,
				awaitingInput: false,
			},
			deps,
		);

		expect(submitConsultationDeal.mock.calls[0]?.[0]).toMatchObject({
			stageId: "C8:UC_0HJ3ZP",
		});
	});
});
