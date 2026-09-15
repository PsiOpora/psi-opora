import { describe, expect, mock, test } from "bun:test";
import type { Database } from "../client.types";
import {
	mergeClientIdentities,
	resolveCanonicalIdentity,
} from "./client-identity-links";

function makeSelectDb(rows: unknown[]): Database {
	const limit = mock(() => Promise.resolve(rows));
	const where = mock(() => ({ limit }));
	const from = mock(() => ({ where }));
	const select = mock(() => ({ from }));
	return { select } as unknown as Database;
}

describe("resolveCanonicalIdentity", () => {
	test("возвращает саму identity, если связки нет", async () => {
		const db = makeSelectDb([]);
		const result = await resolveCanonicalIdentity(db, "telegram", "1");
		expect(result).toEqual({ messenger: "telegram", userId: "1" });
	});

	test("возвращает primary из связки, если identity уже поглощена", async () => {
		const db = makeSelectDb([
			{ primaryMessenger: "telegram", primaryUserId: "1" },
		]);
		const result = await resolveCanonicalIdentity(db, "max", "2");
		expect(result).toEqual({ messenger: "telegram", userId: "1" });
	});
});

describe("mergeClientIdentities", () => {
	test("бросает ошибку при объединении клиента с самим собой", async () => {
		const db = makeSelectDb([]);
		await expect(
			mergeClientIdentities(db, {
				messenger: "telegram",
				userId: "1",
				intoMessenger: "telegram",
				intoUserId: "1",
			}),
		).rejects.toThrow("Нельзя объединить клиента с самим собой");
	});

	test("бросает ошибку при развороте направления мержа", async () => {
		// max:2 уже объединён с telegram:1 — пробуем объединить telegram:1 в max:2.
		const db = makeSelectDb([
			{ primaryMessenger: "telegram", primaryUserId: "1" },
		]);
		await expect(
			mergeClientIdentities(db, {
				messenger: "telegram",
				userId: "1",
				intoMessenger: "max",
				intoUserId: "2",
			}),
		).rejects.toThrow(/сначала расцепите/);
	});

	test("мёржит identity под корень цели и переподвешивает её бывшие secondary", async () => {
		const limit = mock(() => Promise.resolve([]));
		const selectWhere = mock(() => ({ limit }));
		const selectFrom = mock(() => ({ where: selectWhere }));
		const select = mock(() => ({ from: selectFrom }));

		const onConflictDoUpdate = mock(() => Promise.resolve());
		const insertValues = mock(() => ({ onConflictDoUpdate }));
		const insert = mock(() => ({ values: insertValues }));

		const updateWhere = mock(() => Promise.resolve());
		const updateSet = mock(() => ({ where: updateWhere }));
		const update = mock(() => ({ set: updateSet }));

		const db = { select, insert, update } as unknown as Database;

		const root = await mergeClientIdentities(db, {
			messenger: "max",
			userId: "2",
			intoMessenger: "telegram",
			intoUserId: "1",
		});

		expect(root).toEqual({ messenger: "telegram", userId: "1" });
		expect(insert).toHaveBeenCalledTimes(1);
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "max:2",
				primaryMessenger: "telegram",
				primaryUserId: "1",
			}),
		);
		// Переподвешивает бывшие secondary поглощаемой identity под новый корень.
		expect(update).toHaveBeenCalledTimes(1);
		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				primaryMessenger: "telegram",
				primaryUserId: "1",
			}),
		);
	});
});
