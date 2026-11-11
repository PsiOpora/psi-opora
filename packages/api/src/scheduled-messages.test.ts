import { describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import type { ScheduledMessage } from "@psi-opora/db/queries";
import { createORPCContext } from "./orpc";
import { appRouter } from "./routers";
import {
	type DispatchDeps,
	dispatchDueScheduledMessages,
} from "./scheduled-messages-dispatch";
import {
	scheduleClientMessageSchema,
	scheduleWidgetMessageSchema,
} from "./schemas/scheduled-messages";

const anonymousClient = createRouterClient(appRouter, {
	context: createORPCContext({
		headers: new Headers(),
		session: null,
		memberId: null,
		bitrixSession: null,
	}),
});

function row(overrides: Partial<ScheduledMessage> = {}): ScheduledMessage {
	const now = new Date();
	return {
		id: "sm-1",
		memberId: "member-1",
		kind: "inbox",
		messenger: "telegram",
		userId: "42",
		entity: null,
		entityId: null,
		lineId: null,
		connectorId: null,
		text: "Здравствуйте!",
		attachment: null,
		operatorId: "7",
		operatorName: "Анна",
		sendAt: now,
		status: "sending",
		error: null,
		attempts: 1,
		createdAt: now,
		updatedAt: now,
		sentAt: null,
		...overrides,
	};
}

interface Harness {
	deps: DispatchDeps;
	finished: Array<{
		id: string;
		result: { status: "sent" | "failed"; error?: string };
	}>;
	clientCalls: unknown[];
	widgetCalls: unknown[];
}

function harness(
	rows: ScheduledMessage[],
	overrides: Partial<DispatchDeps> = {},
): Harness {
	const finished: Harness["finished"] = [];
	const clientCalls: unknown[] = [];
	const widgetCalls: unknown[] = [];
	let claimed = false;
	const deps: DispatchDeps = {
		claimDue: async () => {
			if (claimed) return [];
			claimed = true;
			return rows;
		},
		failStale: async () => 0,
		failOverdue: async () => 0,
		finish: async (id, result) => {
			finished.push({ id, result });
		},
		sendClient: async (input) => {
			clientCalls.push(input);
			return { ok: true, id: "journal-1" };
		},
		sendWidget: async (input) => {
			widgetCalls.push(input);
			return { ok: true };
		},
		...overrides,
	};
	return { deps, finished, clientCalls, widgetCalls };
}

describe("scheduled messages authorization", () => {
	test("rejects anonymous callers before touching data", async () => {
		const sendAt = new Date(Date.now() + 3_600_000).toISOString();
		await expect(
			anonymousClient.scheduledMessages.scheduleClient({
				messenger: "telegram",
				userId: "1",
				text: "hi",
				sendAt,
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			anonymousClient.scheduledMessages.scheduleWidget({
				entity: "deal",
				entityId: "1",
				messenger: "telegram",
				text: "hi",
				sendAt,
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			anonymousClient.scheduledMessages.listClient({
				messenger: "telegram",
				userId: "1",
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		await expect(
			anonymousClient.scheduledMessages.cancel({ id: "sm-1" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("schedule input schemas", () => {
	const sendAt = new Date(Date.now() + 3_600_000).toISOString();

	test("requires text or an attachment for inbox messages", () => {
		const empty = scheduleClientMessageSchema.safeParse({
			messenger: "telegram",
			userId: "1",
			text: "   ",
			sendAt,
		});
		expect(empty.success).toBe(false);

		const withAttachment = scheduleClientMessageSchema.safeParse({
			messenger: "telegram",
			userId: "1",
			text: "",
			attachment: {
				s3Key: "bot/media/outbound/a.png",
				fileName: "a.png",
				mimeType: "image/png",
				size: 10,
				kind: "image",
			},
			sendAt,
		});
		expect(withAttachment.success).toBe(true);
	});

	test("rejects a malformed send time", () => {
		expect(
			scheduleWidgetMessageSchema.safeParse({
				entity: "deal",
				entityId: "1",
				messenger: "telegram",
				text: "hi",
				sendAt: "завтра в 9",
			}).success,
		).toBe(false);
	});
});

describe("dispatchDueScheduledMessages", () => {
	test("sends an inbox message with the stored author and marks it sent", async () => {
		const h = harness([
			row({ connectorId: "c-1", messenger: "telegram-personal" }),
		]);
		const result = await dispatchDueScheduledMessages(new Date(), h.deps);

		expect(result).toMatchObject({ sent: 1, failed: 0 });
		expect(h.clientCalls).toHaveLength(1);
		expect(h.clientCalls[0]).toMatchObject({
			messenger: "telegram-personal",
			userId: "42",
			connectorId: "c-1",
			text: "Здравствуйте!",
			operatorId: "7",
			operatorName: "Анна",
		});
		expect(h.finished).toEqual([{ id: "sm-1", result: { status: "sent" } }]);
	});

	test("routes widget messages through the CRM send path", async () => {
		const h = harness([
			row({
				kind: "widget",
				userId: null,
				entity: "deal",
				entityId: "55",
				messenger: "max",
			}),
		]);
		await dispatchDueScheduledMessages(new Date(), h.deps);

		expect(h.clientCalls).toHaveLength(0);
		expect(h.widgetCalls[0]).toMatchObject({
			entity: "deal",
			entityId: "55",
			messenger: "max",
			text: "Здравствуйте!",
		});
		expect(h.finished[0]?.result.status).toBe("sent");
	});

	test("records the send error instead of retrying", async () => {
		const h = harness([row()], {
			sendClient: async () => ({
				ok: false,
				error: "Не отправлено: клиент заблокировал бота",
			}),
		});
		const result = await dispatchDueScheduledMessages(new Date(), h.deps);

		expect(result).toMatchObject({ sent: 0, failed: 1 });
		expect(h.finished).toEqual([
			{
				id: "sm-1",
				result: {
					status: "failed",
					error: "Не отправлено: клиент заблокировал бота",
				},
			},
		]);
	});

	test("a thrown error fails only that message", async () => {
		const h = harness([row({ id: "boom", text: "boom" }), row({ id: "ok" })], {
			sendClient: async (input) => {
				if (input.text === "boom") throw new Error("network down");
				return { ok: true, id: "journal" };
			},
		});
		const result = await dispatchDueScheduledMessages(new Date(), h.deps);

		expect(result).toMatchObject({ sent: 1, failed: 1 });
		expect(h.finished[0]).toMatchObject({
			id: "boom",
			result: { status: "failed" },
		});
		expect(h.finished[0]?.result.error).toContain("network down");
		expect(h.finished[1]).toEqual({ id: "ok", result: { status: "sent" } });
	});

	test("an aborted run finishes the send in flight but starts no new ones", async () => {
		const abort = new AbortController();
		const sent: string[] = [];
		const h = harness([row({ id: "first" }), row({ id: "second" })], {
			sendClient: async (input) => {
				sent.push(input.text);
				// Запуск признали зависшим, пока шла первая отправка.
				abort.abort();
				return { ok: true, id: "journal" };
			},
		});
		const result = await dispatchDueScheduledMessages(
			new Date(),
			h.deps,
			abort.signal,
		);

		expect(sent).toHaveLength(1);
		expect(result).toMatchObject({ sent: 1, failed: 1 });
		expect(h.finished[0]).toEqual({ id: "first", result: { status: "sent" } });
		expect(h.finished[1]).toMatchObject({
			id: "second",
			result: { status: "failed" },
		});
		expect(h.finished[1]?.result.error).toContain("Отправьте сообщение заново");
	});

	test("an already aborted run claims nothing", async () => {
		const abort = new AbortController();
		abort.abort();
		const h = harness([row()]);
		const result = await dispatchDueScheduledMessages(
			new Date(),
			h.deps,
			abort.signal,
		);

		expect(result).toMatchObject({ sent: 0, failed: 0 });
		expect(h.clientCalls).toHaveLength(0);
		expect(h.finished).toHaveLength(0);
	});

	test("fails a message that lost its author without sending", async () => {
		const h = harness([row({ operatorId: null })]);
		await dispatchDueScheduledMessages(new Date(), h.deps);

		expect(h.clientCalls).toHaveLength(0);
		expect(h.finished[0]?.result.status).toBe("failed");
	});

	test("fails a widget message without a CRM entity", async () => {
		const h = harness([row({ kind: "widget", entity: null, userId: null })]);
		await dispatchDueScheduledMessages(new Date(), h.deps);

		expect(h.widgetCalls).toHaveLength(0);
		expect(h.finished[0]?.result.status).toBe("failed");
	});

	test("reports stale and overdue messages it gave up on", async () => {
		const h = harness([], {
			failStale: async () => 2,
			failOverdue: async () => 3,
		});
		const result = await dispatchDueScheduledMessages(new Date(), h.deps);
		expect(result).toEqual({ sent: 0, failed: 0, expired: 3, stale: 2 });
	});
});
