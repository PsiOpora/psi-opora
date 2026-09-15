import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "../client";
import { dealDictionaries } from "../schema/deal-dictionaries";

export type DealDictionaryType = "source" | "category" | "stage" | "failReason";

export interface NewDealDictionaryEntry {
	type: DealDictionaryType;
	id: string;
	name: string;
	sort?: number;
}

/**
 * Полная замена справочника одного типа — upsert пришедших записей + удаление
 * старых, не пришедших в этот раз. Без транзакции (neon-http драйвер их не
 * поддерживает) — upsert идёт первым, поэтому в худшем случае конкурентное
 * чтение увидит на мгновение и старые, и новые записи, но не пропуск данных.
 */
export async function replaceDealDictionary(
	type: DealDictionaryType,
	entries: NewDealDictionaryEntry[],
): Promise<void> {
	if (!db) return;
	if (entries.length > 0) {
		await db
			.insert(dealDictionaries)
			.values(
				entries.map((e) => ({
					type: e.type,
					id: e.id,
					name: e.name,
					sort: e.sort ?? 0,
				})),
			)
			.onConflictDoUpdate({
				target: [dealDictionaries.type, dealDictionaries.id],
				set: {
					name: sql`excluded.name`,
					sort: sql`excluded.sort`,
					syncedAt: sql`now()`,
				},
			});
	}
	const currentIds = entries.map((e) => e.id);
	await db
		.delete(dealDictionaries)
		.where(
			currentIds.length > 0
				? and(
						eq(dealDictionaries.type, type),
						notInArray(dealDictionaries.id, currentIds),
					)
				: eq(dealDictionaries.type, type),
		);
}

/** Имена значений справочника (source/category) — ключ id, значение name. */
export async function getDealDictionaryNames(
	type: DealDictionaryType,
): Promise<Map<string, string>> {
	if (!db) return new Map();
	const rows = await db
		.select({ id: dealDictionaries.id, name: dealDictionaries.name })
		.from(dealDictionaries)
		.where(eq(dealDictionaries.type, type));
	return new Map(rows.map((r) => [r.id, r.name]));
}

export interface DealStageInfo {
	name: string;
	sort: number;
}

/** Справочник стадий (type=stage) с сортировкой воронки. */
export async function getDealStageNames(): Promise<Map<string, DealStageInfo>> {
	if (!db) return new Map();
	const rows = await db
		.select({
			id: dealDictionaries.id,
			name: dealDictionaries.name,
			sort: dealDictionaries.sort,
		})
		.from(dealDictionaries)
		.where(eq(dealDictionaries.type, "stage"));
	return new Map(rows.map((r) => [r.id, { name: r.name, sort: r.sort }]));
}
