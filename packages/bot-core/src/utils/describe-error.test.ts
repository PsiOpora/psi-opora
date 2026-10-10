import { describe, expect, test } from "bun:test";
import { HttpError } from "grammy";
import { describeError, isGrammyNetworkError } from "./describe-error";

describe("describeError", () => {
	test("раскрывает исходную ошибку fetch из HttpError grammY", () => {
		const cause = Object.assign(new Error("socket hang up"), {
			code: "ECONNRESET",
		});
		const err = new HttpError("Network request for 'getChat' failed!", cause);
		expect(describeError(err)).toBe(
			"Network request for 'getChat' failed! (cause: socket hang up [ECONNRESET])",
		);
		expect(isGrammyNetworkError(err)).toBe(true);
	});

	test("идёт по цепочке cause", () => {
		const err = new TypeError("fetch failed", {
			cause: new Error("getaddrinfo ENOTFOUND api.telegram.org"),
		});
		expect(describeError(err)).toBe(
			"fetch failed (cause: getaddrinfo ENOTFOUND api.telegram.org)",
		);
		expect(isGrammyNetworkError(err)).toBe(false);
	});

	test("не-Error приводит к строке", () => {
		expect(describeError("boom")).toBe("boom");
	});
});
