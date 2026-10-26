import { describe, expect, test } from "bun:test";
import type { RedisClient } from "@psi-opora/bot-core";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { startPolling } from "./polling";

const BOT_INFO: UserFromGetMe = {
	id: 42,
	is_bot: true,
	first_name: "Test",
	username: "test_bot",
	can_join_groups: true,
	can_read_all_group_messages: false,
	supports_inline_queries: false,
	can_connect_to_business: false,
	has_main_web_app: false,
	has_topics_enabled: false,
	allows_users_to_create_topics: false,
	can_manage_bots: false,
	supports_join_request_queries: false,
};

function textUpdate(updateId: number): Update {
	return {
		update_id: updateId,
		message: {
			message_id: updateId,
			date: 0,
			chat: { id: 1, type: "private", first_name: "U" },
			from: { id: 1, is_bot: false, first_name: "U" },
			text: `msg ${updateId}`,
		},
	};
}

type ApiResult = { ok: true; result: unknown } | Record<string, unknown>;

/** Поддельный Bot API: getUpdates отдаёт заранее заданные ответы по очереди,
 * дальше — пустой список (с небольшой паузой, как настоящий long poll). */
function createFakeApi(getUpdatesResponses: ApiResult[]) {
	const calls: { method: string; body: Record<string, unknown> }[] = [];
	const fetch = async (url: string | URL | Request, init?: RequestInit) => {
		const method = String(url).split("/").pop() ?? "";
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ method, body });
		let result: ApiResult = { ok: true, result: true };
		if (method === "getUpdates") {
			const next = body.timeout === 0 ? undefined : getUpdatesResponses.shift();
			if (next) result = next;
			else {
				await new Promise((r) => setTimeout(r, 5));
				result = { ok: true, result: [] };
			}
		}
		return new Response(JSON.stringify(result));
	};
	return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

function createFakeRedis(seen: Set<string>): RedisClient {
	return {
		set: async (key: string) => {
			if (seen.has(key)) return null;
			seen.add(key);
			return "OK";
		},
	} as unknown as RedisClient;
}

async function waitFor(check: () => boolean, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("waitFor: таймаут");
		await new Promise((r) => setTimeout(r, 5));
	}
}

describe("startPolling", () => {
	test("снимает вебхук, обрабатывает апдейты, пропускает дубли и подтверждает offset при остановке", async () => {
		const api = createFakeApi([
			{ ok: true, result: [textUpdate(10), textUpdate(11)] },
		]);
		const bot = new Bot("123:abc", {
			botInfo: BOT_INFO,
			client: { apiRoot: "http://fake", fetch: api.fetch },
		});
		const handled: number[] = [];
		bot.on("message", (ctx) => {
			handled.push(ctx.update.update_id);
		});

		// update 11 уже обработан другим экземпляром бота (пересечение при выкатке).
		const redis = createFakeRedis(new Set(["tg:update:42:11"]));
		const polling = await startPolling(bot, redis);
		expect(api.calls[0]?.method).toBe("deleteWebhook");

		await waitFor(() => handled.length === 1);
		await polling.stop(1_000);

		expect(handled).toEqual([10]);
		const confirm = api.calls.at(-1);
		expect(confirm?.method).toBe("getUpdates");
		expect(confirm?.body).toMatchObject({ offset: 12, timeout: 0 });
	});

	test("на 409 из-за вебхука снимает его и продолжает опрос", async () => {
		const api = createFakeApi([
			{
				ok: false,
				error_code: 409,
				description:
					"Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first",
			},
			{ ok: true, result: [textUpdate(20)] },
		]);
		const bot = new Bot("123:abc", {
			botInfo: BOT_INFO,
			client: { apiRoot: "http://fake", fetch: api.fetch },
		});
		const handled: number[] = [];
		bot.on("message", (ctx) => {
			handled.push(ctx.update.update_id);
		});

		const polling = await startPolling(bot, createFakeRedis(new Set()));
		// Пауза перед повтором — RETRY_DELAY_MS (5 с).
		await waitFor(() => handled.length === 1, 7_000);
		await polling.stop(1_000);

		const methods = api.calls.map((c) => c.method);
		expect(methods.filter((m) => m === "deleteWebhook")).toHaveLength(2);
		expect(handled).toEqual([20]);
	}, 10_000);

	test("останавливает опрос на 401", async () => {
		const api = createFakeApi([
			{ ok: false, error_code: 401, description: "Unauthorized" },
		]);
		const bot = new Bot("123:abc", {
			botInfo: BOT_INFO,
			client: { apiRoot: "http://fake", fetch: api.fetch },
		});

		const polling = await startPolling(bot, createFakeRedis(new Set()));
		await expect(polling.task).rejects.toMatchObject({ error_code: 401 });
	});
});
