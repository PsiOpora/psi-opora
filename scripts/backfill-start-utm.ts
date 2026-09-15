import { SITE_CODES } from "../packages/bot-core/src/utils/site-codes";
import pg from "../packages/db/node_modules/pg/lib/index.js";

const { Pool } = pg;

type Messenger = "telegram" | "max";

interface StartRow {
	messenger: Messenger;
	user_id: string;
	payload: string;
	linked_deal_id: string | null;
}

interface Deal {
	ID: string;
	CONTACT_ID?: string | null;
	COMMENTS?: string | null;
	UTM_SOURCE?: string | null;
	UTM_MEDIUM?: string | null;
	UTM_CAMPAIGN?: string | null;
	UTM_CONTENT?: string | null;
}

interface BitrixResponse<T> {
	result?: T;
	next?: number;
	error?: string;
	error_description?: string;
}

const APPLY = process.argv.includes("--apply");
const MESSENGERS: Messenger[] = ["telegram", "max"];
function envFor(messenger: Messenger, key: string): string | undefined {
	const prefix = messenger === "telegram" ? "TG" : "MAX";
	return process.env[`${prefix}_${key}`] ?? process.env[key];
}

function webhookBase(messenger: Messenger): string {
	const value = envFor(messenger, "BITRIX_WEBHOOK_URL");
	if (!value) throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);
	return value.replace(/\/+$/, "");
}

async function callBitrix<T>(
	messenger: Messenger,
	method: string,
	body: unknown,
): Promise<{ result: T; next?: number }> {
	const response = await fetch(`${webhookBase(messenger)}/${method}.json`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await response.json()) as BitrixResponse<T>;
	if (json.error) {
		throw new Error(
			`Bitrix24 [${method}]: ${json.error} — ${json.error_description ?? ""}`,
		);
	}
	return { result: json.result as T, next: json.next };
}

async function listDeals(messenger: Messenger): Promise<Deal[]> {
	const deals: Deal[] = [];
	let start = 0;
	for (;;) {
		const page = await callBitrix<Deal[]>(messenger, "crm.deal.list", {
			select: [
				"ID",
				"CONTACT_ID",
				"COMMENTS",
				"UTM_SOURCE",
				"UTM_MEDIUM",
				"UTM_CAMPAIGN",
				"UTM_CONTENT",
			],
			order: { ID: "ASC" },
			start,
		});
		deals.push(...page.result);
		if (page.next === undefined) break;
		start = page.next;
	}
	return deals;
}

function expectedUtm(row: StartRow) {
	const registered = SITE_CODES[row.payload];
	return {
		UTM_SOURCE: registered?.source ?? row.messenger,
		UTM_MEDIUM: `${row.messenger}_bot`,
		UTM_CAMPAIGN: registered?.campaign ?? row.payload,
		UTM_CONTENT: envFor(row.messenger, "BOT_ID") ?? row.messenger,
	};
}

function isBlank(value: string | null | undefined): boolean {
	return !value?.trim();
}

async function main() {
	const connectionString = process.env.POSTGRES_URL;
	if (!connectionString) throw new Error("POSTGRES_URL не задан");

	const pool = new Pool({ connectionString });
	const startsResult = await pool.query<StartRow>(`
    WITH starts AS (
      SELECT DISTINCT ON (messenger, user_id)
        messenger,
        user_id,
        regexp_replace(text, '^/start[[:space:]]+', '', 'i') AS payload,
        created_at
      FROM bot_messages
      WHERE direction = 'in'
        AND messenger IN ('telegram', 'max')
        AND text ~* '^/start[[:space:]]+.+$'
      ORDER BY messenger, user_id, created_at
    )
    SELECT
      starts.messenger,
      starts.user_id,
      starts.payload,
      links.deal_id AS linked_deal_id
    FROM starts
    LEFT JOIN bitrix_crm_links links
      USING (messenger, user_id)
    ORDER BY starts.messenger, starts.user_id
  `);
	await pool.end();

	const allDeals = new Map<Messenger, Deal[]>();
	for (const messenger of MESSENGERS) {
		allDeals.set(messenger, await listDeals(messenger));
	}
	for (const row of startsResult.rows) {
		if (!row.linked_deal_id) continue;
		const deals = allDeals.get(row.messenger) ?? [];
		if (deals.some((deal) => deal?.ID === row.linked_deal_id)) continue;
		try {
			const linkedDeal = await callBitrix<Deal>(row.messenger, "crm.deal.get", {
				id: row.linked_deal_id,
			});
			if (linkedDeal.result?.ID) {
				deals.push(linkedDeal.result);
			} else {
				console.warn(
					`LINKED DEAL NOT FOUND ${row.messenger}:${row.user_id} deal=${row.linked_deal_id}`,
				);
			}
		} catch (error) {
			console.warn(
				`LINKED DEAL UNAVAILABLE ${row.messenger}:${row.user_id} deal=${row.linked_deal_id}: ${(error as Error).message}`,
			);
		}
	}

	let matchedClients = 0;
	let missingClients = 0;
	let alreadyComplete = 0;
	let updatedDeals = 0;
	let fieldsSet = 0;
	const missing: string[] = [];
	const ambiguous: string[] = [];
	const rejectedLinks: string[] = [];

	for (const row of startsResult.rows) {
		const marker = new RegExp(
			`${row.messenger}\\s+user_id:\\s*${row.user_id}(?:\\D|$)`,
			"i",
		);
		const deals = allDeals.get(row.messenger) ?? [];
		const markedDeals = deals.filter((deal) =>
			marker.test(deal.COMMENTS ?? ""),
		);

		let candidates = markedDeals;
		if (candidates.length === 0 && row.linked_deal_id) {
			const linked = deals.find((deal) => deal.ID === row.linked_deal_id);
			// Старые links могли быть ошибочно перезаписаны. Используем такую
			// связку только если сделка не содержит маркер другого клиента.
			const hasOtherUserMarker = /(?:telegram|max)\s+user_id:\s*\d+/i.test(
				linked?.COMMENTS ?? "",
			);
			if (linked && !hasOtherUserMarker) candidates = [linked];
		}

		if (candidates.length === 0) {
			missingClients++;
			missing.push(`${row.messenger}:${row.user_id}`);
			if (row.linked_deal_id) {
				const linked = deals.find((deal) => deal.ID === row.linked_deal_id);
				const linkedMarkers =
					linked?.COMMENTS?.match(/(?:telegram|max)\s+user_id:\s*\d+/gi) ?? [];
				rejectedLinks.push(
					`${row.messenger}:${row.user_id} → deal ${row.linked_deal_id}, markers=[${linkedMarkers.join(", ")}]`,
				);
			}
			continue;
		}
		matchedClients++;
		if (candidates.length > 1) {
			ambiguous.push(
				`${row.messenger}:${row.user_id} → deals ${candidates
					.map((deal) => deal.ID)
					.join(",")}`,
			);
		}

		const expected = expectedUtm(row);
		let clientWasComplete = true;
		for (const deal of candidates) {
			const fields = Object.fromEntries(
				Object.entries(expected).filter(([key]) =>
					isBlank(deal[key as keyof Deal] as string | null | undefined),
				),
			);
			if (Object.keys(fields).length === 0) continue;

			clientWasComplete = false;
			fieldsSet += Object.keys(fields).length;
			if (APPLY) {
				await callBitrix<boolean>(row.messenger, "crm.deal.update", {
					id: deal.ID,
					fields,
				});
			}
			updatedDeals++;
			console.log(
				`${APPLY ? "UPDATED" : "WOULD UPDATE"} ${row.messenger}:${row.user_id} deal=${deal.ID} fields=${Object.keys(fields).join(",")}`,
			);
		}
		if (clientWasComplete) alreadyComplete++;
	}

	console.log(
		JSON.stringify(
			{
				mode: APPLY ? "apply" : "plan",
				clientsWithStartUtm: startsResult.rows.length,
				matchedClients,
				missingClients,
				alreadyComplete,
				updatedDeals,
				fieldsSet,
				ambiguous,
				rejectedLinks,
				missing,
			},
			null,
			2,
		),
	);
}

await main();
