/**
 * Разовый бэкафилл поля "Расстройство" (UF_CRM_1779041362411) в уже
 * существующих сделках Bitrix24 — по тем же ключевым словам в UTM_CAMPAIGN,
 * что теперь проставляет buildDealFields (см. packages/bot-core/src/utils/
 * bitrix/deal.ts::resolveDisorderIds). Трогает только сделки, где поле сейчас
 * пустое — ручная категоризация оператора не перезаписывается.
 *
 * Запуск (план, ничего не меняет):
 *   bun --env-file=.env run scripts/backfill-disorder-field.ts
 * Применение:
 *   bun --env-file=.env run scripts/backfill-disorder-field.ts --apply
 */
import { resolveDisorderIds } from "../packages/bot-core/src/utils/bitrix/deal";

type Messenger = "telegram" | "max";

interface Deal {
	ID: string;
	UTM_CAMPAIGN?: string | null;
	UF_CRM_1779041362411?: unknown;
}

interface BitrixResponse<T> {
	result?: T;
	next?: number;
	error?: string;
	error_description?: string;
}

const APPLY = process.argv.includes("--apply");
const DISORDER_FIELD = "UF_CRM_1779041362411";

function webhookBase(): string {
	const value = process.env.TG_BITRIX_WEBHOOK_URL ?? process.env.BITRIX_WEBHOOK_URL;
	if (!value) throw new Error("BITRIX_WEBHOOK_URL не задан");
	return value.replace(/\/+$/, "");
}

async function callBitrix<T>(
	method: string,
	body: unknown,
): Promise<{ result: T; next?: number }> {
	const response = await fetch(`${webhookBase()}/${method}.json`, {
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

async function listDealsWithCampaign(): Promise<Deal[]> {
	const deals: Deal[] = [];
	let start = 0;
	for (;;) {
		const page = await callBitrix<Deal[]>("crm.deal.list", {
			select: ["ID", "UTM_CAMPAIGN", DISORDER_FIELD],
			filter: { "!UTM_CAMPAIGN": false },
			order: { ID: "ASC" },
			start,
		});
		deals.push(...page.result);
		if (page.next === undefined) break;
		start = page.next;
	}
	return deals;
}

function isEmptyDisorderField(value: unknown): boolean {
	return !Array.isArray(value) || value.length === 0;
}

async function main() {
	const deals = await listDealsWithCampaign();
	let matched = 0;
	let alreadyFilled = 0;
	let noKeywordMatch = 0;
	let updated = 0;

	for (const deal of deals) {
		const campaign = deal.UTM_CAMPAIGN ?? undefined;
		if (!isEmptyDisorderField(deal[DISORDER_FIELD as keyof Deal])) {
			alreadyFilled++;
			continue;
		}
		const ids = resolveDisorderIds(campaign ?? undefined);
		if (ids.length === 0) {
			noKeywordMatch++;
			continue;
		}
		matched++;
		if (APPLY) {
			await callBitrix<boolean>("crm.deal.update", {
				id: deal.ID,
				fields: { [DISORDER_FIELD]: ids },
			});
		}
		updated++;
		console.log(
			`${APPLY ? "UPDATED" : "WOULD UPDATE"} deal=${deal.ID} campaign="${campaign}" → ids=[${ids.join(",")}]`,
		);
	}

	console.log(
		JSON.stringify(
			{
				mode: APPLY ? "apply" : "plan",
				totalDealsWithCampaign: deals.length,
				alreadyFilled,
				noKeywordMatch,
				matched,
				updated,
			},
			null,
			2,
		),
	);
}

await main();
