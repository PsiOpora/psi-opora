import { afterEach, describe, expect, it } from "bun:test";
import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import { handleConsultationDealUpdate } from "./consultation-reminders";
import { takeOverConsultationEvent } from "./reminders/calendar-events";

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

	async sadd(): Promise<number> {
		return 1;
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
	delete process.env.BITRIX_CONSULTATION_USER_ID;
});

describe("handleConsultationDealUpdate", () => {
	it("creates a 30-minute calendar event", async () => {
		process.env.BITRIX_CONSULTATION_USER_ID = "17";
		const calls: Array<{ method: string; params: Record<string, unknown> }> =
			[];
		const api: BitrixApi = {
			async call<T>(method: string, params: Record<string, unknown> = {}) {
				calls.push({ method, params });
				if (method === "crm.deal.get") {
					return {
						ID: "42",
						TITLE: "Бесплатная консультация Анны",
						CATEGORY_ID: "0",
						STAGE_ID: "UC_WWIO8W",
						CONTACT_ID: "9",
						UF_CRM_1779802779513: "2026-08-05T10:00:00+03:00",
					} as T;
				}
				if (method === "crm.contact.get") {
					return {
						ID: "9",
						NAME: "Анна",
						PHONE: [{ VALUE: "+79990000000" }],
					} as T;
				}
				if (method === "calendar.event.get") return [] as T;
				if (method === "calendar.event.add") return 501 as T;
				if (method === "crm.timeline.comment.add") return 1 as T;
				throw new Error(`Unexpected method ${method}`);
			},
			async list<T>() {
				return [] as T[];
			},
		};
		const redis = new MemoryRedis() as unknown as RedisClient;

		const result = await handleConsultationDealUpdate(api, redis, 42);

		expect(result.action).toBe("init");
		const add = calls.find((call) => call.method === "calendar.event.add");
		expect(add?.params.ownerId).toBe(17);
		const from = new Date(String(add?.params.from)).getTime();
		const to = new Date(String(add?.params.to)).getTime();
		expect(to - from).toBe(30 * 60 * 1000);
		expect(add?.params.crm_fields).toEqual(["D_42", "C_9"]);
	});

	it("preserves manual ownership through rescheduling and consultation takeover", async () => {
		let consultationAt = "2099-08-05T10:00:00+03:00";
		const calls: Array<{ method: string; params: Record<string, unknown> }> =
			[];
		const api: BitrixApi = {
			async call<T>(method: string, params: Record<string, unknown> = {}) {
				calls.push({ method, params });
				if (method === "crm.deal.get") {
					return {
						ID: "42",
						CATEGORY_ID: "0",
						STAGE_ID: "UC_WWIO8W",
						CONTACT_ID: "9",
						UF_CRM_1779802779513: consultationAt,
					} as T;
				}
				if (method === "crm.contact.get") {
					return {
						ID: "9",
						NAME: "Ольга",
						PHONE: [{ VALUE: "79536613066" }],
					} as T;
				}
				if (method === "calendar.event.get") {
					return [
						{
							ID: "7344",
							NAME: "б/п консультация Ольга +7 953 661-30-66",
							DATE_FROM: "05.08.2099 10:00:00",
							DATE_TO: "05.08.2099 10:30:00",
							TZ_OFFSET_FROM: "10800",
							TZ_OFFSET_TO: "10800",
						},
					] as T;
				}
				if (method === "calendar.event.add") return 501 as T;
				if (method === "calendar.event.update") return true as T;
				if (method === "crm.activity.list") return [] as T;
				if (method === "crm.timeline.comment.add") return 1 as T;
				throw new Error(`Unexpected method ${method}`);
			},
			async list<T>() {
				return [] as T[];
			},
		};
		const memory = new MemoryRedis();
		const redis = memory as unknown as RedisClient;

		const result = await handleConsultationDealUpdate(api, redis, 42);

		expect(result.action).toBe("init");
		expect(result).toMatchObject({ calendarEventId: 7344 });
		expect(memory.values.get("consult-reminder:deal:42")).toMatchObject({
			calendarEventId: 7344,
			calendarEventAdopted: "phone",
		});
		await handleConsultationDealUpdate(api, redis, 42);
		consultationAt = "2099-08-05T10:15:00+03:00";
		await handleConsultationDealUpdate(api, redis, 42);
		expect(memory.values.get("consult-reminder:deal:42")).toMatchObject({
			calendarEventId: 7344,
			calendarEventAdopted: "phone",
		});
		expect(
			await takeOverConsultationEvent(api, redis, 42, {
				name: "Диагностика",
				description: "Automation description",
			}),
		).toBe(0);
		expect(calls.some((call) => call.method === "calendar.event.getbyid")).toBe(
			false,
		);
		expect(
			calls.some(
				(call) =>
					call.method === "calendar.event.add" ||
					call.method === "calendar.event.update",
			),
		).toBe(false);

		consultationAt = "2099-08-06T10:00:00+03:00";
		await handleConsultationDealUpdate(api, redis, 42);
		expect(memory.values.get("consult-reminder:deal:42")).toMatchObject({
			calendarEventId: 501,
			calendarEventAdopted: undefined,
		});
		consultationAt = "2099-08-07T10:00:00+03:00";
		await handleConsultationDealUpdate(api, redis, 42);
		const updates = calls.filter(
			(call) => call.method === "calendar.event.update",
		);
		expect(updates).toHaveLength(1);
		expect(updates[0]?.params.id).toBe(501);
	});
});
