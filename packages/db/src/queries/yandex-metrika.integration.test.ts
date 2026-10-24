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
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as dbSchema from "../schema";

// Run this file separately with METRIKA_TEST_DATABASE_URL pointing at disposable
// PostgreSQL. Only the DB connection is substituted; queries run against PostgreSQL.
const url = process.env.METRIKA_TEST_DATABASE_URL;
describe.skipIf(!url)("Metrika queries (PostgreSQL)", () => {
	if (!url) return;
	const schema = `metrika_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const client = postgres(url, { connection: { search_path: schema } });
	const db = drizzle(client, { schema: dbSchema });
	let queries: typeof import("./yandex-metrika");
	let searchQueries: typeof import("./ad-search-queries");

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
		await client.unsafe(
			await readFile(
				new URL(
					"../../migrations/0067_ym_messenger_visitors.sql",
					import.meta.url,
				),
				"utf8",
			),
		);
		await client`INSERT INTO yandex_metrika_messenger_visitors
			(messenger, user_id, client_id, updated_at)
			VALUES ('telegram', 'legacy', '1234567890', '2026-10-01 12:00:00')`;
		await client.unsafe(
			await readFile(
				new URL(
					"../../migrations/0068_ym_visitor_event_time.sql",
					import.meta.url,
				),
				"utf8",
			),
		);
		for (const migration of [
			"0047_nebulous_annihilus.sql",
			"0059_ad_touches.sql",
			"0069_ad_deal_fields.sql",
			"0070_metrika_deal_visits.sql",
		]) {
			await client.unsafe(
				await readFile(
					new URL(`../../migrations/${migration}`, import.meta.url),
					"utf8",
				),
			);
		}
		await client`CREATE TABLE bot_messages (
			messenger text, user_id text, direction text, text text, created_at timestamp
		)`;
		mock.module("../client", () => ({ db }));
		queries = await import("./yandex-metrika");
		searchQueries = await import("./ad-search-queries");
	});
	beforeEach(async () => {
		await client`DELETE FROM yandex_metrika_goal_events WHERE stage_goal_id = 'goal'`;
		await client`DELETE FROM yandex_metrika_messenger_visitors WHERE user_id != 'legacy'`;
		await client`DELETE FROM bot_messages`;
		await client`DELETE FROM yandex_metrika_deal_visitors`;
		await client`DELETE FROM ad_search_query_lookups`;
		await client`DELETE FROM ad_touches`;
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

	test("visit summaries retry pending queries and stop selecting completed deals", async () => {
		await client`INSERT INTO yandex_metrika_deal_visitors (deal_id, client_id, created_at)
			VALUES ('1', 'client', '2026-10-08 09:00:00'), ('2', 'client', '2026-10-09 09:00:00'),
			('no-client', null, '2026-10-08 09:00:00'), ('old', 'client', '2026-09-01 09:00:00'),
			('today', 'client', '2026-10-10 09:00:00')`;
		const since = new Date("2026-09-25T21:00:00Z");
		const until = new Date("2026-10-09T21:00:00Z");
		await queries.markDealVisitsSummarized("1", "pending_search_query");
		expect(
			await queries.listDealVisitorsForVisitSummary(since, until),
		).toMatchObject([
			{ dealId: "1", visitsSummaryStatus: "pending_search_query" },
			{ dealId: "2", visitsSummaryStatus: null },
		]);
		await queries.markDealVisitsSummarized("1", "done");
		await queries.markDealVisitsSummarized("2", "no_visits");
		// no_visits остаётся в выборке с моментом записи: перепроверять ли её,
		// решает крон (визиты могли записать до того, как данные стали полными).
		const rows = await queries.listDealVisitorsForVisitSummary(since, until);
		expect(rows).toMatchObject([
			{ dealId: "2", visitsSummaryStatus: "no_visits" },
		]);
		expect(rows[0]?.visitsSummarizedAt).toBeInstanceOf(Date);
	});

	test("search queue excludes Metrika deals before applying the limit and preserves fallback", async () => {
		await client`INSERT INTO ad_touches (id, occurred_at) VALUES ('touch', '2026-10-08 09:00:00')`;
		for (const [id, status] of [
			["1", null],
			["2", "pending_search_query"],
			["3", "done"],
			["4", "no_visits"],
		]) {
			await client`INSERT INTO yandex_metrika_deal_visitors (deal_id, client_id, visits_summary_status)
				VALUES (${id}, 'client', ${status})`;
			await searchQueries.insertAdSearchQueryLookup({
				dealId: id as string,
				touchId: "touch",
				messenger: "telegram",
			});
		}
		await searchQueries.insertAdSearchQueryLookup({
			dealId: "yclid-only",
			touchId: "touch",
			messenger: "telegram",
		});
		await client`INSERT INTO yandex_metrika_deal_visitors (deal_id, client_id, yclid)
			VALUES ('yclid-only', null, 'click')`;
		expect(await searchQueries.listPendingAdSearchQueryLookups()).toHaveLength(
			5,
		);
		expect(
			await searchQueries.listPendingAdSearchQueryLookups(1, true),
		).toMatchObject([{ dealId: "yclid-only" }]);
		await client`UPDATE yandex_metrika_deal_visitors SET client_id = '' WHERE deal_id = 'yclid-only'`;
		expect(
			await searchQueries.listPendingAdSearchQueryLookups(200, true),
		).toMatchObject([{ dealId: "yclid-only" }]);
	});

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

	test("visitor migration preserves legacy identifiers and write time", async () => {
		const [row] = await client`SELECT * FROM yandex_metrika_messenger_visitors
			WHERE user_id = 'legacy'`;
		expect(row).toMatchObject({
			client_id: "1234567890",
			visited_at: "2026-10-01 12:00:00",
			updated_at: "2026-10-01 12:00:00",
		});
	});

	test("older and equal events cannot overwrite a newer visit or its write time", async () => {
		const old = new Date("2026-10-01T12:00:00Z");
		const recent = new Date("2026-10-02T12:00:00Z");
		await queries.saveYandexMetrikaMessengerVisitor(
			"telegram",
			"1",
			{ clientId: "old", yclid: "old-click" },
			old,
		);
		await queries.saveYandexMetrikaMessengerVisitor(
			"telegram",
			"1",
			{ clientId: "recent" },
			recent,
		);
		const [saved] =
			await client`SELECT * FROM yandex_metrika_messenger_visitors WHERE user_id = '1'`;
		expect(saved).toMatchObject({
			client_id: "recent",
			yclid: null,
			visited_at: "2026-10-02 12:00:00",
		});
		expect(saved?.updated_at).not.toBe(saved?.visited_at);
		for (const timestamp of [old, recent]) {
			await queries.saveYandexMetrikaMessengerVisitor(
				"telegram",
				"1",
				{ yclid: "stale-click" },
				timestamp,
			);
		}
		const [unchanged] =
			await client`SELECT * FROM yandex_metrika_messenger_visitors WHERE user_id = '1'`;
		expect(unchanged).toEqual(saved);
	});

	test("contact lookup orders messenger visits by event time instead of write time", async () => {
		await queries.saveYandexMetrikaMessengerVisitor(
			"telegram",
			"1",
			{ clientId: "recent" },
			new Date("2026-10-02T12:00:00Z"),
		);
		await queries.saveYandexMetrikaMessengerVisitor(
			"max",
			"2",
			{ clientId: "old" },
			new Date("2026-10-01T12:00:00Z"),
		);
		expect(
			await queries.findYandexMetrikaMessengerVisitor([
				{ messenger: "telegram", userId: "1" },
				{ messenger: "max", userId: "2" },
			]),
		).toEqual({ clientId: "recent", yclid: null });
	});

	test("backfill decodes suffixes, skips invalid starts, and preserves newer live visits", async () => {
		await client`INSERT INTO bot_messages VALUES
			('telegram', 'encoded', 'in', '/start SCHOOL%5Fym1234567890%5Fyc9876543210', '2026-10-01 12:00:00.123456'),
			('telegram', 'encoded', 'in', '/start SCHOOL', '2026-10-03 12:00:00'),
			('telegram', 'encoded', 'out', '/start SCHOOL_ym9999999999', '2026-10-04 12:00:00'),
			('max', 'live', 'in', '/start SCHOOL_ym1234567890', '2026-10-01 12:00:00'),
			('max', 'click', 'in', '/START SCHOOL%5Fyc9876543210', '2026-10-02 12:00:00'),
			('max', 'click', 'in', '/start SCHOOL_ym123', '2026-10-03 12:00:00'),
			('whatsapp', 'other', 'in', '/start SCHOOL_ym1234567890', '2026-10-01 12:00:00'),
			('max', 'other', 'in', '/starting SCHOOL_ym1234567890', '2026-10-01 12:00:00')`;
		await queries.saveYandexMetrikaMessengerVisitor(
			"max",
			"live",
			{ clientId: "live" },
			new Date("2026-10-02T12:00:00Z"),
		);
		const isolatedUrl = new URL(url);
		isolatedUrl.searchParams.set(
			"options",
			`-c search_path=${schema} -c timezone=Europe/Moscow`,
		);
		async function backfill(apply: boolean) {
			const proc = Bun.spawn(
				[
					process.execPath,
					fileURLToPath(
						new URL(
							"../../../../scripts/backfill-ym-messenger-visitors.ts",
							import.meta.url,
						),
					),
					...(apply ? ["--apply"] : []),
				],
				{
					env: { ...process.env, POSTGRES_URL: isolatedUrl.toString() },
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			expect(stderr).toBe("");
			expect(exitCode).toBe(0);
			return stdout;
		}
		expect(await backfill(false)).toContain("Пробный прогон");
		expect(
			await queries.findYandexMetrikaMessengerVisitor([
				{ messenger: "telegram", userId: "encoded" },
			]),
		).toBeNull();
		expect(await backfill(true)).toContain("Записано/обновлено: 2");
		const rows = await client`SELECT * FROM yandex_metrika_messenger_visitors
			WHERE user_id != 'legacy' ORDER BY user_id`;
		expect(rows).toHaveLength(3);
		expect(rows[0]).toMatchObject({
			user_id: "click",
			client_id: null,
			yclid: "9876543210",
		});
		expect(rows[1]).toMatchObject({
			user_id: "encoded",
			client_id: "1234567890",
			yclid: "9876543210",
			visited_at: "2026-10-01 12:00:00.123456",
		});
		expect(rows[1]?.updated_at).not.toBe(rows[1]?.visited_at);
		expect(rows[2]?.client_id).toBe("live");
		expect(await backfill(true)).toContain("Записано/обновлено: 0");
	});
});
