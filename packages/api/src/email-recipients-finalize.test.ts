import { describe, expect, test } from "bun:test";

import { finalizeEmailRecipients } from "./email-recipients-finalize";

function recipient(key: string, email: string | null) {
	return {
		key,
		contactId: null,
		contactName: key,
		dealId: null,
		dealTitle: null,
		email,
		status: "pending" as const,
	};
}

describe("finalizeEmailRecipients", () => {
	test("нормализует адрес и пропускает повтор", () => {
		const result = finalizeEmailRecipients(
			[recipient("a", " Ivan@Mail.ru "), recipient("b", "ivan@mail.ru")],
			new Map(),
		);
		expect(result[0]).toMatchObject({
			email: "ivan@mail.ru",
			status: "pending",
		});
		expect(result[1]).toMatchObject({ status: "skipped" });
	});

	test("пропускает некорректный адрес", () => {
		const [r] = finalizeEmailRecipients([recipient("a", "ivan@")], new Map());
		expect(r).toMatchObject({ status: "skipped", error: "некорректный email" });
	});

	test("пропускает адрес из стоп-листа с причиной", () => {
		const [r] = finalizeEmailRecipients(
			[recipient("a", "ivan@mail.ru")],
			new Map([["ivan@mail.ru", "unsubscribed" as const]]),
		);
		expect(r?.status).toBe("skipped");
		expect(r?.error).toContain("отписался");
	});

	test("уже пропущенные получатели не меняются", () => {
		const skipped = {
			...recipient("a", null),
			status: "skipped" as const,
			error: "у контакта нет email",
		};
		expect(finalizeEmailRecipients([skipped], new Map())[0]).toEqual(skipped);
	});

	test("стоп-лист не съедает слот дубликата", () => {
		const result = finalizeEmailRecipients(
			[recipient("a", "x@mail.ru"), recipient("b", "y@mail.ru")],
			new Map([["x@mail.ru", "bounced" as const]]),
		);
		expect(result.map((r) => r.status)).toEqual(["skipped", "pending"]);
	});
});
