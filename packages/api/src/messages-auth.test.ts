import { describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { createORPCContext } from "./orpc";
import { appRouter } from "./routers";

const anonymousClient = createRouterClient(appRouter, {
	context: createORPCContext({
		headers: new Headers(),
		session: null,
		memberId: null,
		bitrixSession: null,
	}),
});

function expectUnauthorized(call: () => Promise<unknown>) {
	return expect(call()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
}

describe("messages authorization", () => {
	test("rejects anonymous reads before accessing data", async () => {
		await expectUnauthorized(() => anonymousClient.messages.list({}));
		await expectUnauthorized(() =>
			anonymousClient.messages.thread({
				messenger: "telegram",
				userId: "1",
			}),
		);
	});

	test("rejects anonymous writes before side effects", async () => {
		await expectUnauthorized(() =>
			anonymousClient.messages.send({
				messenger: "telegram",
				userId: "1",
				text: "test",
			}),
		);
		await expectUnauthorized(() =>
			anonymousClient.messages.addNote({
				messenger: "telegram",
				userId: "1",
				text: "test",
			}),
		);
		await expectUnauthorized(() =>
			anonymousClient.messages.deleteQuickReply({ id: "reply-1" }),
		);
	});
});
