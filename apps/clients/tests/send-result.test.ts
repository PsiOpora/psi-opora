import { describe, expect, test } from "bun:test";
import {
	getSendResultError,
	isSuccessfulSendResult,
} from "../src/components/inbox/send-result";

describe("send result handling", () => {
	test("does not treat a persistence failure as ordinary success", () => {
		const result = {
			ok: false,
			error: "Сообщение отправлено, но не сохранено",
		};

		expect(isSuccessfulSendResult(result)).toBe(false);
		expect(getSendResultError(result)).toBe(result.error);
	});

	test("requires an id for every successful response", () => {
		expect(isSuccessfulSendResult({ ok: true })).toBe(false);
		expect(isSuccessfulSendResult({ ok: true, id: "message-1" })).toBe(true);
	});
});
