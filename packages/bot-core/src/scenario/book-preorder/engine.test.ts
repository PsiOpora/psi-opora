import { describe, expect, test } from "bun:test";
import { DEFAULT_SCENARIO_TEXTS } from "../texts";
import { applyBookPreorderAction, applyBookPreorderText } from "./engine";
import { resumeBookPreorder } from "./resume";
import type { BookPreorderState } from "./types";

describe("book preorder email exhaustion", () => {
	const state: BookPreorderState = {
		step: "email_for_payment",
		name: "Ирина",
		phone: "+79991234567",
		consentAt: "2026-09-14T00:00:00.000Z",
		emailAttempts: 2,
	};

	test("creates an immediate-payment lead when no deal exists", async () => {
		const result = await applyBookPreorderText(
			state,
			"invalid-email",
			DEFAULT_SCENARIO_TEXTS,
		);

		expect(result).toMatchObject({
			state: { step: "done", emailAttempts: 3 },
			emailFailed: true,
			lead: {
				name: state.name,
				phone: state.phone,
				consentAt: state.consentAt,
				paymentChoice: "immediate",
			},
		});
	});

	test("reuses an existing deal instead of creating another lead", async () => {
		const result = await applyBookPreorderText(
			{ ...state, dealId: 42 },
			"invalid-email",
			DEFAULT_SCENARIO_TEXTS,
		);

		expect(result?.emailFailed).toBe(true);
		expect(result?.lead).toBeUndefined();
	});
});

describe("book preorder manual payment confirmation", () => {
	const state: BookPreorderState = {
		step: "awaiting_payment",
		dealId: 42,
		orderNo: 1001,
	};

	test("requests a manual check when the confirmation button is pressed", () => {
		const result = applyBookPreorderAction(
			state,
			"bp_confirm_payment",
			DEFAULT_SCENARIO_TEXTS,
		);

		expect(result).toMatchObject({
			state,
			messages: [
				{ text: DEFAULT_SCENARIO_TEXTS.bp_manual_payment_check_reply },
			],
			manualPaymentCheck: true,
		});
	});

	test("keeps typed payment confirmation on the same manual-check flow", async () => {
		const result = await applyBookPreorderText(
			state,
			"Оплатил",
			DEFAULT_SCENARIO_TEXTS,
		);

		expect(result).toMatchObject({
			state,
			messages: [
				{ text: DEFAULT_SCENARIO_TEXTS.bp_manual_payment_check_reply },
			],
			manualPaymentCheck: true,
		});
	});

	/** Проверяет отсрочку оплаты на шаге с платёжной ссылкой. */
	test("defers payment when the client changes their mind on the payment link", () => {
		const result = applyBookPreorderAction(
			state,
			"bp_pay_later",
			DEFAULT_SCENARIO_TEXTS,
		);

		expect(result).toMatchObject({
			state: { ...state, step: "done", paymentDeferred: true },
			messages: [{ text: DEFAULT_SCENARIO_TEXTS.bp_pay_later_reply }],
			paymentDeferred: true,
		});
	});
});

describe("resumeBookPreorder", () => {
	/** Проверяет повтор текущего вопроса с сохранением собранных данных. */
	test("re-asks the current question instead of restarting collected steps", () => {
		const state: BookPreorderState = {
			step: "phone",
			name: "Ирина",
		};

		const result = resumeBookPreorder(state, DEFAULT_SCENARIO_TEXTS);

		expect(result).toMatchObject({
			state,
			messages: [{ text: DEFAULT_SCENARIO_TEXTS.bp_phone_question }],
		});
	});

	/** Проверяет повторную выдачу ссылки на шаге ожидания оплаты. */
	test("resends the payment link on awaiting_payment", () => {
		const state: BookPreorderState = {
			step: "awaiting_payment",
			dealId: 42,
			orderNo: 1001,
			email: "test@example.com",
		};

		const result = resumeBookPreorder(state, DEFAULT_SCENARIO_TEXTS);

		expect(result).toMatchObject({
			state,
			messages: [],
			buildPaymentLink: true,
		});
	});

	/** Проверяет возврат к выбору оплаты после ранее отложенного платежа. */
	test("offers to pay again after a deferred payment", () => {
		const state: BookPreorderState = {
			step: "done",
			name: "Ирина",
			dealId: 42,
			paymentDeferred: true,
		};

		const result = resumeBookPreorder(state, DEFAULT_SCENARIO_TEXTS);

		expect(result).toMatchObject({
			state: { ...state, step: "reserved" },
			messages: [
				{
					buttons: [[{ action: "bp_pay_now" }], [{ action: "bp_pay_later" }]],
				},
			],
		});
	});

	/** Проверяет отказ от резюме после отмены или исчерпания попыток email. */
	test("has nothing to resume after cancellation or a failed email", () => {
		const cancelled: BookPreorderState = { step: "done" };
		const emailFailed: BookPreorderState = { step: "done", dealId: 42 };

		expect(resumeBookPreorder(cancelled, DEFAULT_SCENARIO_TEXTS)).toBeNull();
		expect(resumeBookPreorder(emailFailed, DEFAULT_SCENARIO_TEXTS)).toBeNull();
	});
});
