import { describe, expect, test } from "bun:test";
import type { BotMessage } from "@psi-opora/db/queries";
import { toClientMessageItem } from "../src/routers/messages/types";

function message(overrides: Partial<BotMessage> = {}): BotMessage {
	const now = new Date();
	return {
		id: "message-1",
		messenger: "max",
		userId: "32263492",
		direction: "out",
		source: "widget",
		text: "Секретный текст",
		kind: "text",
		mediaS3Key: null,
		mediaMimeType: null,
		mediaDurationSec: null,
		operatorId: "17",
		operatorName: "Оператор",
		status: "sent",
		externalId: "external-1",
		externalChatId: null,
		bitrixMessageId: null,
		bitrixExternalId: "operator-17-1",
		connectorId: null,
		createdAt: now,
		updatedAt: now,
		editedAt: null,
		deletedAt: null,
		deletedByOperatorId: null,
		...overrides,
	};
}

describe("message deletion presentation", () => {
	test("разрешает владельцу удалить исходящее сообщение всех каналов", () => {
		for (const messenger of [
			"telegram",
			"max",
			"telegram-personal",
			"whatsapp-personal",
		]) {
			expect(toClientMessageItem(message({ messenger }), "17").canDelete).toBe(
				true,
			);
		}
	});

	test("не разрешает удалять чужое или просроченное Telegram Bot сообщение", () => {
		expect(toClientMessageItem(message(), "18").canDelete).toBe(false);
		expect(
			toClientMessageItem(
				message({
					messenger: "telegram",
					createdAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
				}),
				"17",
			).canDelete,
		).toBe(false);
	});

	test("скрывает содержание и медиа после удаления", () => {
		const item = toClientMessageItem(
			message({
				deletedAt: new Date(),
				deletedByOperatorId: "17",
				mediaS3Key: "bot/media/private.ogg",
			}),
			"17",
		);

		expect(item.text).toBe("Сообщение удалено");
		expect(item.mediaUrl).toBeUndefined();
		expect(item.canEdit).toBe(false);
		expect(item.canDelete).toBe(false);
		expect(item.deletedAt).not.toBeNull();
	});
});
