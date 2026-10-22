import { describe, expect, test } from "bun:test";
import { parseReadMark } from "./relay";

const now = new Date("2026-10-22T12:00:00Z");

describe("parseReadMark", () => {
	test("формат PyMax: chatId, userId, mark — время в мс", () => {
		const mark = Date.UTC(2026, 9, 22, 11, 59);
		expect(
			parseReadMark(
				{ chatId: 123, userId: 456, mark, setAsUnread: false },
				now,
			),
		).toMatchObject({
			chatId: "123",
			userId: "456",
			readAt: new Date(mark),
			setAsUnread: false,
		});
	});

	test("mark похож на ID сообщения, а не на время — не прочтение", () => {
		const event = parseReadMark(
			{ chatId: 123, userId: 456, mark: 115_000_000_000_000_000 },
			now,
		);
		expect(event.readAt).toBeNull();
	});

	test("неожиданная раскладка — поля null, без исключений", () => {
		expect(parseReadMark({ foo: "bar" }, now)).toMatchObject({
			chatId: null,
			userId: null,
			readAt: null,
			setAsUnread: false,
		});
	});

	test("отметка «непрочитано»", () => {
		const event = parseReadMark(
			{ chatId: 1, userId: 2, mark: now.getTime(), setAsUnread: true },
			now,
		);
		expect(event.setAsUnread).toBe(true);
	});
});
