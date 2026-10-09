import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as dbSchema from "../schema";

// Run this file separately with METRIKA_TEST_DATABASE_URL pointing at disposable
// PostgreSQL. Only the DB connection is substituted; queries run against PostgreSQL.
const url = process.env.METRIKA_TEST_DATABASE_URL;
describe.skipIf(!url)("Metrika goal claims (PostgreSQL)", () => {
	if (!url) return;
	const schema = `metrika_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const client = postgres(url, { connection: { search_path: schema } });
	const db = drizzle(client, { schema: dbSchema });
	let queries: typeof import("./yandex-metrika");

	beforeAll(async () => {
		await client`CREATE SCHEMA ${client(schema)}`;
		const initial = await readFile(
			new URL(
				"../../migrations/0057_smooth_james_howlett.sql",
				import.meta.url,
			),
			"utf8",
		);
		await client.unsafe(initial.replaceAll('"public".', `"${schema}".`));
		await client`INSERT INTO yandex_metrika_stage_goals (id, name, goal_id, category_id, stage_id)
			VALUES ('legacy', 'Legacy goal', 'legacy', '0', 'WON'), ('goal', 'Goal', 'paid', '0', 'WON')`;
		await client`INSERT INTO yandex_metrika_goal_events (stage_goal_id, deal_id, sent_at)
			VALUES ('legacy', '42', '2026-09-01 12:30:00')`;
		await client.unsafe(
			await readFile(
				new URL(
					"../../migrations/0058_metrika_goal_claims.sql",
					import.meta.url,
				),
				"utf8",
			),
		);
		mock.module("../client", () => ({ db }));
		queries = await import("./yandex-metrika");
	});
	beforeEach(async () => {
		await client`DELETE FROM yandex_metrika_goal_events WHERE stage_goal_id = 'goal'`;
	});
	afterAll(async () => {
		await client`DROP SCHEMA ${client(schema)} CASCADE`;
		await client.end();
		mock.restore();
	});

	async function claim() {
		const token = await queries.claimYandexMetrikaGoalEvent("goal", "42");
		if (!token) throw new Error("Expected claim");
		return token;
	}
	async function expireClaim() {
		await client`UPDATE yandex_metrika_goal_events
			SET claimed_at = now() - (${queries.YANDEX_METRIKA_GOAL_CLAIM_TTL_MS} + 1000) * interval '1 millisecond'
			WHERE stage_goal_id = 'goal'`;
	}
	async function event() {
		const [row] =
			await client`SELECT * FROM yandex_metrika_goal_events WHERE stage_goal_id = 'goal'`;
		return row;
	}

	test("migration preserves legacy sent events and their timestamps", async () => {
		const [row] =
			await client`SELECT * FROM yandex_metrika_goal_events WHERE stage_goal_id = 'legacy'`;
		expect(row?.status).toBe("sent");
		expect(row?.sent_at).toBe("2026-09-01 12:30:00");
		expect(
			await queries.claimYandexMetrikaGoalEvent("legacy", "42"),
		).toBeNull();
	});

	test("concurrent initial claims have one winner; fresh pending is not reclaimed or counted", async () => {
		const tokens = await Promise.all(
			Array.from({ length: 5 }, () =>
				queries.claimYandexMetrikaGoalEvent("goal", "42"),
			),
		);
		expect(tokens.filter(Boolean)).toHaveLength(1);
		expect(await event()).toMatchObject({ status: "pending", sent_at: null });
		expect(await queries.claimYandexMetrikaGoalEvent("goal", "42")).toBeNull();
		const goals = await queries.listYandexMetrikaStageGoals();
		expect(goals.find((g) => g.id === "goal")?.sentCount).toBe(0);
	});

	test("expired pending is atomically reclaimed, and old owners cannot release or finalize it", async () => {
		const oldToken = await claim();
		await expireClaim();
		const tokens = await Promise.all(
			Array.from({ length: 5 }, () =>
				queries.claimYandexMetrikaGoalEvent("goal", "42"),
			),
		);
		const winners = tokens.filter((t): t is string => t !== null);
		expect(winners).toHaveLength(1);
		const token = winners[0];
		if (!token) throw new Error("Expected reclaim");
		expect(token).not.toBe(oldToken);
		await queries.releaseYandexMetrikaGoalEvent("goal", "42", oldToken);
		await queries.markYandexMetrikaGoalEventSent("goal", "42", oldToken);
		expect(await event()).toMatchObject({
			status: "pending",
			claim_token: token,
		});
		expect(await queries.claimYandexMetrikaGoalEvent("goal", "42")).toBeNull();
		await queries.markYandexMetrikaGoalEventSent("goal", "42", token);
		expect((await event())?.status).toBe("sent");
	});

	test("sent events cannot be reclaimed or released even after the claim expires", async () => {
		const token = await claim();
		await queries.markYandexMetrikaGoalEventSent("goal", "42", token);
		await expireClaim();
		await queries.releaseYandexMetrikaGoalEvent("goal", "42", token);
		expect(await queries.claimYandexMetrikaGoalEvent("goal", "42")).toBeNull();
		expect((await event())?.sent_at).toEqual(expect.any(String));
		const goals = await queries.listYandexMetrikaStageGoals();
		expect(goals.find((g) => g.id === "goal")?.sentCount).toBe(1);
	});

	test("failed sends release the owned pending claim for immediate retry", async () => {
		const token = await claim();
		await queries.releaseYandexMetrikaGoalEvent("goal", "42", token);
		expect(await event()).toBeUndefined();
		expect(await claim()).not.toBe(token);
	});
});
