import { describe, expect, mock, test } from "bun:test";

const calls: string[] = [];
let tagShouldFail = false;

// Без БД: тесты не должны ходить в Postgres.
mock.module("@psi-opora/db/queries", () => ({
	insertBotMessage: () => Promise.resolve(null),
	upsertBotFunnelEvent: () => Promise.resolve(),
	getBotTextsRecord: () => Promise.resolve({}),
	markBotMessageGuideEmailSent: () => Promise.resolve(),
	getUnisenderSettings: () => Promise.resolve(null),
	getSmtpBzSettings: () => Promise.resolve(null),
	getRusenderSettings: () => Promise.resolve(null),
	getResendSettings: () => Promise.resolve(null),
	getPostboxSettings: () => Promise.resolve(null),
	getEmailProvider: () => Promise.resolve(null),
	getConversationMeta: () => Promise.resolve(null),
	saveYandexMetrikaDealVisitor: () => Promise.resolve(null),
	getBotUserProfile: () => Promise.resolve(null),
	saveYandexMetrikaMessengerVisitor: () => Promise.resolve(null),
	listAdTouchesForClient: () => Promise.resolve(null),
	insertDealTouches: () => Promise.resolve(null),
	insertAdSearchQueryLookup: () => Promise.resolve(null),
	upsertAdEntities: () => Promise.resolve(null),
	getAdEntities: () => Promise.resolve(null),
	getAdCredentials: () => Promise.resolve(null),
	upsertAdDailyStats: () => Promise.resolve(null),
	upsertBitrixCrmLink: () => Promise.resolve(null),
	getBitrixCrmLink: () => Promise.resolve(null),
	getBotConnector: () => Promise.resolve(null),
	getYandexMetrikaSettings: () => Promise.resolve(null),
	upsertBotGuideDelivery: () => Promise.resolve(),
	addClientNote: async () => {
		calls.push("note");
		return null;
	},
	addConversationTag: async () => {
		calls.push("tag");
		if (tagShouldFail) throw new Error("db down");
	},
}));

import type { RedisClient } from "../storage/redis";

const { dispatchScenarioOutput } = await import("./dispatch");
const { applyScenarioText } = await import("./engine");
const { DEFAULT_SCENARIO_TEXTS: t } = await import("./texts");
const { setFunnelUpsert } = await import("../utils/funnel");

setFunnelUpsert(async () => {});

function deps(sendMessage: () => Promise<void>, removed: string[] = []) {
	return {
		messenger: "max",
		sessionKey: "1",
		userId: 1,
		texts: t,
		redis: {
			zrem: async (_k: string, m: string) => {
				removed.push(m);
				return 1;
			},
		} as unknown as RedisClient,
		sendMessage,
	};
}

describe("dispatchScenarioOutput: отзыв согласия", () => {
	test("сбой отправки ответа не мешает пометить обращение и снять напоминание", async () => {
		calls.length = 0;
		const removed: string[] = [];
		const out = await applyScenarioText(
			{ step: "category", flow: "guide" },
			"Прошу отозвать согласие на обработку персональных данных",
			t,
		);
		if (!out) throw new Error("ожидался output");
		await expect(
			dispatchScenarioOutput(
				out,
				deps(() => Promise.reject(new Error("send failed")), removed),
			),
		).rejects.toThrow("send failed");
		expect(calls).toEqual(["tag", "note"]);
		expect(removed).toEqual(["1"]);
	});

	test("сбой записи уведомления помечает состояние для повтора, повтор его снимает", async () => {
		calls.length = 0;
		tagShouldFail = true;
		const first = await applyScenarioText(
			{ step: "category", flow: "guide" },
			"отзываю согласие",
			t,
		);
		if (!first) throw new Error("ожидался output");
		await dispatchScenarioOutput(first, deps(async () => {}));
		expect(first.state.consentFlagPending).toBe(true);

		tagShouldFail = false;
		calls.length = 0;
		const retry = await applyScenarioText(first.state, "алло", t);
		expect(retry).toBeNull(); // не отзыв — не повторяем
		const retryRevoke = await applyScenarioText(
			first.state,
			"отзываю согласие",
			t,
		);
		if (!retryRevoke) throw new Error("ожидался повтор");
		await dispatchScenarioOutput(retryRevoke, deps(async () => {}));
		expect(calls).toEqual(["tag", "note"]);
		expect(retryRevoke.state.consentFlagPending).toBeUndefined();
	});
});
