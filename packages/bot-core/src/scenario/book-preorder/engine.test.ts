import { describe, expect, test } from "bun:test";
import { DEFAULT_SCENARIO_TEXTS } from "../texts";
import { applyBookPreorderAction, applyBookPreorderText } from "./engine";
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
});
