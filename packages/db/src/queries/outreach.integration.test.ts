import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

// Run separately with both URLs pointing to the same disposable, migrated database.
const url = process.env.OUTREACH_TEST_DATABASE_URL;
describe.skipIf(!url || url !== process.env.POSTGRES_URL)(
	"listBotDialogsByScenarioPhone (PostgreSQL)",
	() => {
		if (!url) return;
		const client = postgres(url);
		const campaignId = `outreach-test-${crypto.randomUUID()}`;
		let lookup: typeof import("./outreach").listBotDialogsByScenarioPhone;

		beforeAll(async () => {
			({ listBotDialogsByScenarioPhone: lookup } = await import("./outreach"));
			await client`INSERT INTO bot_guide_campaigns
				(id, keyword, title, email_subject, email_body, delivery_message, follow_up_message)
				VALUES (${campaignId}, ${campaignId}, 'Test', 'Test', 'Test', 'Test', 'Test')`;
		});

		afterAll(async () => {
			await client`DELETE FROM bot_guide_deliveries WHERE campaign_id = ${campaignId}`;
			await client`DELETE FROM book_preorder_orders WHERE name = ${campaignId}`;
			await client`DELETE FROM bot_guide_campaigns WHERE id = ${campaignId}`;
			await client.end();
		});

		test.each([
			["+79991234567", "8 (999) 123-45-67", true],
			["+79991234567", "999 123-45-67", true],
			["+74951234567", "495 123-45-67", true],
			["+73951234567", "395 123-45-67", true],
			["+375291234567", "375 (29) 123-45-67", true],
			["+81901234567", "81 90 123 45 67", false],
			["+81901234567", "+7 190 123-45-67", false],
			["+79991234567", "+8 999 123-45-67", false],
			["+79991234567", "+999 123-45-67", false],
			["+71234567890", "1234567890", false],
			["+72951234567", "2951234567", false],
			["+375291234567", "+475291234567", false],
			["+4915123456789", "+49 (151) 23456789", true],
		] as const)("%s vs %s: match=%s in both sources", async (a, b, matches) => {
			// Reverse the pair too: input and stored values must normalize identically.
			for (const [input, stored] of [
				[a, b],
				[b, a],
			]) {
				const userId = crypto.randomUUID();
				await client`INSERT INTO bot_guide_deliveries
					(id, campaign_id, messenger, user_id, phone)
					VALUES (${userId}, ${campaignId}, 'telegram', ${userId}, ${stored})`;
				await client`INSERT INTO book_preorder_orders (id, messenger, user_id, phone, name)
					VALUES (${userId}, 'max', ${userId}, ${stored}, ${campaignId})`;
				try {
					const result = await lookup(input);
					for (const messenger of ["telegram", "max"]) {
						if (matches) expect(result).toContainEqual({ messenger, userId });
						else expect(result).not.toContainEqual({ messenger, userId });
					}
				} finally {
					await client`DELETE FROM bot_guide_deliveries WHERE id = ${userId}`;
					await client`DELETE FROM book_preorder_orders WHERE id = ${userId}`;
				}
			}
		});
	},
);
