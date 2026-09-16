import { beforeEach, describe, expect, mock, test } from "bun:test";

const callBitrix = mock(async () => 321);

mock.module("@psi-opora/bitrix-client", () => ({
	resolveBitrixApi: () => ({ call: callBitrix }),
}));
mock.module("@psi-opora/config", () => ({
	env: {
		BITRIX_MEMBER_ID: "test-member",
		SITE_LEAD_WEBHOOK_SECRET: "test-secret",
	},
}));

const { handleSiteLeadWebhook } = await import("../src/site-lead-webhook");

function request(body: BodyInit, headers: HeadersInit = {}): Request {
	return new Request("https://example.test/api/site-lead-webhook", {
		method: "POST",
		headers: {
			Authorization: "Bearer test-secret",
			...headers,
		},
		body,
	});
}

describe("site lead webhook", () => {
	beforeEach(() => callBitrix.mockClear());

	test("принимает секрет только из Authorization", async () => {
		const response = await handleSiteLeadWebhook(
			new Request(
				"https://example.test/api/site-lead-webhook?token=test-secret",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ phone: "+79991234567" }),
				},
			),
		);

		expect(response.status).toBe(401);
		expect(callBitrix).not.toHaveBeenCalled();
	});

	test("распознаёт нормализованный JSON-ключ phone_number", async () => {
		const response = await handleSiteLeadWebhook(
			request(
				JSON.stringify({
					fields: {
						name: { value: "Анна" },
						phone_number: { value: "+79991234567" },
					},
				}),
				{ "Content-Type": "application/json" },
			),
		);

		expect(response.status).toBe(200);
		expect(callBitrix).toHaveBeenCalledTimes(1);
		expect(callBitrix.mock.calls[0]?.[1]).toMatchObject({
			fields: {
				NAME: "Анна",
				PHONE: [{ VALUE: "+79991234567", VALUE_TYPE: "WORK" }],
			},
		});
	});

	test("принимает валидное form-urlencoded тело", async () => {
		const response = await handleSiteLeadWebhook(
			request("name=Анна&phone_number=%2B79991234567", {
				"Content-Type": "application/x-www-form-urlencoded",
			}),
		);

		expect(response.status).toBe(200);
		expect(callBitrix).toHaveBeenCalledTimes(1);
	});

	test("отклоняет невалидное JSON-тело", async () => {
		const malformed = await handleSiteLeadWebhook(
			request("{", { "Content-Type": "application/json" }),
		);
		const unsupportedField = await handleSiteLeadWebhook(
			request(JSON.stringify({ phone: true }), {
				"Content-Type": "application/json",
			}),
		);

		expect(malformed.status).toBe(400);
		expect(unsupportedField.status).toBe(400);
		expect(callBitrix).not.toHaveBeenCalled();
	});
});
