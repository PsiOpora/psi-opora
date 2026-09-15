import { describe, expect, mock, test } from "bun:test";
import type { Database } from "../client.types";
import { listAllBotMessages } from "./bot-messages";

describe("listAllBotMessages", () => {
	test("возвращает всю историю без применения limit", async () => {
		const rows = [{ id: "newest" }, { id: "oldest" }];
		const orderBy = mock(() => Promise.resolve(rows));
		const where = mock(() => ({ orderBy }));
		const from = mock(() => ({ where }));
		const select = mock(() => ({ from }));
		const database = { select } as unknown as Database;

		const result = await listAllBotMessages(database, "telegram", "123");

		expect(result).toEqual(rows);
		expect(select).toHaveBeenCalledTimes(1);
		expect(from).toHaveBeenCalledTimes(1);
		expect(where).toHaveBeenCalledTimes(1);
		expect(orderBy).toHaveBeenCalledTimes(1);
	});
});
