import { beforeEach, describe, expect, mock, test } from "bun:test";

// Мокаем слой БД до импорта бота: иначе logBotMessage/getScenarioTexts
// пытались бы открыть настоящее сетевое соединение на каждый шаг сценария —
// это и медленно, и не даёт проверить, что журнал сообщений пишется верно.
interface LoggedMessage {
	messenger: string;
	userId: string;
	direction: "in" | "out";
	source: string;
	text: string;
}
const insertBotMessage = mock((entry: LoggedMessage) => Promise.resolve(entry));
mock.module("@psi-opora/db/queries", () => ({
	insertBotMessage,
	getBitrixCrmLink: () => Promise.resolve(null),
	getBotTextsRecord: () => Promise.resolve({}),
	getBotConnector: () => Promise.resolve(null),
	getBotUserProfile: () => Promise.resolve(null),
	getConversationMeta: () => Promise.resolve(null),
	addClientNote: () => Promise.resolve(null),
	addConversationTag: () => Promise.resolve(),
	upsertBotFunnelEvent: () => Promise.resolve(),
	upsertBitrixCrmLink: () => Promise.resolve(),
	upsertBotUser: () => Promise.resolve(),
	getYandexMetrikaSettings: () => Promise.resolve(null),
}));

const { createBot } = await import("./bot");
const { DEFAULT_SCENARIO_TEXTS: t } = await import("./scenario/texts");

beforeEach(() => {
	insertBotMessage.mockClear();
});

interface SentCall {
	method: string;
	// biome-ignore lint/suspicious/noExplicitAny: сырые payload'ы Bot API
	payload: any;
}

/** Бот с замоканным Bot API: вызовы копятся в sent, сеть не трогается. */
function makeBot() {
	const bot = createBot({
		token: "1:TEST_TOKEN",
		// Эти тесты проверяют сценарий и журнал, а не реальный Bitrix.
		enrichCrm: () => Promise.resolve(),
	});
	bot.botInfo = {
		id: 42,
		is_bot: true,
		first_name: "Опора",
		username: "opora_test_bot",
		can_join_groups: true,
		can_read_all_group_messages: false,
		supports_inline_queries: false,
		can_connect_to_business: false,
		has_main_web_app: false,
	};

	const sent: SentCall[] = [];
	bot.api.config.use(async (_prev, method, payload) => {
		sent.push({ method, payload });
		const result = method === "sendMessage" ? { message_id: 1 } : true;
		// biome-ignore lint/suspicious/noExplicitAny: мок транспорта grammy
		return { ok: true, result } as any;
	});

	return { bot, sent };
}

const chat = { id: 100, type: "private" as const, first_name: "U" };
const from = { id: 100, is_bot: false, first_name: "U" };

function commandUpdate(text: string, updateId = 1) {
	return {
		update_id: updateId,
		message: {
			message_id: updateId,
			date: 0,
			chat,
			from,
			text,
			entities: [
				{
					type: "bot_command" as const,
					offset: 0,
					length: (text.split(" ")[0] ?? text).length,
				},
			],
		},
	};
}

function textUpdate(text: string, updateId = 1) {
	return {
		update_id: updateId,
		message: { message_id: updateId, date: 0, chat, from, text },
	};
}

function callbackUpdate(data: string, updateId = 2) {
	return {
		update_id: updateId,
		callback_query: {
			id: `cb${updateId}`,
			from,
			chat_instance: "ci",
			data,
			message: { message_id: 5, date: 0, chat, from },
		},
	};
}

function sentMessages(sent: SentCall[]): SentCall[] {
	return sent.filter((call) => call.method === "sendMessage");
}

describe("телеграм-бот: /start", () => {
	test("отправляет приветствие с кнопками «Записаться» и «Получить гайд»", async () => {
		const { bot, sent } = makeBot();
		await bot.handleUpdate(commandUpdate("/start"));

		const messages = sentMessages(sent);
		expect(messages.map((m) => m.payload.text)).toEqual([t.welcome]);
		const keyboard = messages[0]?.payload.reply_markup?.inline_keyboard;
		expect(
			keyboard?.flat().map((b: { callback_data: string }) => b.callback_data),
		).toEqual(["sc_consult", "sc_guide"]);
	});

	test("/start с utm-меткой тоже запускает сценарий", async () => {
		const { bot, sent } = makeBot();
		await bot.handleUpdate(
			commandUpdate("/start utm_source=google&utm_campaign=test"),
		);
		expect(sentMessages(sent).length).toBe(1);
	});

	test("флоу гайда кнопками: гайд → согласие → согласие на рекламу → категория → тема → email", async () => {
		const { bot, sent } = makeBot();
		await bot.handleUpdate(commandUpdate("/start"));
		await bot.handleUpdate(callbackUpdate("sc_guide", 2));
		await bot.handleUpdate(callbackUpdate("consent_agree", 3));
		await bot.handleUpdate(callbackUpdate("marketing_consent_agree", 4));
		await bot.handleUpdate(callbackUpdate("sc_child", 5));
		await bot.handleUpdate(callbackUpdate("sc_eating", 6));

		const texts = sentMessages(sent).map((m) => m.payload.text);
		expect(texts).toEqual([
			t.welcome,
			t.consent_text,
			t.consent_agreed,
			t.marketing_consent_text,
			t.marketing_consent_agreed,
			t.category_question,
			t.issue_question,
			t.email_question,
		]);
	});

	test("флоу консультации: согласие → согласие на рекламу → имя → телефон → email → заявка", async () => {
		const { bot, sent } = makeBot();
		await bot.handleUpdate(commandUpdate("/start"));
		await bot.handleUpdate(callbackUpdate("sc_consult", 2));
		await bot.handleUpdate(callbackUpdate("consent_agree", 3));
		await bot.handleUpdate(callbackUpdate("marketing_consent_agree", 4));
		await bot.handleUpdate(textUpdate("Анна", 5));
		await bot.handleUpdate(textUpdate("+7 999 123-45-67", 6));
		await bot.handleUpdate(textUpdate("anna@example.com", 7));

		const texts = sentMessages(sent).map((m) => m.payload.text);
		expect(texts[0]).toBe(t.welcome);
		expect(texts[1]).toBe(t.consent_text);
		expect(texts[2]).toBe(t.consent_agreed);
		expect(texts[3]).toBe(t.marketing_consent_text);
		expect(texts[4]).toBe(t.marketing_consent_agreed);
		expect(texts[5]).toBe(t.name_question);
		expect(texts[6]).toContain("Анна");
		expect(texts[7]).toBe(t.consult_email_question);
		expect(texts[8]).toContain("Заявка принята");
	});
});

describe("телеграм-бот: кнопки старого сценария", () => {
	test("«Записаться на консультацию» открывает согласие на ПДн", async () => {
		const { bot, sent } = makeBot();
		await bot.handleUpdate(callbackUpdate("start_consultation"));

		expect(sent.some((c) => c.method === "answerCallbackQuery")).toBe(true);
		expect(sentMessages(sent).map((m) => m.payload.text)).toEqual([
			t.consent_text,
		]);
	});

	test("старое согласие без активного сценария показывает согласие заново", async () => {
		const { bot, sent } = makeBot();
		await bot.handleUpdate(callbackUpdate("consent_agree"));
		expect(sentMessages(sent).map((m) => m.payload.text)).toEqual([
			t.consent_text,
		]);
	});

	test("отказ от согласия без активного сценария молча игнорируется", async () => {
		const { bot, sent } = makeBot();
		await bot.handleUpdate(callbackUpdate("consent_decline"));
		expect(sent.some((c) => c.method === "answerCallbackQuery")).toBe(true);
		expect(sentMessages(sent)).toEqual([]);
	});
});

describe("телеграм-бот: журнал сообщений (bot_messages)", () => {
	test("логирует входящие и исходящие на каждом шаге флоу консультации", async () => {
		const { bot } = makeBot();
		await bot.handleUpdate(commandUpdate("/start"));
		await bot.handleUpdate(callbackUpdate("sc_consult", 2));
		await bot.handleUpdate(callbackUpdate("consent_agree", 3));
		await bot.handleUpdate(callbackUpdate("marketing_consent_agree", 4));
		await bot.handleUpdate(textUpdate("Анна", 5));
		await bot.handleUpdate(textUpdate("+7 999 123-45-67", 6));
		await bot.handleUpdate(textUpdate("anna@example.com", 7));

		const calls = insertBotMessage.mock.calls.map(([entry]) => entry);
		for (const entry of calls) {
			expect(entry.messenger).toBe("telegram");
			expect(entry.userId).toBe("100");
			expect(entry.source).toBe("scenario");
		}

		expect(calls.map((e) => e.direction)).toEqual([
			"in",
			"out",
			"in",
			"out",
			"in",
			"out",
			"in",
			"out",
			"out",
			"in",
			"out",
			"in",
			"out",
			"in",
			"out",
		]);

		const texts = calls.map((e) => e.text);
		expect(texts[0]).toBe("/start");
		expect(texts[1]).toBe(t.welcome);
		expect(texts[2]).toBe(t.btn_consult);
		expect(texts[3]).toBe(t.consent_text);
		expect(texts[4]).toBe(t.btn_consent_agree);
		expect(texts[5]).toBe(t.consent_agreed);
		expect(texts[6]).toBe(t.btn_marketing_consent_agree);
		expect(texts[7]).toBe(t.marketing_consent_agreed);
		expect(texts[8]).toBe(t.name_question);
		expect(texts[9]).toBe("Анна");
		expect(texts[10]).toContain("Анна");
		expect(texts[11]).toBe("+7 999 123-45-67");
		expect(texts[12]).toBe(t.consult_email_question);
		expect(texts[13]).toBe("anna@example.com");
		expect(texts[14]).toContain("Заявка принята");
	});

	test("кнопка запускает журнал с человекочитаемой подписью, а не с кодом action", async () => {
		const { bot } = makeBot();
		await bot.handleUpdate(commandUpdate("/start"));
		await bot.handleUpdate(callbackUpdate("sc_guide", 2));

		const inbound = insertBotMessage.mock.calls
			.map(([entry]) => entry)
			.filter((e) => e.direction === "in");
		expect(inbound.map((e) => e.text)).toEqual(["/start", t.btn_guide]);
	});
});
