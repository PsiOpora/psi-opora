import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NewAdTouch } from "@psi-opora/db/queries";
import {
	createTrackTouchHandler,
	parseAllowedOrigins,
} from "../src/track-touch";

const SITE = "https://psi-opora.ru";
const saved: NewAdTouch[] = [];
const saveTouch = mock(async (touch: NewAdTouch) => {
	saved.push(touch);
});

function post(
	body: unknown,
	headers: Record<string, string> = {},
	method = "POST",
) {
	return new Request("https://hooks.example/api/track-touch", {
		method,
		headers: { origin: SITE, "x-forwarded-for": "1.2.3.4", ...headers },
		body: method === "POST" ? JSON.stringify(body) : undefined,
	});
}

const validBody = {
	clientId: "163972457524306386",
	utm_source: "yandex",
	utm_medium: "cpc",
	utm_campaign: "search_anorexia_708811857",
	utm_content: "17000000123",
	landingUrl: "https://psi-opora.ru/anorexia/",
};

describe("POST /api/track-touch", () => {
	let handler: ReturnType<typeof createTrackTouchHandler>;
	let nowMs: number;

	beforeEach(() => {
		saved.length = 0;
		saveTouch.mockClear();
		nowMs = Date.parse("2026-10-09T10:00:00Z");
		handler = createTrackTouchHandler({
			saveTouch,
			allowedOrigins: [SITE],
			now: () => nowMs,
		});
	});

	test("сохраняет касание и отвечает 204 с CORS для сайта", async () => {
		const res = await handler(post(validBody));
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatchObject({
			ymClientId: "163972457524306386",
			utmSource: "yandex",
			adCampaignId: "708811857",
			adId: "17000000123",
			landingUrl: "https://psi-opora.ru/anorexia/",
			occurredAt: new Date(nowMs),
		});
	});

	test("принимает text/plain от sendBeacon (тело — JSON-строка)", async () => {
		const req = new Request("https://hooks.example/api/track-touch", {
			method: "POST",
			headers: { origin: SITE, "content-type": "text/plain;charset=UTF-8" },
			body: JSON.stringify(validBody),
		});
		expect((await handler(req)).status).toBe(204);
		expect(saved).toHaveLength(1);
	});

	test("preflight для разрешённого сайта", async () => {
		const res = await handler(post(undefined, {}, "OPTIONS"));
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-methods")).toContain("POST");
		expect(saveTouch).not.toHaveBeenCalled();
	});

	test("чужой Origin — 403 и без записи", async () => {
		const res = await handler(
			post(validBody, { origin: "https://evil.example" }),
		);
		expect(res.status).toBe(403);
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
		expect(saveTouch).not.toHaveBeenCalled();
	});

	test("запрос без Origin (curl, серверный вызов) не отсекается", async () => {
		const req = new Request("https://hooks.example/api/track-touch", {
			method: "POST",
			body: JSON.stringify(validBody),
		});
		expect((await handler(req)).status).toBe(204);
		expect(saved).toHaveLength(1);
	});

	test("битый JSON и неверная форма — 400", async () => {
		const broken = new Request("https://hooks.example/api/track-touch", {
			method: "POST",
			headers: { origin: SITE },
			body: "{not json",
		});
		expect((await handler(broken)).status).toBe(400);
		expect((await handler(post(["массив"]))).status).toBe(400);
		expect(saveTouch).not.toHaveBeenCalled();
	});

	test("слишком большое тело — 413", async () => {
		const res = await handler(
			post({ ...validBody, utm_term: "x".repeat(5000) }),
		);
		expect(res.status).toBe(413);
		expect(saveTouch).not.toHaveBeenCalled();
	});

	test("заход без рекламных признаков — 204, но ничего не пишем", async () => {
		const res = await handler(post({ clientId: "163972457524306386" }));
		expect(res.status).toBe(204);
		expect(saveTouch).not.toHaveBeenCalled();
	});

	test("после 60 запросов в минуту с одного IP — 429, с другого IP — по-прежнему ок", async () => {
		for (let i = 0; i < 60; i++) {
			expect((await handler(post(validBody))).status).toBe(204);
		}
		expect((await handler(post(validBody))).status).toBe(429);
		expect(
			(await handler(post(validBody, { "x-forwarded-for": "5.6.7.8" }))).status,
		).toBe(204);
		// окно сбрасывается
		nowMs += 61_000;
		expect((await handler(post(validBody))).status).toBe(204);
	});

	test("сбой БД — 500, без утечки деталей", async () => {
		const failing = createTrackTouchHandler({
			saveTouch: async () => {
				throw new Error("connection refused");
			},
			allowedOrigins: [SITE],
		});
		const res = await failing(post(validBody));
		expect(res.status).toBe(500);
		expect(await res.text()).toBe("");
	});
});

describe("parseAllowedOrigins", () => {
	test("делит по запятой, убирает пробелы и хвостовой слэш", () => {
		expect(
			parseAllowedOrigins(" https://a.ru/ , https://www.a.ru ,, "),
		).toEqual(["https://a.ru", "https://www.a.ru"]);
	});

	test("по умолчанию — боевой сайт", () => {
		expect(parseAllowedOrigins(undefined)).toContain("https://psi-opora.ru");
	});
});
