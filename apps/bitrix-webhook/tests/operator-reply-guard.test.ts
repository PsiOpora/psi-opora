import { describe, expect, test } from "bun:test";
import type { OperatorReplyMessage } from "@psi-opora/bitrix-webhook-api";
import type { RedisClient } from "@psi-opora/bot-core";
import {
	claimOperatorReply,
	isMirroredOperatorReply,
	operatorReplyDedupKey,
} from "../src/operator-reply-guard";

const reply: OperatorReplyMessage = {
	connector: "psiopora_max_bot",
	lineId: 7,
	chatId: 32263492,
	text: "Тест",
	externalMessageId: "max-message-1",
	bitrixMessageId: 42,
	operatorUserId: 17,
};

describe("operator reply guard", () => {
	test("распознаёт собственное эхо по служебному ID", () => {
		expect(
			isMirroredOperatorReply({
				...reply,
				externalMessageId: "operator-17-1234567890",
			}),
		).toBe(true);
		expect(isMirroredOperatorReply(reply)).toBe(false);
	});

	test("строит ключ из внутреннего ID Bitrix", () => {
		expect(operatorReplyDedupKey(reply)).toBe(
			"bitrix:operator-reply:psiopora_max_bot:7:32263492:42",
		);
	});

	test("атомарно пропускает событие только один раз", async () => {
		const keys = new Set<string>();
		const redis = {
			async set(key: string) {
				if (keys.has(key)) return null;
				keys.add(key);
				return "OK" as const;
			},
		} as RedisClient;

		expect(await claimOperatorReply(redis, reply)).toBe(true);
		expect(await claimOperatorReply(redis, reply)).toBe(false);
	});

	test("без ID и при ошибке Redis работает fail-open", async () => {
		expect(
			await claimOperatorReply(null, {
				chatId: 32263492,
				text: "Тест",
			}),
		).toBe(true);

		const redis = {
			async set() {
				throw new Error("redis unavailable");
			},
		} as unknown as RedisClient;
		expect(await claimOperatorReply(redis, reply)).toBe(true);
	});
});
