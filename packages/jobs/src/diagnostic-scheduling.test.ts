import { afterEach, describe, expect, it } from "bun:test";
import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import {
	buildImmediateDiagnosticMessage,
	DIAGNOSTIC_JOIN_URL,
	findContactEmail,
	handleDiagnosticDealUpdate,
	PAID_DIAGNOSTIC_STAGE_ID,
	PAYMENT_PENDING_STAGE_ID,
	resolvePaymentUrl,
} from "./diagnostic-scheduling";

class MemoryRedis {
	values = new Map<string, unknown>();

	async get<T>(key: string): Promise<T | null> {
		return (this.values.get(key) as T | undefined) ?? null;
	}

	async set(
		key: string,
		value: unknown,
		options?: { nx?: boolean },
	): Promise<"OK" | null> {
		if (options?.nx && this.values.has(key)) return null;
		this.values.set(key, value);
		return "OK";
	}

	async eval(_script: string, keys: string[], args: unknown[]) {
		const key = keys[0];
		if (key && this.values.get(key) === args[0]) {
			this.values.delete(key);
			return 1;
		}
		return 0;
	}
}

afterEach(() => {
	delete process.env.DIAGNOSTIC_PAYMENT_URL;
	delete process.env.BITRIX_DIAGNOSTIC_USER_ID;
});

describe("diagnostic scheduling messages", () => {
	it("uses the current Bitrix24 stages for diagnostic scheduling", () => {
		expect(PAYMENT_PENDING_STAGE_ID).toBe("UC_PV8XUM");
		expect(PAID_DIAGNOSTIC_STAGE_ID).toBe("UC_DI3Y04");
	});

	it("does not invent an email when the contact has none", () => {
		expect(findContactEmail({ EMAIL: [] })).toBe("");
	});

	it("sends payment and connection links while payment is pending", () => {
		const message = buildImmediateDiagnosticMessage({
			clientName: "Анна",
			diagnosticAt: "2026-08-05T10:00:00.000Z",
			stageId: PAYMENT_PENDING_STAGE_ID,
			paymentUrl: "https://pay.example/42",
		});

		expect(message).toContain("https://pay.example/42");
		expect(message).toContain(DIAGNOSTIC_JOIN_URL);
		expect(message).toContain("Анна");
	});

	it("does not repeat the payment link after payment", () => {
		const message = buildImmediateDiagnosticMessage({
			clientName: "Анна",
			diagnosticAt: "2026-08-05T10:00:00.000Z",
			stageId: PAID_DIAGNOSTIC_STAGE_ID,
			paymentUrl: "https://pay.example/42",
		});

		expect(message).toContain("Оплата получена");
		expect(message).toContain(DIAGNOSTIC_JOIN_URL);
		expect(message).not.toContain("https://pay.example/42");
	});

	it("finds a payment link in a named CRM field", () => {
		const url = resolvePaymentUrl(
			{ UF_CRM_PAYMENT: "Оплатить: https://pay.example/deal-7" },
			{
				UF_CRM_PAYMENT: {
					formLabel: "Ссылка на оплату диагностики",
				},
			},
		);

		expect(url).toBe("https://pay.example/deal-7");
	});
});

describe("handleDiagnosticDealUpdate", () => {
	it("creates one two-hour event and updates it when the date changes", async () => {
		process.env.DIAGNOSTIC_PAYMENT_URL = "https://pay.example/diagnostic";
		process.env.BITRIX_DIAGNOSTIC_USER_ID = "17";

		let diagnosticAt = "2026-08-05T10:00:00+03:00";
		const calls: Array<{ method: string; params: Record<string, unknown> }> =
			[];
		const api: BitrixApi = {
			async call<T>(method: string, params: Record<string, unknown> = {}) {
				calls.push({ method, params });
				if (method === "crm.deal.get") {
					return {
						ID: "42",
						TITLE: "Диагностика Анны",
						CATEGORY_ID: "0",
						STAGE_ID: PAYMENT_PENDING_STAGE_ID,
						CONTACT_ID: "9",
						UF_CRM_1779871551489: diagnosticAt,
					} as T;
				}
				if (method === "crm.contact.get") {
					return {
						ID: "9",
						NAME: "Анна",
						EMAIL: [],
						PHONE: [{ VALUE: "+79990000000" }],
					} as T;
				}
				if (method === "crm.deal.fields") return {} as T;
				if (method === "calendar.event.add") return 501 as T;
				if (method === "calendar.event.update") return 501 as T;
				if (method === "crm.timeline.comment.add") return 1 as T;
				throw new Error(`Unexpected method ${method}`);
			},
			async list<T>() {
				return [] as T[];
			},
		};
		const redis = new MemoryRedis() as unknown as RedisClient;

		const created = await handleDiagnosticDealUpdate(api, redis, 42);
		const repeated = await handleDiagnosticDealUpdate(api, redis, 42);
		diagnosticAt = "2026-08-06T12:30:00+03:00";
		const updated = await handleDiagnosticDealUpdate(api, redis, 42);

		expect(created.action).toBe("created");
		expect(repeated.action).toBe("unchanged");
		expect(updated.action).toBe("updated");
		expect(
			calls.filter((call) => call.method === "calendar.event.add"),
		).toHaveLength(1);
		expect(
			calls.filter((call) => call.method === "calendar.event.update"),
		).toHaveLength(1);
		expect(
			calls.filter((call) => call.method === "crm.timeline.comment.add"),
		).toHaveLength(2);

		const add = calls.find((call) => call.method === "calendar.event.add");
		expect(add?.params.ownerId).toBe(17);
		const from = new Date(String(add?.params.from)).getTime();
		const to = new Date(String(add?.params.to)).getTime();
		expect(to - from).toBe(2 * 60 * 60 * 1000);
		expect(add?.params.crm_fields).toEqual(["D_42", "C_9"]);
	});
});
