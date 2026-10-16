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
} from "drizzle-orm";
import { db } from "../client";
import { emailCampaigns } from "../schema/email-campaign";
import { emailListContacts, emailLists } from "../schema/email-lists";
import { emailSuppressions } from "../schema/email-suppressions";
import { type MergeContactInput, planContactMerge } from "./contact-merge";

export type EmailList = typeof emailLists.$inferSelect;
export type EmailListContact = typeof emailListContacts.$inferSelect;

export interface EmailListSummary extends EmailList {
	contactsCount: number;
	/** Контакты с email и с телефоном (у одного контакта может быть и то, и другое). */
	emailCount: number;
	phoneCount: number;
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
			emailCount: count(emailListContacts.email),
			phoneCount: count(emailListContacts.phone),
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
		emailCount: Number(r.emailCount),
		phoneCount: Number(r.phoneCount),
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
			emailCount: count(emailListContacts.email),
			phoneCount: count(emailListContacts.phone),
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
		emailCount: Number(counts?.emailCount ?? 0),
		phoneCount: Number(counts?.phoneCount ?? 0),
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
		const phoneDigits = search.replace(/\D/g, "");
		const match = or(
			ilike(emailListContacts.email, pattern),
			ilike(emailListContacts.name, pattern),
			...(phoneDigits.length >= 3
				? [ilike(emailListContacts.phone, likePattern(phoneDigits))]
				: []),
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
			.orderBy(desc(emailListContacts.createdAt), asc(emailListContacts.id))
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
		.orderBy(asc(emailListContacts.createdAt), asc(emailListContacts.id));
	return rows.map((r) => ({
		...r.contact,
		suppressionReason: r.suppressionReason ?? null,
	}));
}

export interface AddListContactsResult {
	inserted: number;
	updated: number;
	/** Строки, склеенные с другой строкой этого же импорта. */
	duplicates: number;
	/** Строки, противоречащие списку (см. ContactMergePlan.conflicts). */
	conflicts: number;
}

/**
 * Добавляет контакты в список без дублей (email/телефон уже нормализованы и
 * провалидированы). Совпадение с существующим контактом по телефону или
 * email дополняет его — см. planContactMerge. Имя обновляется, только если
 * в новой строке оно задано: повторный импорт без колонки имени не затирает
 * ранее загруженные имена.
 */
export async function addEmailListContacts(
	listId: string,
	contacts: MergeContactInput[],
	source: "csv" | "manual",
): Promise<AddListContactsResult> {
	const empty = { inserted: 0, updated: 0, duplicates: 0, conflicts: 0 };
	if (!db || contacts.length === 0) return empty;

	const emails = [
		...new Set(contacts.map((c) => c.email).filter((v): v is string => !!v)),
	];
	const phones = [
		...new Set(contacts.map((c) => c.phone).filter((v): v is string => !!v)),
	];
	const matchers = [
		...(emails.length ? [inArray(emailListContacts.email, emails)] : []),
		...(phones.length ? [inArray(emailListContacts.phone, phones)] : []),
	];
	if (matchers.length === 0) return empty;

	const existing = await db
		.select({
			id: emailListContacts.id,
			email: emailListContacts.email,
			phone: emailListContacts.phone,
			name: emailListContacts.name,
		})
		.from(emailListContacts)
		.where(and(eq(emailListContacts.listId, listId), or(...matchers)));

	const plan = planContactMerge(existing, contacts);

	let inserted = 0;
	if (plan.inserts.length > 0) {
		// onConflictDoNothing — защита от гонки двух параллельных импортов в
		// один список: уникальные индексы (list_id, email/phone) не пустят дубль.
		const rows = await db
			.insert(emailListContacts)
			.values(
				plan.inserts.map((c) => ({
					id: crypto.randomUUID(),
					listId,
					email: c.email,
					phone: c.phone,
					name: c.name,
					source,
				})),
			)
			.onConflictDoNothing()
			.returning({ id: emailListContacts.id });
		inserted = rows.length;
	}

	let updated = 0;
	for (const contact of plan.updates) {
		try {
			await db
				.update(emailListContacts)
				.set({
					email: contact.email,
					phone: contact.phone,
					name: contact.name,
				})
				.where(eq(emailListContacts.id, contact.id));
			updated++;
		} catch {
			// Параллельный импорт успел занять этот телефон/email другим
			// контактом — уникальный индекс не дал создать дубль, пропускаем.
			plan.conflicts++;
		}
	}

	await db
		.update(emailLists)
		.set({ updatedAt: new Date() })
		.where(eq(emailLists.id, listId));
	return {
		inserted,
		updated,
		duplicates: plan.duplicatesInBatch + (plan.inserts.length - inserted),
		conflicts: plan.conflicts,
	};
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
