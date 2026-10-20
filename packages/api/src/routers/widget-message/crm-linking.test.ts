import { describe, expect, mock, test } from "bun:test";
import { persistWidgetCrmLinks } from "./crm-linking";

describe("persistWidgetCrmLinks", () => {
	test("сохраняет телефон и канонический Telegram ID для первого исходящего", async () => {
		const upsert = mock(() => Promise.resolve());

		await persistWidgetCrmLinks(
			{
				portalKey: "portal.test",
				messenger: "telegram-personal",
				userId: "79870948576",
				canonicalTelegramUserId: "987654321",
				contactId: "7604",
			},
			upsert,
		);

		expect(upsert).toHaveBeenCalledTimes(2);
		expect(upsert.mock.calls.map(([entry]) => entry)).toEqual([
			{
				portalKey: "portal.test",
				messenger: "telegram-personal",
				userId: "79870948576",
				contactId: "7604",
			},
			{
				portalKey: "portal.test",
				messenger: "telegram-personal",
				userId: "987654321",
				contactId: "7604",
			},
		]);
	});

	test("не дублирует запись, если исходный userId уже канонический", async () => {
		const upsert = mock(() => Promise.resolve());

		await persistWidgetCrmLinks(
			{
				portalKey: "portal.test",
				messenger: "telegram-personal",
				userId: "987654321",
				canonicalTelegramUserId: "987654321",
				contactId: "7604",
			},
			upsert,
		);

		expect(upsert).toHaveBeenCalledTimes(1);
	});

	test("для MAX сохраняет телефон и ID личного чата", async () => {
		const upsert = mock(() => Promise.resolve());

		await persistWidgetCrmLinks(
			{
				portalKey: "portal.test",
				messenger: "max-personal",
				userId: "79870948576",
				canonicalMaxChatId: "-71234567890",
				contactId: "7604",
			},
			upsert,
		);

		expect(upsert.mock.calls.map(([entry]) => entry.userId)).toEqual([
			"79870948576",
			"-71234567890",
		]);
	});
});
