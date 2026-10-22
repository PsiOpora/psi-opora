import { describe, expect, test } from "bun:test";
import { classifyBotError, createBotSender } from "./bot-sender";
import {
	type BotTargetDeps,
	botUserIdsFromIm,
	memoizeLastPhone,
	resolveBotTargets,
} from "./bot-targets";
import { ChannelBreaker, runCascade, type SendOutcome } from "./cascade";

const PHONE = "+79990000001";

function deps(overrides: Partial<BotTargetDeps> = {}): BotTargetDeps {
	return {
		findContactIdsByPhone: async () => [],
		getContactIm: async () => [],
		listCrmLinks: async () => [],
		listScenarioDialogs: async () => [],
		botConnectorIds: { telegram: "psiopora_tg_bot", max: "psiopora_max_bot" },
		...overrides,
	};
}

describe("resolveBotTargets", () => {
	test("контакт CRM по телефону → связки бота", async () => {
		const calls: string[][] = [];
		const result = await resolveBotTargets(
			PHONE,
			deps({
				findContactIdsByPhone: async () => ["42"],
				listCrmLinks: async (ids) => {
					calls.push(ids);
					return [
						{ messenger: "max-personal", userId: "chat-9" },
						{ messenger: "telegram", userId: "111" },
						{ messenger: "max", userId: "222" },
					];
				},
			}),
		);
		expect(result).toEqual({ telegram: "111", max: "222" });
		expect(calls).toEqual([["42"]]);
	});

	test("IMOL-поле контакта с коннектором нашего бота", async () => {
		const result = await resolveBotTargets(
			PHONE,
			deps({
				findContactIdsByPhone: async () => ["42"],
				getContactIm: async () => [
					{ VALUE: "imol|psiopora_max_bot|7|333|444", VALUE_TYPE: "IMOL" },
					{ VALUE: "imol|other_connector|7|555|666", VALUE_TYPE: "IMOL" },
				],
			}),
		);
		expect(result).toEqual({ max: "333" });
	});

	test("телефон из сценария бота — без CRM", async () => {
		const result = await resolveBotTargets(
			PHONE,
			deps({
				findContactIdsByPhone: null,
				listScenarioDialogs: async () => [
					{ messenger: "telegram", userId: "777" },
				],
			}),
		);
		expect(result).toEqual({ telegram: "777" });
	});

	test("CRM упала — локальный источник остаётся, причина видна", async () => {
		const result = await resolveBotTargets(
			PHONE,
			deps({
				findContactIdsByPhone: async () => {
					throw new Error("QUERY_LIMIT_EXCEEDED");
				},
				listScenarioDialogs: async () => [
					{ messenger: "telegram", userId: "777" },
				],
			}),
		);
		expect(result.telegram).toBe("777");
		expect(result.max).toBeUndefined();
		expect(result.error).toContain("QUERY_LIMIT_EXCEEDED");
	});

	test("нашлись оба бота — ошибку CRM не показываем", async () => {
		const result = await resolveBotTargets(
			PHONE,
			deps({
				findContactIdsByPhone: async () => ["1"],
				listCrmLinks: async () => [{ messenger: "telegram", userId: "1" }],
				getContactIm: async () => {
					throw new Error("boom");
				},
				listScenarioDialogs: async () => [{ messenger: "max", userId: "2" }],
			}),
		);
		expect(result).toEqual({ telegram: "1", max: "2" });
	});
});

describe("botUserIdsFromIm", () => {
	test("поле «Мессенджер» — только числовой ID", () => {
		expect(
			botUserIdsFromIm(
				[
					{ VALUE: "12345", VALUE_TYPE: "TELEGRAM" },
					{ VALUE: "@ivan", VALUE_TYPE: "TELEGRAM" },
				],
				{},
			),
		).toEqual([{ messenger: "telegram", userId: "12345" }]);
	});
});

describe("memoizeLastPhone", () => {
	test("два бота подряд — один поиск", async () => {
		let calls = 0;
		const find = memoizeLastPhone(async () => {
			calls++;
			return {};
		});
		await find(PHONE);
		await find(PHONE);
		await find("+79990000002");
		expect(calls).toBe(2);
	});
});

describe("classifyBotError", () => {
	test.each([
		["Токен Telegram-бота не задан в БД", "channel_down"],
		["Forbidden: bot was blocked by the user", "not_found"],
		["Bad Request: chat not found", "not_found"],
		["error.dialog.suspended", "not_found"],
		["The operation timed out.", "unknown"],
		[
			"Telegram: лимит запросов (429) не снялся после 3 попыток",
			"channel_down",
		],
		["Bad Request: message is too long", "failed"],
	] as const)("%s → %s", (error, kind) => {
		expect(classifyBotError(error).kind).toBe(kind);
	});
});

describe("каскад с ботами", () => {
	test("не писал ботам — уходит с личного номера", async () => {
		const personal = {
			channel: "max" as const,
			send: async (): Promise<SendOutcome> => ({
				kind: "sent",
				userId: "chat-1",
			}),
		};
		const findTargets = async () => ({});
		const result = await runCascade({
			phone: PHONE,
			email: null,
			text: "Привет",
			senders: [
				createBotSender("max_bot", findTargets),
				createBotSender("telegram_bot", findTargets),
				personal,
			],
			breaker: new ChannelBreaker(),
			emailEnabled: false,
		});
		expect(result).toMatchObject({ status: "sent", channel: "max" });
		expect(result.attempts.map((a) => [a.channel, a.ok])).toEqual([
			["max_bot", false],
			["telegram_bot", false],
			["max", true],
		]);
	});
});
