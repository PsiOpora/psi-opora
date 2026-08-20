import { beforeEach, describe, expect, mock, test } from "bun:test";

// Мокаем слой БД до импорта message-log.ts, чтобы logBotMessage никогда
// не пытался открыть настоящее сетевое соединение — только так можно
// проверить, что он передаёт в insertBotMessage корректные аргументы.
const insertBotMessage = mock(() => Promise.resolve());
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
}));

const { logBotMessage } = await import("./message-log");

describe("logBotMessage", () => {
	beforeEach(() => {
		insertBotMessage.mockClear();
	});

	test("передаёт messenger/userId/direction/source/text в insertBotMessage", async () => {
		await logBotMessage({
			messenger: "telegram",
			userId: 100,
			direction: "in",
			source: "scenario",
			text: "  привет  ",
		});

		expect(insertBotMessage).toHaveBeenCalledTimes(1);
		expect(insertBotMessage).toHaveBeenCalledWith({
			messenger: "telegram",
			userId: "100",
			direction: "in",
			source: "scenario",
			text: "привет",
		});
	});

	test("userId-строка (MAX) передаётся как есть", async () => {
		await logBotMessage({
			messenger: "max",
			userId: "555",
			direction: "out",
			source: "reminder",
			text: "напоминание",
		});

		expect(insertBotMessage).toHaveBeenCalledWith(
			expect.objectContaining({ messenger: "max", userId: "555" }),
		);
	});

	test("пропускает запись без userId", async () => {
		await logBotMessage({
			messenger: "telegram",
			userId: undefined,
			direction: "in",
			source: "scenario",
			text: "текст",
		});
		expect(insertBotMessage).not.toHaveBeenCalled();
	});

	test("пропускает запись с пустым текстом", async () => {
		await logBotMessage({
			messenger: "telegram",
			userId: 1,
			direction: "out",
			source: "widget",
			text: "   ",
		});
		expect(insertBotMessage).not.toHaveBeenCalled();
	});

	test("ошибка записи в БД не пробрасывается — диалог не должен падать", async () => {
		insertBotMessage.mockImplementationOnce(() =>
			Promise.reject(new Error("connection refused")),
		);

		await expect(
			logBotMessage({
				messenger: "telegram",
				userId: 1,
				direction: "in",
				source: "scenario",
				text: "текст",
			}),
		).resolves.toBeUndefined();
	});
});
