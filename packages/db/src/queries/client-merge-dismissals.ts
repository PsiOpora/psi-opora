import { inArray, or } from "drizzle-orm";
import type { Database } from "../client.types";
import { clientMergeDismissals } from "../schema/client-merge-dismissals";

export interface DismissMergeSuggestionEntry {
	/** Ключи `messenger:userId` канонических identity обеих сторон. */
	keyA: string;
	keyB: string;
	operatorId?: string;
	operatorName?: string;
}

function makeId(keyA: string, keyB: string): string {
	return [keyA, keyB].sort().join("|");
}

/** Запоминает «это разные люди» — подсказка слияния для пары больше не показывается. */
export async function dismissMergeSuggestion(
	db: Database,
	entry: DismissMergeSuggestionEntry,
): Promise<void> {
	if (!db) return;
	const [keyA, keyB] = [entry.keyA, entry.keyB].sort() as [string, string];
	await db
		.insert(clientMergeDismissals)
		.values({
			id: makeId(keyA, keyB),
			keyA,
			keyB,
			dismissedByOperatorId: entry.operatorId,
			dismissedByOperatorName: entry.operatorName,
		})
		.onConflictDoNothing();
}

/**
 * Ключи «второй стороны» всех отклонённых пар, где участвует хоть один из
 * переданных ключей (identity группы клиента).
 */
export async function listDismissedPartnerKeys(
	db: Database,
	keys: string[],
): Promise<Set<string>> {
	if (!db || keys.length === 0) return new Set();
	const rows = await db
		.select({
			keyA: clientMergeDismissals.keyA,
			keyB: clientMergeDismissals.keyB,
		})
		.from(clientMergeDismissals)
		.where(
			or(
				inArray(clientMergeDismissals.keyA, keys),
				inArray(clientMergeDismissals.keyB, keys),
			),
		);
	const own = new Set(keys);
	const partners = new Set<string>();
	for (const row of rows) {
		if (!own.has(row.keyA)) partners.add(row.keyA);
		if (!own.has(row.keyB)) partners.add(row.keyB);
	}
	return partners;
}
