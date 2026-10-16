import { count, desc, eq, ilike, inArray } from "drizzle-orm";
import { db } from "../client";
import { emailSuppressions } from "../schema/email-suppressions";

export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type EmailSuppressionReason =
	| "unsubscribed"
	| "bounced"
	| "complained"
	| "manual";

function normalize(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Добавляет адрес в стоп-лист. Если адрес уже там — причина не меняется:
 * первая причина (например, жалоба) информативнее последующей отписки.
 */
export async function addEmailSuppression(entry: {
	email: string;
	reason: EmailSuppressionReason;
	campaignId?: string | null;
	details?: string | null;
}): Promise<void> {
	if (!db) return;
	await db
		.insert(emailSuppressions)
		.values({
			email: normalize(entry.email),
			reason: entry.reason,
			campaignId: entry.campaignId ?? null,
			details: entry.details ?? null,
		})
		.onConflictDoNothing({ target: emailSuppressions.email });
}

export async function removeEmailSuppression(email: string): Promise<void> {
	if (!db) return;
	await db
		.delete(emailSuppressions)
		.where(eq(emailSuppressions.email, normalize(email)));
}

/** Причины стоп-листа по набору адресов (ключ — нормализованный адрес). */
export async function getEmailSuppressions(
	emails: string[],
): Promise<Map<string, EmailSuppressionReason>> {
	const result = new Map<string, EmailSuppressionReason>();
	if (!db || emails.length === 0) return result;
	const normalized = [...new Set(emails.map(normalize))];
	// Пачками — у Postgres лимит на число параметров в запросе.
	for (let i = 0; i < normalized.length; i += 5000) {
		const rows = await db
			.select({
				email: emailSuppressions.email,
				reason: emailSuppressions.reason,
			})
			.from(emailSuppressions)
			.where(inArray(emailSuppressions.email, normalized.slice(i, i + 5000)));
		for (const row of rows) {
			result.set(row.email, row.reason as EmailSuppressionReason);
		}
	}
	return result;
}

export async function listEmailSuppressionsPage(params: {
	search?: string;
	limit: number;
	offset: number;
}): Promise<{ rows: EmailSuppression[]; total: number }> {
	if (!db) return { rows: [], total: 0 };
	const search = params.search?.trim().toLowerCase();
	const where = search
		? ilike(
				emailSuppressions.email,
				`%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`,
			)
		: undefined;
	const [rows, [totalRow]] = await Promise.all([
		db
			.select()
			.from(emailSuppressions)
			.where(where)
			.orderBy(desc(emailSuppressions.createdAt))
			.limit(params.limit)
			.offset(params.offset),
		db.select({ total: count() }).from(emailSuppressions).where(where),
	]);
	return { rows, total: Number(totalRow?.total ?? 0) };
}
