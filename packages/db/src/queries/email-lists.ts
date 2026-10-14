import {
	and,
	asc,
	count,
	desc,
	eq,
	ilike,
	inArray,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import { db } from "../client";
import { emailCampaigns } from "../schema/email-campaign";
import { emailListContacts, emailLists } from "../schema/email-lists";
import { emailSuppressions } from "../schema/email-suppressions";

export type EmailList = typeof emailLists.$inferSelect;
export type EmailListContact = typeof emailListContacts.$inferSelect;

export interface EmailListSummary extends EmailList {
	contactsCount: number;
	/** Контакты из глобального стоп-листа — им рассылка уйти не может. */
	suppressedCount: number;
}

export interface EmailListContactRow extends EmailListContact {
	suppressionReason: string | null;
}

/** Экранирует спецсимволы LIKE, чтобы поиск по "_" или "%" не был шаблоном. */
function likePattern(search: string): string {
	return `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export async function listEmailLists(): Promise<EmailListSummary[]> {
	if (!db) return [];
	const rows = await db
		.select({
			list: emailLists,
			contactsCount: count(emailListContacts.id),
			suppressedCount: count(emailSuppressions.email),
		})
		.from(emailLists)
		.leftJoin(emailListContacts, eq(emailListContacts.listId, emailLists.id))
		.leftJoin(
			emailSuppressions,
			eq(emailSuppressions.email, emailListContacts.email),
		)
		.groupBy(emailLists.id)
		.orderBy(desc(emailLists.createdAt));
	return rows.map((r) => ({
		...r.list,
		contactsCount: Number(r.contactsCount),
		suppressedCount: Number(r.suppressedCount),
	}));
}

export async function getEmailList(
	id: string,
): Promise<EmailListSummary | null> {
	if (!db) return null;
	const [list] = await db
		.select()
		.from(emailLists)
		.where(eq(emailLists.id, id))
		.limit(1);
	if (!list) return null;
	const [counts] = await db
		.select({
			contactsCount: count(emailListContacts.id),
			suppressedCount: count(emailSuppressions.email),
		})
		.from(emailListContacts)
		.leftJoin(
			emailSuppressions,
			eq(emailSuppressions.email, emailListContacts.email),
		)
		.where(eq(emailListContacts.listId, id));
	return {
		...list,
		contactsCount: Number(counts?.contactsCount ?? 0),
		suppressedCount: Number(counts?.suppressedCount ?? 0),
	};
}

export async function createEmailList(data: {
	name: string;
	description?: string | null;
}): Promise<EmailList | null> {
	if (!db) return null;
	const [row] = await db
		.insert(emailLists)
		.values({
			id: crypto.randomUUID(),
			name: data.name,
			description: data.description ?? null,
		})
		.returning();
	return row ?? null;
}

export async function updateEmailList(
	id: string,
	data: { name: string; description?: string | null },
): Promise<void> {
	if (!db) return;
	await db
		.update(emailLists)
		.set({
			name: data.name,
			description: data.description ?? null,
			updatedAt: new Date(),
		})
		.where(eq(emailLists.id, id));
}

export async function deleteEmailList(id: string): Promise<void> {
	if (!db) return;
	await db.delete(emailLists).where(eq(emailLists.id, id));
}

/** Идёт ли по списку незавершённая рассылка — такой список удалять нельзя. */
export async function hasActiveEmailCampaignForList(
	listId: string,
): Promise<boolean> {
	if (!db) return false;
	const rows = await db
		.select({ id: emailCampaigns.id })
		.from(emailCampaigns)
		.where(
			and(
				eq(emailCampaigns.listId, listId),
				inArray(emailCampaigns.status, ["queued", "running"]),
			),
		)
		.limit(1);
	return rows.length > 0;
}

export async function listEmailListContactsPage(params: {
	listId: string;
	search?: string;
	filter?: "all" | "active" | "suppressed";
	limit: number;
	offset: number;
}): Promise<{ rows: EmailListContactRow[]; total: number }> {
	if (!db) return { rows: [], total: 0 };
	const conditions = [eq(emailListContacts.listId, params.listId)];
	const search = params.search?.trim();
	if (search) {
		const pattern = likePattern(search);
		const match = or(
			ilike(emailListContacts.email, pattern),
			ilike(emailListContacts.name, pattern),
		);
		if (match) conditions.push(match);
	}
	if (params.filter === "active")
		conditions.push(isNull(emailSuppressions.email));
	if (params.filter === "suppressed")
		conditions.push(isNotNull(emailSuppressions.email));
	const where = and(...conditions);

	const [rows, [totalRow]] = await Promise.all([
		db
			.select({
				contact: emailListContacts,
				suppressionReason: emailSuppressions.reason,
			})
			.from(emailListContacts)
			.leftJoin(
				emailSuppressions,
				eq(emailSuppressions.email, emailListContacts.email),
			)
			.where(where)
			.orderBy(desc(emailListContacts.createdAt), asc(emailListContacts.email))
			.limit(params.limit)
			.offset(params.offset),
		db
			.select({ total: count() })
			.from(emailListContacts)
			.leftJoin(
				emailSuppressions,
				eq(emailSuppressions.email, emailListContacts.email),
			)
			.where(where),
	]);

	return {
		rows: rows.map((r) => ({
			...r.contact,
			suppressionReason: r.suppressionReason ?? null,
		})),
		total: Number(totalRow?.total ?? 0),
	};
}

/** Все контакты списка с отметкой стоп-листа — для запуска рассылки и экспорта. */
export async function listAllEmailListContacts(
	listId: string,
): Promise<EmailListContactRow[]> {
	if (!db) return [];
	const rows = await db
		.select({
			contact: emailListContacts,
			suppressionReason: emailSuppressions.reason,
		})
		.from(emailListContacts)
		.leftJoin(
			emailSuppressions,
			eq(emailSuppressions.email, emailListContacts.email),
		)
		.where(eq(emailListContacts.listId, listId))
		.orderBy(asc(emailListContacts.email));
	return rows.map((r) => ({
		...r.contact,
		suppressionReason: r.suppressionReason ?? null,
	}));
}

/**
 * Добавляет контакты в список (email уже нормализован и провалидирован).
 * Существующий в списке адрес не дублируется; имя обновляется, только если
 * в новой строке оно задано — повторный импорт без колонки имени не затирает
 * ранее загруженные имена.
 */
export async function addEmailListContacts(
	listId: string,
	contacts: Array<{ email: string; name?: string | null }>,
	source: "csv" | "manual",
): Promise<{ inserted: number; updated: number }> {
	if (!db || contacts.length === 0) return { inserted: 0, updated: 0 };
	// Postgres не даёт ON CONFLICT DO UPDATE задеть одну строку дважды за
	// запрос — повторы адреса внутри пачки схлопываем заранее.
	const unique = new Map<string, { email: string; name?: string | null }>();
	for (const c of contacts) {
		const prev = unique.get(c.email);
		unique.set(c.email, { email: c.email, name: c.name || prev?.name });
	}
	const rows = await db
		.insert(emailListContacts)
		.values(
			[...unique.values()].map((c) => ({
				id: crypto.randomUUID(),
				listId,
				email: c.email,
				name: c.name?.trim() || null,
				source,
			})),
		)
		.onConflictDoUpdate({
			target: [emailListContacts.listId, emailListContacts.email],
			set: {
				name: sql`coalesce(excluded.name, ${emailListContacts.name})`,
			},
		})
		// xmax = 0 только у только что вставленной строки — так отличаем
		// вставку от обновления существующего контакта в одном запросе.
		.returning({ inserted: sql<boolean>`(xmax = 0)` });
	const inserted = rows.filter((r) => r.inserted).length;
	await db
		.update(emailLists)
		.set({ updatedAt: new Date() })
		.where(eq(emailLists.id, listId));
	return { inserted, updated: rows.length - inserted };
}

export async function deleteEmailListContacts(
	listId: string,
	ids: string[],
): Promise<number> {
	if (!db || ids.length === 0) return 0;
	const rows = await db
		.delete(emailListContacts)
		.where(
			and(
				eq(emailListContacts.listId, listId),
				inArray(emailListContacts.id, ids),
			),
		)
		.returning({ id: emailListContacts.id });
	return rows.length;
}
