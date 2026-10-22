import { describe, expect, test } from "bun:test";
import {
	OUTREACH_MAX_BATCH_PAUSE_MIN,
	OUTREACH_MAX_DAILY_LIMIT,
	OUTREACH_MAX_DEDUP_DAYS,
} from "@psi-opora/api/schemas";
import { defaultDraft, deliveryProblems } from "./delivery-model";

function draft() {
	const value = defaultDraft({
		max: [],
		telegram: [],
		whatsapp: [],
		email: { error: "Email is disabled" },
	});
	const channel = value.channels[0];
	if (!channel) throw new Error("Missing channel");
	channel.enabled = true;
	return { value, channel };
}

describe("deliveryProblems", () => {
	for (const [field, max] of [
		["dailyLimit", OUTREACH_MAX_DAILY_LIMIT],
		["batchSize", 1000],
		["batchPauseMin", OUTREACH_MAX_BATCH_PAUSE_MIN],
	] as const) {
		test.each([0, -1, 1.5, max + 1, Number.NaN, Infinity])(
			`${field}: rejects %s on enabled channels`,
			(invalid) => {
				const { value, channel } = draft();
				channel[field] = invalid;
				expect(deliveryProblems(value)).toHaveLength(1);
				channel.enabled = false;
				expect(deliveryProblems(value)).toEqual([]);
			},
		);
		test.each([1, max])(`${field}: accepts boundary %s`, (valid) => {
			const { value, channel } = draft();
			channel[field] = valid;
			expect(deliveryProblems(value)).toEqual([]);
		});
	}

	test("unlimited delivery and disabled batch breaks are allowed", () => {
		const { value, channel } = draft();
		channel.dailyLimit = null;
		channel.batchSize = null;
		channel.batchPauseMin = Number.NaN;
		expect(deliveryProblems(value)).toEqual([]);
	});

	test.each([0, -1, 1.5, OUTREACH_MAX_DEDUP_DAYS + 1, Number.NaN, Infinity])(
		"deduplication rejects %s only when enabled",
		(invalid) => {
			const { value } = draft();
			value.dedupDays = invalid;
			expect(deliveryProblems(value)).toHaveLength(1);
			value.dedupEnabled = false;
			expect(deliveryProblems(value)).toEqual([]);
		},
	);

	test.each([1, OUTREACH_MAX_DEDUP_DAYS])(
		"deduplication accepts boundary %s",
		(valid) => {
			const { value } = draft();
			value.dedupDays = valid;
			expect(deliveryProblems(value)).toEqual([]);
		},
	);

	test("retains interval and sending window checks", () => {
		const { value, channel } = draft();
		channel.minIntervalSec = 0;
		channel.maxIntervalSec = -1;
		value.window = { days: [], fromHour: 20, toHour: 10 };
		expect(deliveryProblems(value)).toHaveLength(4);
	});
});
