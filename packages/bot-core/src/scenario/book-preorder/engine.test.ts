import { describe, expect, test } from "bun:test";
import { DEFAULT_SCENARIO_TEXTS } from "../texts";
import { applyBookPreorderText } from "./engine";
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
