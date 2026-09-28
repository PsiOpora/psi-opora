import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { withBookPreorderOrderLock } from "./book-preorder-lock";
import {
	markBookPreorderAwaitingPayment,
	markBookPreorderDeclined,
	markBookPreorderPaid,
} from "./book-preorder-orders";

// Run separately with BOOK_PREORDER_TEST_DATABASE_URL and POSTGRES_URL set to
// the same disposable PostgreSQL database. All fixtures live in a unique schema.
const url = process.env.BOOK_PREORDER_TEST_DATABASE_URL;
describe.skipIf(!url || url !== process.env.POSTGRES_URL)(
	"preorder transitions (PostgreSQL)",
	() => {
		if (!url) return;
		const schema = `preorder_test_${crypto.randomUUID().replaceAll("-", "")}`;
		const client = postgres(url, { connection: { search_path: schema } });
		const db = drizzle(client);
		let serial = 0;

		beforeAll(async () => {
			await client`CREATE SCHEMA ${client(schema)}`;
			for (const migration of [
				"0049_lean_starbolt.sql",
				"0050_blushing_sauron.sql",
			]) {
				await client.unsafe(
					await readFile(
						new URL(`../../migrations/${migration}`, import.meta.url),
						"utf8",
					),
				);
			}
		});
		afterAll(async () => {
			await client`DROP SCHEMA ${client(schema)} CASCADE`;
			await client.end();
		});

		async function order(status = "reserved") {
			const id = `${schema}:${++serial}`;
			const [row] =
				await client`INSERT INTO book_preorder_orders (id, messenger, user_id, status)
			VALUES (${id}, 'telegram', ${String(serial)}, ${status}) RETURNING order_no`;
			if (!row) throw new Error("Order fixture was not inserted");
			return { id, orderNo: Number(row.order_no) };
		}

		test.each(["paid", "declined", "cancelled", "awaiting_payment"])(
			"conditional updates preserve a %s order and its metadata",
			async (status) => {
				const { id } = await order(status);
				const before =
					await client`SELECT * FROM book_preorder_orders WHERE id = ${id}`;
				expect(
					await markBookPreorderAwaitingPayment(
						db,
						id,
						{ email: "changed@example.test" },
						"reserved",
					),
				).toBe(false);
				expect(await markBookPreorderDeclined(db, id, "reserved")).toBe(false);
				expect(
					await client`SELECT * FROM book_preorder_orders WHERE id = ${id}`,
				).toEqual(before);
			},
		);

		test("competing payment-link and cancellation updates have exactly one winner", async () => {
			const { id } = await order();
			const results = await Promise.all([
				markBookPreorderAwaitingPayment(db, id, {}, "reserved"),
				markBookPreorderDeclined(db, id, "reserved"),
			]);
			expect(results.filter(Boolean)).toHaveLength(1);
		});

		test("missing orders return false", async () => {
			expect(
				await markBookPreorderAwaitingPayment(db, "missing", {}, "reserved"),
			).toBe(false);
			expect(await markBookPreorderDeclined(db, "missing", "reserved")).toBe(
				false,
			);
		});

		test.each(["awaiting_payment", "declined"])(
			"paid cannot overtake a delayed %s stage call",
			async (stage) => {
				const { id, orderNo } = await order();
				const started = Promise.withResolvers<void>();
				const release = Promise.withResolvers<void>();
				const stages: string[] = [];
				const first = withBookPreorderOrderLock(id, async () => {
					const changed =
						stage === "awaiting_payment"
							? await markBookPreorderAwaitingPayment(db, id, {}, "reserved")
							: await markBookPreorderDeclined(db, id, "reserved");
					expect(changed).toBe(true);
					started.resolve();
					await release.promise; // Bitrix request still in flight
					stages.push(stage);
				});
				await started.promise;
				let paidEntered = false;
				const paid = withBookPreorderOrderLock(id, async () => {
					paidEntered = true;
					expect(await markBookPreorderPaid(db, orderNo)).not.toBeNull();
					stages.push("paid");
				});
				try {
					// Wait for PostgreSQL to confirm a competing transaction is blocked.
					for (let attempt = 0; attempt < 100; attempt++) {
						const [row] =
							await client`SELECT count(*)::int AS waiting FROM pg_locks
						WHERE locktype = 'advisory' AND NOT granted
						AND classid = hashtext('book-preorder')::oid AND objid = hashtext(${id})::oid`;
						if (Number(row?.waiting) > 0) break;
						if (attempt === 99)
							throw new Error("Competing order lock did not reach PostgreSQL");
						await Bun.sleep(10);
					}
					expect(paidEntered).toBe(false);
					// Other orders must remain independent while this one is blocked.
					expect(
						await withBookPreorderOrderLock(`${id}:other`, async () => 42),
					).toBe(42);
				} finally {
					release.resolve();
					await Promise.all([first, paid]);
				}
				expect(stages).toEqual([stage, "paid"]);
				expect(await markBookPreorderDeclined(db, id, "reserved")).toBe(false);
				expect(
					await markBookPreorderAwaitingPayment(db, id, {}, "reserved"),
				).toBe(false);
			},
		);

		test("a failed operation releases the order lock", async () => {
			const { id } = await order();
			await expect(
				withBookPreorderOrderLock(id, async () => {
					throw new Error("Bitrix failed");
				}),
			).rejects.toThrow("Bitrix failed");
			expect(await withBookPreorderOrderLock(id, async () => "next")).toBe(
				"next",
			);
		});
	},
);
