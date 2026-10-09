import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as dbSchema from "../schema";
import {
	getBitrixCrmLink,
	listBitrixCrmLinksByContactIds,
	upsertBitrixCrmLink,
} from "./bitrix-crm-links";

const url = process.env.CRM_LINK_TEST_DATABASE_URL;
describe.skipIf(!url)("CRM link portal isolation (PostgreSQL)", () => {
	if (!url) return;
	const schema = `crm_link_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const client = postgres(url, { connection: { search_path: schema } });
	const db = drizzle(client, { schema: dbSchema });
	beforeAll(async () => {
		await client`CREATE SCHEMA ${client(schema)}`;
		await client.unsafe(
			await readFile(
				new URL("../../migrations/0016_bitrix_crm_links.sql", import.meta.url),
				"utf8",
			),
		);
		await client`INSERT INTO bitrix_crm_links (id, messenger, user_id, contact_id, deal_id) VALUES ('max:legacy', 'max', 'legacy', '42', '99')`;
		await client.unsafe(
			await readFile(
				new URL(
					"../../migrations/0058_bitrix_crm_link_portal.sql",
					import.meta.url,
				),
				"utf8",
			),
		);
	});
	afterAll(async () => {
		await client`DROP SCHEMA ${client(schema)} CASCADE`;
		await client.end();
	});
	test("filters both portal and contact while allowing different messengers", async () => {
		for (const entry of [
			{
				portalKey: "a.test",
				messenger: "telegram",
				userId: "1",
				contactId: "42",
			},
			{ portalKey: "a.test", messenger: "max", userId: "2", contactId: "42" },
			{ portalKey: "b.test", messenger: "max", userId: "3", contactId: "42" },
			{ portalKey: "a.test", messenger: "max", userId: "4", contactId: "43" },
		])
			await upsertBitrixCrmLink(db, entry);
		const links = await listBitrixCrmLinksByContactIds(db, "a.test", ["42"]);
		expect(links.map((l) => l.id).sort()).toEqual(["max:2", "telegram:1"]);
		expect(await listBitrixCrmLinksByContactIds(db, "a.test", [])).toEqual([]);
		expect(await listBitrixCrmLinksByContactIds(db, "", ["42"])).toEqual([]);
		expect((await getBitrixCrmLink(db, "max", "legacy"))?.portalKey).toBeNull();
	});
	test("upsert updates portal and never carries deals between portals", async () => {
		const entry = {
			portalKey: "a.test",
			messenger: "telegram",
			userId: "upsert",
			contactId: "42",
		};
		await upsertBitrixCrmLink(db, { ...entry, dealId: "90" });
		await upsertBitrixCrmLink(db, entry);
		expect(
			(await getBitrixCrmLink(db, entry.messenger, entry.userId))?.dealId,
		).toBe("90");
		await upsertBitrixCrmLink(db, { ...entry, portalKey: "b.test" });
		expect(
			await getBitrixCrmLink(db, entry.messenger, entry.userId),
		).toMatchObject({ portalKey: "b.test", dealId: null });
		await upsertBitrixCrmLink(db, {
			...entry,
			messenger: "max",
			userId: "legacy",
		});
		expect(await getBitrixCrmLink(db, "max", "legacy")).toMatchObject({
			portalKey: "a.test",
			dealId: null,
		});
		await expect(
			upsertBitrixCrmLink(db, { ...entry, portalKey: " " }),
		).rejects.toThrow("Missing Bitrix portal key");
	});
});
