import { afterEach, describe, expect, it } from "bun:test";
import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import { handleConsultationDealUpdate } from "./consultation-reminders";

class MemoryRedis {
  values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown): Promise<"OK"> {
    this.values.set(key, value);
    return "OK";
  }

  async sadd(): Promise<number> {
    return 1;
  }
}

afterEach(() => {
  delete process.env.BITRIX_CONSULTATION_USER_ID;
});

describe("handleConsultationDealUpdate", () => {
  it("creates a 30-minute calendar event", async () => {
    process.env.BITRIX_CONSULTATION_USER_ID = "17";
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const api: BitrixApi = {
      async call<T>(method: string, params: Record<string, unknown> = {}) {
        calls.push({ method, params });
        if (method === "crm.deal.get") {
          return {
            ID: "42",
            TITLE: "Бесплатная консультация Анны",
            CATEGORY_ID: "0",
            STAGE_ID: "EXECUTING",
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
});
