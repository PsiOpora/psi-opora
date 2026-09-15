const messenger = process.argv[2] ?? "telegram";
const prefix = messenger === "telegram" ? "TG" : "MAX";
const webhookUrl =
	process.env[`${prefix}_BITRIX_WEBHOOK_URL`] ?? process.env.BITRIX_WEBHOOK_URL;
if (!webhookUrl) throw new Error("no webhook url");
const base = webhookUrl.replace(/\/$/, "");

async function call(method: string, body: unknown) {
	const res = await fetch(`${base}/${method}.json`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return res.json();
}

// 1. Все поля сделки (в т.ч. кастомные UF_CRM_*)
const fieldsResp = await call("crm.deal.fields", {});
const fields = fieldsResp.result as Record<
	string,
	{ type: string; statusType?: string; title: string; items?: unknown[] }
>;

// 2. Все статусы/справочники — фильтр ENTITY_ID не работает через вебхук, тянем всё с пагинацией
const allStatuses: Record<string, unknown>[] = [];
let start = 0;
for (;;) {
	const resp = await call("crm.status.list", { start });
	const batch = (resp.result ?? []) as Record<string, unknown>[];
	allStatuses.push(...batch);
	if (!resp.next || batch.length === 0) break;
	start = resp.next as number;
}

// 3. Группируем справочники по ENTITY_ID
const byEntity: Record<string, Record<string, unknown>[]> = {};
for (const row of allStatuses) {
	const entity = String(row.ENTITY_ID);
	if (!byEntity[entity]) byEntity[entity] = [];
	byEntity[entity].push(row);
}

// 4. Пример реальных сделок — какие значения полей реально встречаются (последние 100)
const dealsResp = await call("crm.deal.list", {
	select: [
		"ID",
		"SOURCE_ID",
		"SOURCE_DESCRIPTION",
		"UTM_SOURCE",
		"UTM_MEDIUM",
		"UTM_CAMPAIGN",
		"TYPE_ID",
		"ORIGINATOR_ID",
	],
	order: { ID: "DESC" },
	start: 0,
});
const recentDeals = dealsResp.result ?? [];

const out = {
	fields,
	directoriesByEntity: Object.fromEntries(
		Object.entries(byEntity).map(([k, v]) => [
			k,
			v.map((r) => ({
				STATUS_ID: r.STATUS_ID,
				NAME: r.NAME,
				SYSTEM: r.SYSTEM,
			})),
		]),
	),
	recentDealsSample: recentDeals,
};

await Bun.write(
	new URL(`./deal-fields-audit-${messenger}.json`, import.meta.url),
	JSON.stringify(out, null, 2),
);
console.log("done");
