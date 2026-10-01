import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as dbSchema from "../schema";
import { botConversations } from "../schema/bot-conversations";
import { botMessages } from "../schema/bot-messages";
import {
	deleteConversationsForGroup,
	getConversationDeletionVersionForGroup,
} from "./bot-conversations";
import {
	listAllBotMessagesForGroup,
	listBotMessagesSinceForGroup,
} from "./bot-messages";

// Use a disposable database; fixtures are isolated in a unique schema.
const url = process.env.CONVERSATION_TEST_DATABASE_URL;
describe.skipIf(!url)("conversation deletion (PostgreSQL)", () => {
	if (!url) return;
	const schema = `conversation_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const client = postgres(url, { connection: { search_path: schema } });
	const db = drizzle(client, { schema: dbSchema });
	const identities = [
		{ messenger: "telegram", userId: "1" },
		{ messenger: "max", userId: "2" },
	];

	beforeAll(async () => {
		await client`CREATE SCHEMA ${client(schema)}`;
		for (const migration of [
			"0005_bot_messages.sql",
			"0011_broad_nightmare.sql",
			"0012_amusing_moondragon.sql",
			"0014_high_sunfire.sql",
			"0017_add_operator_name_to_bot_messages.sql",
			"0018_sharp_agent_brand.sql",
			"0020_third_nightcrawler.sql",
			"0021_flippant_sprite.sql",
			"0023_mute_karen_page.sql",
			"0024_chilly_anthem.sql",
			"0033_add_guide_email_sent_at.sql",
			"0046_add_bot_message_media_filename.sql",
			"0056_steady_karma.sql",
		]) {
			await client.unsafe(
				await readFile(
					new URL(`../../migrations/${migration}`, import.meta.url),
					"utf8",
				),
			);
		}
	});
	beforeEach(async () => {
		await client`TRUNCATE bot_conversations, bot_messages`;
	});
	afterAll(async () => {
		await client`DROP SCHEMA ${client(schema)} CASCADE`;
		await client.end();
	});

	async function seed() {
		await db.insert(botConversations).values(
			[...identities, { messenger: "telegram", userId: "unrelated" }].map(
				(identity) => ({
					...identity,
					id: `${identity.messenger}:${identity.userId}`,
					assignedOperatorId: "old-operator",
					assignedOperatorName: "Old operator",
					tags: ["tag"],
					lastReadAt: new Date("2020-01-01"),
				}),
			),
		);
	}

	test("resets every member with one cursor and preserves unrelated metadata", async () => {
		await seed();
		const before = await db.select().from(botConversations);
		await deleteConversationsForGroup(db, identities, "operator");
		const after = await db.select().from(botConversations);
		const group = after.filter((row) => row.userId !== "unrelated");
		expect(group).toHaveLength(2);
		for (const row of group) {
			expect(row.deletedAt).toBeInstanceOf(Date);
			expect(row.deletedAt).toEqual(group[0]?.deletedAt);
			expect(row.lastReadAt).toEqual(row.deletedAt);
			expect(row.updatedAt).toEqual(row.deletedAt);
			expect(row.deletedByOperatorId).toBe("operator");
			expect(row.assignedOperatorId).toBeNull();
			expect(row.assignedOperatorName).toBeNull();
			expect(row.tags).toBeNull();
		}
		expect(after.find((row) => row.userId === "unrelated")).toEqual(
			before.find((row) => row.userId === "unrelated"),
		);
	});

	test.each([false, true])(
		"a failing member rolls back all changes (existing rows: %s)",
		async (existing) => {
			if (existing) await seed();
			const before = await db
				.select()
				.from(botConversations)
				.orderBy(botConversations.id);
			await client`ALTER TABLE bot_conversations ADD CONSTRAINT reject_max_deletion CHECK (messenger <> 'max' OR deleted_at IS NULL)`;
			try {
				await expect(
					deleteConversationsForGroup(db, identities, "operator"),
				).rejects.toThrow();
				expect(
					await db.select().from(botConversations).orderBy(botConversations.id),
				).toEqual(before);
			} finally {
				await client`ALTER TABLE bot_conversations DROP CONSTRAINT reject_max_deletion`;
			}
		},
	);

	test("creates missing metadata, deduplicates identities and accepts an empty group", async () => {
		await deleteConversationsForGroup(db, [], "operator");
		expect(await db.select().from(botConversations)).toHaveLength(0);
		await deleteConversationsForGroup(
			db,
			[...identities, ...identities],
			"operator",
		);
		expect(await db.select().from(botConversations)).toHaveLength(2);
	});

	test("deletion changes the version with empty deltas; reload hides old history and retains new messages", async () => {
		await db.insert(botMessages).values(
			identities.map((identity) => ({
				...identity,
				id: identity.messenger,
				direction: "in",
				text: "old",
				createdAt: new Date("2020-01-01"),
				updatedAt: new Date("2020-01-01"),
			})),
		);
		const before = await getConversationDeletionVersionForGroup(db, identities);
		expect(await listAllBotMessagesForGroup(db, identities)).toHaveLength(2);
		await deleteConversationsForGroup(db, identities, "operator");
		const version = await getConversationDeletionVersionForGroup(
			db,
			identities,
		);
		expect(version).not.toBe(before);
		expect(
			await getConversationDeletionVersionForGroup(
				db,
				[...identities].reverse(),
			),
		).toBe(version);
		expect(
			await listBotMessagesSinceForGroup(
				db,
				identities,
				new Date("2020-01-02"),
			),
		).toEqual([]);
		expect(await listAllBotMessagesForGroup(db, identities)).toEqual([]);
		await db.insert(botMessages).values({
			messenger: "max",
			userId: "2",
			id: "new",
			direction: "in",
			text: "new",
			createdAt: new Date(Date.now() + 1000),
			updatedAt: new Date(Date.now() + 1000),
		});
		expect(
			(await listAllBotMessagesForGroup(db, identities)).map((row) => row.id),
		).toEqual(["new"]);
		expect(await getConversationDeletionVersionForGroup(db, identities)).toBe(
			version,
		);
		// A per-channel change must be detected even if another channel has a later cursor.
		await client`UPDATE bot_conversations SET deleted_at = deleted_at - interval '1 second' WHERE messenger = 'max'`;
		expect(
			await getConversationDeletionVersionForGroup(db, identities),
		).not.toBe(version);
	});
});
