import { describe, expect, test } from "bun:test";
import { formatMessengerError } from "./messenger-errors";

describe("formatMessengerError", () => {
	test("explains a suspended MAX dialog to the operator", () => {
		expect(
			formatMessengerError("Key: error.dialog.suspended, args: [28293695,]."),
		).toBe(
			"Клиент остановил бота в MAX — отправка станет доступна, когда клиент снова запустит бота",
		);
	});

	test("keeps an unknown error unchanged", () => {
		expect(formatMessengerError("Unknown API error")).toBe("Unknown API error");
	});
});
