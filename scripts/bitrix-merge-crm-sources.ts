// Bitrix24 CRM "Источник" cleanup: merges duplicate directory entries
// (Telegram/MAX/WhatsApp variants) into three canonical values, across
// leads, deals, contacts and companies.
//
// Setup:
//   export BITRIX_WEBHOOK_URL="https://your-portal.bitrix24.ru/rest/1/xxxxxxxxxxxxxxxx/"
//
// Usage (always run in this order):
//   bun run scripts/bitrix-merge-crm-sources.ts --plan
//     Prints the current directory + how many records reference each
//     value to merge. Makes no changes.
//
//   bun run scripts/bitrix-merge-crm-sources.ts --apply
//     Reassigns SOURCE_ID on all matching leads/deals/contacts/companies
//     to the canonical value, and renames the three canonical directory
//     entries. Does NOT delete the now-empty old directory entries.
//     Prints a full plan and requires typing "ДА" before writing anything.
//
//   bun run scripts/bitrix-merge-crm-sources.ts --cleanup
//     Deletes old directory entries that no longer have any records
//     pointing at them (re-checks before each delete; refuses to delete
//     anything still referenced). Also requires typing "ДА".
//
// Webhook needs scopes: crm (read+write) covering leads, deals, contacts,
// companies and the CRM status directory.

import { createInterface } from "node:readline/promises";

const WEBHOOK = `${(process.env.BITRIX_WEBHOOK_URL || "").replace(/\/+$/, "")}/`;

const ENTITY_TYPE_IDS: Record<string, number> = {
	lead: 1,
	deal: 2,
	contact: 3,
	company: 4,
};

type MergePlanEntry = { renameFrom: string; mergeFrom: string[] };

const MERGE_PLAN: Record<string, MergePlanEntry> = {
	Telegram: {
		renameFrom: "Telegram-бот",
		mergeFrom: [
			"Инвайт ТГ",
			"WAZZUP: Telegram - Открытая линия",
			"Tgapi Клюев Андрей ТГ",
			"Tgapi 79310096002",
			"TG Bot kluevzabotabot",
			"Tgapi ТГ 3332",
			"Telegram kluvand_bot",
		],
	},
	MAX: {
		renameFrom: "MAX-бот",
		mergeFrom: [
			"Инвайт МАКС",
			"MAX - МАКС",
			"WAZZUP: Max - Открытая линия 2",
			"Max 79307073332",
			"Max МАКС 79307073332",
			"Maxbot id525603925717_bot",
		],
	},
	WhatsApp: {
		renameFrom: "Whatsapp 79307073332",
		mergeFrom: [],
	},
};

type StatusEntry = { ID: string | number; STATUS_ID: string; NAME: string };
type BitrixItem = { id: string | number; [key: string]: unknown };
type BitrixResponse = {
	result?: unknown;
	error?: string;
	error_description?: string;
	next?: number;
};

async function call(
	method: string,
	params: Record<string, unknown> = {},
): Promise<BitrixResponse> {
	const resp = await fetch(WEBHOOK + method, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(params),
	});
	const data = (await resp.json()) as BitrixResponse;
	if (data.error) {
		throw new Error(
			`${method} failed: ${data.error_description || data.error}`,
		);
	}
	return data;
}

// Bitrix batch cmd values are query strings, not JSON, so nested objects
// (e.g. fields: {sourceId: ...}) must become fields[sourceId]=... pairs -
// URLSearchParams alone won't flatten nested objects for you.
function flattenParams(
	params: Record<string, unknown>,
	prefix = "",
): [string, string][] {
	const pairs: [string, string][] = [];
	for (const [k, v] of Object.entries(params)) {
		const key = prefix ? `${prefix}[${k}]` : k;
		if (v !== null && typeof v === "object" && !Array.isArray(v)) {
			pairs.push(...flattenParams(v as Record<string, unknown>, key));
		} else if (Array.isArray(v)) {
			v.forEach((item, i) => {
				if (item !== null && typeof item === "object") {
					pairs.push(...flattenParams(item, `${key}[${i}]`));
				} else {
					pairs.push([`${key}[${i}]`, String(item)]);
				}
			});
		} else {
			pairs.push([key, String(v)]);
		}
	}
	return pairs;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function batchCall(
	cmd: Record<string, [string, Record<string, unknown>]>,
) {
	const entries = Object.entries(cmd);
	const results: Record<string, unknown> = {};
	const errors: Record<string, unknown> = {};
	for (let i = 0; i < entries.length; i += 50) {
		const chunk = entries.slice(i, i + 50);
		const encoded: Record<string, string> = {};
		for (const [key, [method, params]] of chunk) {
			const qs = new URLSearchParams(flattenParams(params)).toString();
			encoded[key] = `${method}?${qs}`;
		}
		const data = await call("batch", { halt: 0, cmd: encoded });
		const batchResult = data.result as {
			result?: Record<string, unknown>;
			result_error?: Record<string, unknown>;
		};
		Object.assign(results, batchResult.result);
		Object.assign(errors, batchResult.result_error || {});
		await sleep(300);
	}
	return { results, errors };
}

async function getSourceDirectory(): Promise<Map<string, StatusEntry[]>> {
	const data = await call("crm.status.list", {
		filter: { ENTITY_ID: "SOURCE" },
		order: { SORT: "ASC" },
	});
	const byName = new Map<string, StatusEntry[]>();
	for (const item of data.result as StatusEntry[]) {
		if (!byName.has(item.NAME)) byName.set(item.NAME, []);
		byName.get(item.NAME)?.push(item);
	}
	return byName;
}

// entityTypeId -> whether it has a "sourceId" field, filled in lazily.
// Never assume - contacts/companies may not have this field on every
// portal, and an unsupported "@sourceId" filter could in theory be
// ignored by the API instead of erroring, which would turn a "merge these
// 12 records" update into "update every contact in the CRM".
const sourceFieldSupport = new Map<number, boolean>();

async function entitySupportsSource(entityTypeId: number): Promise<boolean> {
	if (!sourceFieldSupport.has(entityTypeId)) {
		const data = await call("crm.item.fields", { entityTypeId });
		const fields =
			(data.result as { fields?: Record<string, unknown> } | undefined)
				?.fields || {};
		sourceFieldSupport.set(entityTypeId, "sourceId" in fields);
	}
	const supported = sourceFieldSupport.get(entityTypeId);
	if (supported === undefined)
		throw new Error(
			`entitySupportsSource: missing cache entry for ${entityTypeId}`,
		);
	return supported;
}

// Returns null (not []) if this entity type has no sourceId field at all,
// so callers can tell "nothing to merge" apart from "can't check".
async function findItemsBySource(
	entityTypeId: number,
	sourceCodes: string[],
	select: string[] = ["id"],
): Promise<BitrixItem[] | null> {
	if (!(await entitySupportsSource(entityTypeId))) return null;

	const found: BitrixItem[] = [];
	let start = 0;
	const seenStarts = new Set<number>();
	while (true) {
		const data = await call("crm.item.list", {
			entityTypeId,
			select,
			filter: { "@sourceId": sourceCodes },
			start,
		});
		const result =
			(data.result as { items?: BitrixItem[]; next?: number } | undefined) ||
			{};
		const items = Array.isArray(result.items) ? result.items : [];
		found.push(...items);
		const nxt = data.next ?? result.next ?? null;
		if (nxt === null || nxt === undefined || seenStarts.has(nxt)) break;
		seenStarts.add(nxt);
		start = nxt;
	}
	return found;
}

async function confirm(promptText: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = (await rl.question(promptText)).trim();
	rl.close();
	return answer === "ДА";
}

function printTargetPortal() {
	try {
		console.log(`Портал: ${new URL(WEBHOOK).host}\n`);
	} catch {
		console.log("!! BITRIX_WEBHOOK_URL не похож на валидный URL\n");
	}
}

function warnDuplicateCanonicalNames(byName: Map<string, StatusEntry[]>) {
	for (const cfg of Object.values(MERGE_PLAN)) {
		const entries = byName.get(cfg.renameFrom);
		if (entries && entries.length > 1) {
			console.log(
				`!! В справочнике ${entries.length} записей с именем «${cfg.renameFrom}» — использую только ID=${entries[0].ID}, остальные (${entries
					.slice(1)
					.map((e) => e.ID)
					.join(", ")}) не будут учтены`,
			);
		}
	}
}

async function plan() {
	printTargetPortal();
	const byName = await getSourceDirectory();
	warnDuplicateCanonicalNames(byName);
	console.log("=== Текущий справочник Источник ===");
	for (const [name, entries] of byName) {
		for (const e of entries) {
			console.log(
				`  ID=${String(e.ID).padEnd(5)} STATUS_ID=${String(e.STATUS_ID).padEnd(20)} NAME=${name}`,
			);
		}
	}
	console.log();

	console.log("=== Поддержка поля sourceId по типам сущностей ===");
	for (const [entityName, entityTypeId] of Object.entries(ENTITY_TYPE_IDS)) {
		const supported = await entitySupportsSource(entityTypeId);
		console.log(
			`  ${entityName}: ${supported ? "да" : "НЕТ — будет пропущен"}`,
		);
	}
	console.log();

	for (const [canonical, cfg] of Object.entries(MERGE_PLAN)) {
		console.log(`--- ${canonical} (переименовать из «${cfg.renameFrom}») ---`);
		if (!byName.has(cfg.renameFrom)) {
			console.log(`  !! НЕ НАЙДЕНО в справочнике: ${cfg.renameFrom}`);
			continue;
		}
		for (const oldName of cfg.mergeFrom) {
			const entries = byName.get(oldName);
			if (!entries) {
				console.log(`  !! НЕ НАЙДЕНО в справочнике: ${oldName}`);
				continue;
			}
			const oldCodes = entries.map((e) => e.STATUS_ID);
			for (const [entityName, entityTypeId] of Object.entries(
				ENTITY_TYPE_IDS,
			)) {
				const items = await findItemsBySource(entityTypeId, oldCodes);
				if (items?.length) {
					console.log(`  ${oldName}: ${items.length} записей в ${entityName}`);
				}
			}
		}
		console.log();
	}
}

type WorkItem = {
	canonical: string;
	canonicalId: string | number;
	canonicalCode: string;
	entityName: string;
	entityTypeId: number;
	items: BitrixItem[];
};

async function collectApplyPlan(byName: Map<string, StatusEntry[]>) {
	const work: WorkItem[] = [];
	const skipped: string[] = [];

	for (const [canonical, cfg] of Object.entries(MERGE_PLAN)) {
		if (!byName.has(cfg.renameFrom)) {
			skipped.push(`${canonical}: не найден исходник «${cfg.renameFrom}»`);
			continue;
		}
		const canonicalEntry = byName.get(cfg.renameFrom)?.[0];
		if (!canonicalEntry) {
			skipped.push(`${canonical}: не найден исходник «${cfg.renameFrom}»`);
			continue;
		}
		const canonicalId = canonicalEntry.ID;
		const canonicalCode = canonicalEntry.STATUS_ID;

		const oldCodes: string[] = [];
		for (const oldName of cfg.mergeFrom) {
			const entries = byName.get(oldName);
			if (!entries) {
				skipped.push(
					`${canonical}: не найден дубль «${oldName}» (пропускаю только его)`,
				);
				continue;
			}
			oldCodes.push(...entries.map((e) => e.STATUS_ID));
		}

		for (const [entityName, entityTypeId] of Object.entries(ENTITY_TYPE_IDS)) {
			if (!(await entitySupportsSource(entityTypeId))) continue;
			const items = oldCodes.length
				? await findItemsBySource(entityTypeId, oldCodes)
				: [];
			work.push({
				canonical,
				canonicalId,
				canonicalCode,
				entityName,
				entityTypeId,
				items: items || [],
			});
		}
	}
	return { work, skipped };
}

const MAX_SANE_UPDATE_COUNT = 2000;

async function applyMerge() {
	printTargetPortal();
	const byName = await getSourceDirectory();
	warnDuplicateCanonicalNames(byName);
	const { work, skipped } = await collectApplyPlan(byName);

	console.log("=== План изменений ===");
	for (const msg of skipped) console.log(`  !! ${msg}`);
	let total = 0;
	for (const w of work) {
		if (w.items.length) {
			console.log(
				`  ${w.canonical}: ${w.items.length} записей в ${w.entityName} -> sourceId=${w.canonicalCode}`,
			);
			total += w.items.length;
		}
	}
	for (const [canonical, cfg] of Object.entries(MERGE_PLAN)) {
		console.log(`  Переименовать «${cfg.renameFrom}» -> «${canonical}»`);
	}
	console.log(`\nВсего записей будет обновлено: ${total}`);

	if (total > MAX_SANE_UPDATE_COUNT) {
		console.log(
			`\n!! Это подозрительно много (> ${MAX_SANE_UPDATE_COUNT}) для ожидаемого объёма дублей мессенджеров.`,
			"Похоже на ошибку в справочнике или фильтре, а не на реальный список дублей. Прерываю без изменений — проверьте --plan вручную.",
		);
		return;
	}

	if (!(await confirm("\nВведите ДА для применения изменений: "))) {
		console.log("Отменено, ничего не изменено.");
		return;
	}

	for (const w of work) {
		if (!w.items.length) continue;
		console.log(
			`${w.canonical} / ${w.entityName}: обновляю ${w.items.length} записей`,
		);
		const cmd: Record<string, [string, Record<string, unknown>]> = {};
		for (const item of w.items) {
			cmd[`u${item.id}`] = [
				"crm.item.update",
				{
					entityTypeId: w.entityTypeId,
					id: item.id,
					fields: { sourceId: w.canonicalCode },
				},
			];
		}
		const { errors } = await batchCall(cmd);
		if (Object.keys(errors).length) console.log("  ошибки:", errors);
	}

	for (const [canonical, cfg] of Object.entries(MERGE_PLAN)) {
		if (!byName.has(cfg.renameFrom)) continue;
		const canonicalId = byName.get(cfg.renameFrom)?.[0]?.ID;
		if (canonicalId === undefined) continue;
		console.log(
			`Переименовываю directory ID=${canonicalId} «${cfg.renameFrom}» -> «${canonical}»`,
		);
		try {
			await call("crm.status.update", {
				id: canonicalId,
				fields: { NAME: canonical },
			});
		} catch (e) {
			console.log(
				`  !! не удалось переименовать: ${e instanceof Error ? e.message : e}`,
			);
		}
	}

	console.log(
		"\nГотово. Старые пункты справочника пока не удалены — запустите --cleanup после проверки.",
	);
}

async function cleanup() {
	printTargetPortal();
	const byName = await getSourceDirectory();
	warnDuplicateCanonicalNames(byName);
	const toDelete: { oldName: string; id: string | number }[] = [];

	for (const [, cfg] of Object.entries(MERGE_PLAN)) {
		for (const oldName of cfg.mergeFrom) {
			for (const e of byName.get(oldName) || []) {
				let stillReferenced = false;
				for (const [entityName, entityTypeId] of Object.entries(
					ENTITY_TYPE_IDS,
				)) {
					if (!(await entitySupportsSource(entityTypeId))) continue;
					const items = await findItemsBySource(entityTypeId, [e.STATUS_ID]);
					if (items?.length) {
						stillReferenced = true;
						console.log(
							`!! ${oldName} (ID=${e.ID}) всё ещё используется в ${entityName} (${items.length}), не удаляю`,
						);
					}
				}
				if (!stillReferenced) toDelete.push({ oldName, id: e.ID });
			}
		}
	}

	if (!toDelete.length) {
		console.log("Нечего удалять.");
		return;
	}

	console.log("\nБудут удалены пустые пункты справочника:");
	for (const { oldName, id } of toDelete)
		console.log(`  ${oldName} (ID=${id})`);

	if (!(await confirm("\nВведите ДА для удаления: "))) {
		console.log("Отменено, ничего не удалено.");
		return;
	}

	for (const { oldName, id } of toDelete) {
		console.log(`Удаляю: ${oldName} (ID=${id})`);
		try {
			await call("crm.status.delete", { id });
		} catch (e) {
			console.log(
				`  !! не удалось удалить: ${e instanceof Error ? e.message : e}`,
			);
		}
	}
}

async function main() {
	if (!process.env.BITRIX_WEBHOOK_URL) {
		console.error("Задайте переменную окружения BITRIX_WEBHOOK_URL");
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.includes("--plan")) await plan();
	else if (args.includes("--apply")) await applyMerge();
	else if (args.includes("--cleanup")) await cleanup();
	else {
		console.error("Укажите один из флагов: --plan, --apply, --cleanup");
		process.exit(1);
	}
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
