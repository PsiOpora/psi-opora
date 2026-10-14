import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	createEmailEventsHandlers,
	mapUnisenderStatus,
	parseRusenderEvents,
	verifyUnisenderAuth,
} from "../src/email-events-webhook";

// Зависимости подставляются фейками, без mock.module: моки модулей в bun
// глобальны на весь прогон и ломали бы соседние тестовые файлы.
const enqueued: unknown[][] = [];
let rusenderSecret: string | null = "s3cret-value";
const UNISENDER_KEY = "uni-api-key";

const handlers = createEmailEventsHandlers({
	getRusenderWebhookSecret: async () => rusenderSecret,
	getUnisenderApiKey: async () => UNISENDER_KEY,
	enqueue: async (events) => {
		enqueued.push(events);
	},
});

beforeEach(() => {
	enqueued.length = 0;
	rusenderSecret = "s3cret-value";
});

const rusenderBody = {
	count: 3,
	events: [
		{
			eventId: "ev-1",
			trigger: "external_mail.delivered",
			occurredAt: "2026-10-14T10:00:00Z",
			payload: { taskId: "task-1", email: "Ivan@Mail.ru" },
		},
		{
			eventId: "ev-2",
			trigger: "external_mail.hard_bounced",
			occurredAt: "2026-10-14T10:01:00Z",
			payload: {
				taskId: "task-2",
				email: "x@y.ru",
				smtpServerResponse: "550 5.1.1 user unknown",
			},
		},
		{
			eventId: "ev-3",
			trigger: "mail_distribution.started",
			occurredAt: "2026-10-14T10:02:00Z",
			payload: {},
		},
	],
};

describe("parseRusenderEvents", () => {
	test("маппит события external_mail и пропускает чужие", () => {
		const events = parseRusenderEvents(rusenderBody);
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			provider: "rusender",
			externalId: "ev-1",
			type: "delivered",
			email: "ivan@mail.ru",
			match: { providerMessageId: "task-1" },
		});
		expect(events[1]).toMatchObject({
			type: "bounced",
			details: "550 5.1.1 user unknown",
		});
	});

	test("мусорное тело даёт пустой список", () => {
		expect(parseRusenderEvents({ foo: 1 })).toEqual([]);
		expect(parseRusenderEvents(null)).toEqual([]);
	});
});

describe("handleRusenderEmailWebhook", () => {
	const request = () =>
		new Request("http://localhost/api/email-events/rusender/x", {
			method: "POST",
			body: JSON.stringify(rusenderBody),
			headers: { "content-type": "application/json" },
		});

	test("неверный секрет — 403 и ничего не ставится в очередь", async () => {
		const res = await handlers.rusender(request(), "wrong");
		expect(res.status).toBe(403);
		expect(enqueued).toHaveLength(0);
	});

	test("секрет не настроен — 403", async () => {
		rusenderSecret = null;
		const res = await handlers.rusender(request(), "");
		expect(res.status).toBe(403);
	});

	test("верный секрет — события в очереди", async () => {
		const res = await handlers.rusender(request(), "s3cret-value");
		expect(res.status).toBe(200);
		expect(enqueued).toHaveLength(1);
	});
});

function signUnisender(body: Record<string, unknown>): string {
	const withKey = JSON.stringify({ ...body, auth: UNISENDER_KEY });
	const auth = createHash("md5").update(withKey).digest("hex");
	return withKey.replace(UNISENDER_KEY, auth);
}

const unisenderBody = {
	auth: "",
	events_by_user: [
		{
			login: "user",
			events: [
				{
					event_name: "email_status",
					event_time: "2026-10-14 10:00:00",
					event_data: {
						email: "Ivan@Mail.ru",
						campaign_id: 12345,
						status: "ok_read",
					},
				},
				{
					event_name: "unsubscribe",
					event_time: "2026-10-14 10:05:00",
					event_data: { email: "ivan@mail.ru", campaign_id: "12345" },
				},
			],
		},
	],
};

describe("verifyUnisenderAuth", () => {
	test("принимает корректную подпись", () => {
		const raw = signUnisender(unisenderBody);
		const auth = (JSON.parse(raw) as { auth: string }).auth;
		expect(verifyUnisenderAuth(raw, auth, UNISENDER_KEY)).toBe(true);
	});

	test("отклоняет подделанное тело", () => {
		const raw = signUnisender(unisenderBody);
		const auth = (JSON.parse(raw) as { auth: string }).auth;
		const tampered = raw.replace("ok_read", "ok_link_visited");
		expect(verifyUnisenderAuth(tampered, auth, UNISENDER_KEY)).toBe(false);
	});

	test("отклоняет не-MD5 значение", () => {
		expect(verifyUnisenderAuth("{}", UNISENDER_KEY, UNISENDER_KEY)).toBe(false);
	});
});

describe("handleUnisenderEmailWebhook", () => {
	test("подписанный запрос ставит события в очередь", async () => {
		const res = await handlers.unisender(
			new Request("http://localhost/api/email-events/unisender", {
				method: "POST",
				body: signUnisender(unisenderBody),
			}),
		);
		expect(res.status).toBe(200);
		const payload = {
			events: enqueued[0] as Array<{
				type: string;
				match: unknown;
				externalId: string;
			}>,
		};
		expect(payload.events.map((e) => e.type)).toEqual([
			"opened",
			"unsubscribed",
		]);
		expect(payload.events[0]?.match).toEqual({
			unisenderCampaignId: "12345",
			email: "ivan@mail.ru",
		});
		expect(payload.events[0]?.externalId).toMatch(/^[0-9a-f]{64}$/);
	});

	test("неподписанный запрос — 403", async () => {
		const res = await handlers.unisender(
			new Request("http://localhost/api/email-events/unisender", {
				method: "POST",
				body: JSON.stringify({ ...unisenderBody, auth: "0".repeat(32) }),
			}),
		);
		expect(res.status).toBe(403);
		expect(enqueued).toHaveLength(0);
	});
});

describe("mapUnisenderStatus", () => {
	test.each([
		["ok_delivered", "delivered"],
		["ok_link_visited", "clicked"],
		["err_will_retry", "soft_bounced"],
		["err_user_unknown", "bounced"],
		["ok_fbl", "complained"],
		["err_spam_rejected", "failed"],
		["something_new", null],
	])("%s → %s", (status, expected) => {
		expect(mapUnisenderStatus(status)).toBe(expected as never);
	});
});
