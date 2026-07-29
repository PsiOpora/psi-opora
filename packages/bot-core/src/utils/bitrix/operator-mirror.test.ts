import { describe, expect, test } from "bun:test";
import type { RedisClient } from "../../storage/redis";
import {
	consumeOperatorMirrorEcho,
	enqueueOperatorMirrorEcho,
	type OperatorMirrorEcho,
	operatorMirrorEchoKey,
} from "./operator-mirror";

const echo: OperatorMirrorEcho = {
	connectorId: "psiopora_max_bot",
	lineId: 7,
	userId: 32263492,
	operatorId: 17,
	text: " Ответ оператора ",
};

function createFakeRedis(): RedisClient {
	const queues = new Map<string, unknown[]>();
	return {
		async rpush(key, ...values) {
			const queue = queues.get(key) ?? [];
			queue.push(...values);
			queues.set(key, queue);
			return queue.length;
		},
		async lpop<T>(key: string) {
			const queue = queues.get(key);
			return (queue?.shift() as T | undefined) ?? null;
		},
		async expire() {
			return 1;
		},
  } as unknown as RedisClient;
}

describe("operator mirror echo", () => {
	test("строит одинаковый ключ без раскрытия текста", () => {
		const key = operatorMirrorEchoKey(echo);
		expect(key).toStartWith(
			"bitrix:operator-mirror:psiopora_max_bot:7:32263492:17:",
		);
		expect(key).not.toContain("Ответ оператора");
		expect(operatorMirrorEchoKey({ ...echo, text: echo.text.trim() })).toBe(
			key,
		);
	});

	test("каждое отражение создаёт одноразовый маркер", async () => {
		const redis = createFakeRedis();

		expect(await enqueueOperatorMirrorEcho(redis, echo)).toBe(true);
		expect(await enqueueOperatorMirrorEcho(redis, echo)).toBe(true);
		expect(await consumeOperatorMirrorEcho(redis, echo)).toBe(true);
		expect(await consumeOperatorMirrorEcho(redis, echo)).toBe(true);
		expect(await consumeOperatorMirrorEcho(redis, echo)).toBe(false);
	});

	test("без обязательных полей работает fail-open", async () => {
		const redis = createFakeRedis();
		const incomplete = { userId: 32263492, text: "Тест" };

		expect(operatorMirrorEchoKey(incomplete)).toBeNull();
		expect(await enqueueOperatorMirrorEcho(redis, incomplete)).toBe(false);
		expect(await consumeOperatorMirrorEcho(redis, incomplete)).toBe(false);
	});
});
