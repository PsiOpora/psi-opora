import { describe, expect, mock, test } from "bun:test";
import { persistSentMessage } from "./send-result";

const message = {
	messenger: "telegram",
	userId: "123",
	direction: "out" as const,
	source: "widget" as const,
	text: "test",
};

describe("persistSentMessage", () => {
	test("returns a partial failure when insertBotMessage rejects", async () => {
		const insertBotMessage = mock(() =>
			Promise.reject(new Error("database unavailable")),
		);

		const result = await persistSentMessage(message, insertBotMessage);

		expect(insertBotMessage).toHaveBeenCalledWith(message);
		expect(result).toEqual({
			ok: false,
			error:
				"Сообщение отправлено, но не удалось сохранить его в истории. Обновите диалог перед повторной отправкой.",
		});
	});

	test("does not report success when insertBotMessage returns no id", async () => {
		const result = await persistSentMessage(
			message,
			mock(() => Promise.resolve(undefined)),
		);

		expect(result.ok).toBe(false);
	});
});
