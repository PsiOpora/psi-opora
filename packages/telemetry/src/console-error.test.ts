import { describe, expect, test } from "bun:test";
import { buildConsoleErrorReport } from "./console-error";

describe("buildConsoleErrorReport", () => {
	test("строка logger.error: стек и метаданные из JSON", () => {
		const line = JSON.stringify({
			level: "error",
			time: "2026-10-23T10:00:00.000Z",
			msg: "Bitrix sync failed",
			name: "TypeError",
			message: "fetch failed",
			stack: "TypeError: fetch failed\n    at sync (sync.ts:1:1)",
			portal: "psi.bitrix24.ru",
			attempt: 3,
		});

		const report = buildConsoleErrorReport([line], "call-site");

		expect(report.name).toBe("Bitrix sync failed");
		expect(report.exception).toEqual({
			name: "TypeError",
			message: "Bitrix sync failed: fetch failed",
			stack: "TypeError: fetch failed\n    at sync (sync.ts:1:1)",
		});
		expect(report.attributes).toEqual({
			"log.portal": "psi.bitrix24.ru",
			"log.attempt": 3,
		});
	});

	test("logger.error без ошибки берёт стек места вызова", () => {
		const line = JSON.stringify({ level: "error", msg: "No connector" });

		const report = buildConsoleErrorReport([line], "call-site");

		expect(report.exception).toEqual({
			name: "LoggedError",
			message: "No connector",
			stack: "call-site",
		});
	});

	test("JSON не уровня error считается обычным текстом", () => {
		const line = JSON.stringify({ level: "info", msg: "hello" });

		const report = buildConsoleErrorReport([line], "call-site");

		expect(report.exception.name).toBe("ConsoleError");
		expect(report.exception.message).toBe(line);
	});

	test("текст + Error: текст — контекст, стек из Error", () => {
		const error = Object.assign(new Error("Bad Request: chat not found"), {
			error_code: 400,
			payload: { nested: true },
			cause: new Error("socket hang up"),
		});

		const report = buildConsoleErrorReport(
			["[BOT] unhandledRejection:", error],
			"call-site",
		);

		expect(report.name).toBe("[BOT] unhandledRejection");
		expect(report.exception.name).toBe("Error");
		expect(report.exception.message).toBe(
			"[BOT] unhandledRejection: Bad Request: chat not found",
		);
		expect(report.exception.stack).toBe(error.stack);
		expect(report.attributes["error.error_code"]).toBe("400");
		expect(report.attributes["error.payload"]).toBeUndefined();
		expect(report.attributes["exception.cause"]).toContain("socket hang up");
	});

	test("только Error: имя из типа и первой строки сообщения", () => {
		const error = new RangeError("too big\nmore details");

		const report = buildConsoleErrorReport([error]);

		expect(report.name).toBe("RangeError: too big");
		expect(report.exception.message).toBe("too big\nmore details");
	});

	test("текст без Error форматируется как console", () => {
		const report = buildConsoleErrorReport(
			["Ошибка отправки в линию %s", "42", { code: "LINE_NOT_FOUND" }],
			"call-site",
		);

		expect(report.exception.name).toBe("ConsoleError");
		expect(report.exception.message).toBe(
			"Ошибка отправки в линию 42 { code: 'LINE_NOT_FOUND' }",
		);
		expect(report.exception.stack).toBe("call-site");
	});

	test("длинные сообщения обрезаются", () => {
		const report = buildConsoleErrorReport(["x".repeat(10_000)]);

		expect(report.name.length).toBe(201);
		expect(report.exception.message.length).toBe(4001);
	});
});
