import { describe, expect, test } from "bun:test";
import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import {
	STAGE_CONSENT_SWEEP_LOOKBACK_MS,
	sweepMissedStageConsents,
} from "./stage-consent-sweep";

const NOW = Date.parse("2026-11-10T09:00:00.000Z");
const redis = {} as RedisClient;

function fakeApi(deals: Array<Record<string, unknown>>) {
	const listCalls: Array<Record<string, unknown> | undefined> = [];
	const api = {
		call: async () => {
			throw new Error("call не должен вызываться");
		},
		list: async (_method: string, params?: Record<string, unknown>) => {
			listCalls.push(params);
			return deals;
		},
	} as unknown as BitrixApi;
	return { api, listCalls };
}

describe("sweepMissedStageConsents", () => {
	test("досылает только сделки без отметки об отправке", async () => {
		const { api, listCalls } = fakeApi([
			{ ID: "1", UF_CRM_STAGE_NOTICE_SENT_DT: "2026-11-10T11:49:18+03:00" },
			{ ID: "2", UF_CRM_STAGE_NOTICE_SENT_DT: "" },
			{ ID: "3", UF_CRM_STAGE_NOTICE_SENT_DT: null },
		]);
		const handled: number[] = [];

		const result = await sweepMissedStageConsents(api, redis, {
			now: () => NOW,
			handler: async (_api, _redis, dealId) => {
				handled.push(dealId);
				return dealId === 2
					? { action: "sent" }
					: { action: "skip", reason: "already_sent" };
			},
		});

		expect(handled).toEqual([2, 3]);
		expect(result).toEqual({ checked: 2, sent: 1, skipped: 1, errors: 0 });
		expect(listCalls[0]?.filter).toEqual({
			CATEGORY_ID: 0,
			STAGE_ID: "UC_WWIO8W",
			">=MOVED_TIME": new Date(
				NOW - STAGE_CONSENT_SWEEP_LOOKBACK_MS,
			).toISOString(),
		});
	});

	test("ошибка одной сделки не останавливает остальные", async () => {
		const { api } = fakeApi([{ ID: "5" }, { ID: "6" }]);

		const result = await sweepMissedStageConsents(api, redis, {
			now: () => NOW,
			handler: async (_api, _redis, dealId) => {
				if (dealId === 5) throw new Error("MAX недоступен");
				return { action: "sent" };
			},
		});

		expect(result).toEqual({ checked: 2, sent: 1, skipped: 0, errors: 1 });
	});
});
