import { describe, expect, test } from "bun:test";
import {
	INIT_DATA_MAX_AGE_SEC,
	signInitData,
	verifyMaxInitData,
} from "./init-data";

const TOKEN = "test-bot-token";
const NOW = 1_800_000_000;

function makeInitData(fields: Record<string, string>, token = TOKEN): string {
	const params = new URLSearchParams(fields);
	params.set("hash", signInitData(params, token));
	return params.toString();
}

const user = JSON.stringify({ id: 67890, first_name: "Мария" });

describe("verifyMaxInitData", () => {
	test("принимает корректно подписанные данные", () => {
		const initData = makeInitData({
			auth_date: String(NOW - 60),
			query_id: "abc",
			user,
			start_param: "vk",
		});
		expect(verifyMaxInitData(initData, TOKEN, NOW)).toEqual({
			user: { id: 67890, first_name: "Мария" },
			authDate: NOW - 60,
			startParam: "vk",
		});
	});

	test("отклоняет подпись другим токеном", () => {
		const initData = makeInitData(
			{ auth_date: String(NOW), user },
			"other-token",
		);
		expect(verifyMaxInitData(initData, TOKEN, NOW)).toBeNull();
	});

	test("отклоняет подменённого пользователя", () => {
		const initData = makeInitData({ auth_date: String(NOW), user }).replace(
			"67890",
			"11111",
		);
		expect(verifyMaxInitData(initData, TOKEN, NOW)).toBeNull();
	});

	test("отклоняет устаревшие данные", () => {
		const initData = makeInitData({
			auth_date: String(NOW - INIT_DATA_MAX_AGE_SEC - 1),
			user,
		});
		expect(verifyMaxInitData(initData, TOKEN, NOW)).toBeNull();
	});

	test("отклоняет данные без подписи или пользователя", () => {
		expect(verifyMaxInitData("", TOKEN, NOW)).toBeNull();
		expect(
			verifyMaxInitData(`auth_date=${NOW}&user=${user}`, TOKEN, NOW),
		).toBeNull();
		expect(
			verifyMaxInitData(makeInitData({ auth_date: String(NOW) }), TOKEN, NOW),
		).toBeNull();
	});
});
