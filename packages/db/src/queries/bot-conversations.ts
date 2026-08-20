import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { botConversations } from "../schema/bot-conversations";

export type BotConversation = typeof botConversations.$inferSelect;

function makeId(messenger: string, userId: string): string {
	return `${messenger}:${userId}`;
}

/** Диалог отмечен прочитанным (общий курсор — не персональный на менеджера). */
export async function markConversationRead(
	db: Database,
	messenger: string,
	userId: string,
): Promise<void> {
	if (!db) return;
	const id = makeId(messenger, userId);
	await db
		.insert(botConversations)
		.values({ id, messenger, userId, lastReadAt: new Date() })
		.onConflictDoUpdate({
			target: botConversations.id,
			set: { lastReadAt: new Date(), updatedAt: new Date() },
		});
}

export interface ConversationAssignment {
	messenger: string;
	userId: string;
	operatorId: string;
	operatorName: string;
}

/** Назначает ответственного менеджера на диалог (перезаписывает предыдущего). */
export async function assignConversation(
	db: Database,
	entry: ConversationAssignment,
): Promise<void> {
	if (!db) return;
	const id = makeId(entry.messenger, entry.userId);
	await db
		.insert(botConversations)
		.values({
			id,
			messenger: entry.messenger,
			userId: entry.userId,
			assignedOperatorId: entry.operatorId,
			assignedOperatorName: entry.operatorName,
		})
		.onConflictDoUpdate({
			target: botConversations.id,
			set: {
				assignedOperatorId: entry.operatorId,
				assignedOperatorName: entry.operatorName,
				updatedAt: new Date(),
			},
		});
}

/**
 * Назначает ответственного, только если диалог ещё никому не назначен —
 * «первый ответивший — ответственный» (см. apps/bitrix-webhook, ответ
 * оператора прямо из Открытой линии Bitrix24).
 */
export async function assignConversationIfUnassigned(
	db: Database,
	entry: ConversationAssignment,
): Promise<void> {
	if (!db) return;
	const id = makeId(entry.messenger, entry.userId);
	await db
		.insert(botConversations)
		.values({
			id,
			messenger: entry.messenger,
			userId: entry.userId,
			assignedOperatorId: entry.operatorId,
			assignedOperatorName: entry.operatorName,
		})
		.onConflictDoUpdate({
			target: botConversations.id,
			set: {
				assignedOperatorId: entry.operatorId,
				assignedOperatorName: entry.operatorName,
				updatedAt: new Date(),
			},
			setWhere: isNull(botConversations.assignedOperatorId),
		});
}

/** Полностью заменяет набор тегов диалога (пустой массив — снять все теги). */
export async function setConversationTags(
	db: Database,
	messenger: string,
	userId: string,
	tags: string[],
): Promise<void> {
	if (!db) return;
	const id = makeId(messenger, userId);
	await db
		.insert(botConversations)
		.values({ id, messenger, userId, tags })
		.onConflictDoUpdate({
			target: botConversations.id,
			set: { tags, updatedAt: new Date() },
		});
}

/**
 * Добавляет один тег к диалогу — атомарно, одним UPDATE (dedup через
 * jsonb_array_elements_text + jsonb_agg DISTINCT), а не app-level
 * read-then-write через getConversationMeta+setConversationTags. Это важно:
 * setConversationTags вызывается и из дашборда (оператор правит теги
 * руками, полная замена массива), и из бота (см. triageOffScriptMessage) —
 * при read-then-write эти два источника гонятся друг с другом и могут
 * затереть чужие изменения. Атомарный UPDATE снимает эту гонку на стороне
 * добавления тега (полная замена оператором остаётся как есть — это
 * осознанное поведение самого редактора тегов, а не то, что чинит эта
 * функция).
 */
export async function addConversationTag(
	db: Database,
	messenger: string,
	userId: string,
	tag: string,
): Promise<void> {
	if (!db) return;
	const id = makeId(messenger, userId);
	await db
		.insert(botConversations)
		.values({ id, messenger, userId, tags: [tag] })
		.onConflictDoUpdate({
			target: botConversations.id,
			set: {
				tags: sql`(
          select coalesce(jsonb_agg(distinct elem), '[]'::jsonb)
          from jsonb_array_elements_text(
            coalesce(${botConversations.tags}, '[]'::jsonb)
              || jsonb_build_array(${tag}::text)
          ) as elem
        )`,
				updatedAt: new Date(),
			},
		});
}

export async function getConversationMeta(
	db: Database,
	messenger: string,
	userId: string,
): Promise<BotConversation | null> {
	if (!db) return null;
	const [row] = await db
		.select()
		.from(botConversations)
		.where(
			and(
				eq(botConversations.messenger, messenger),
				eq(botConversations.userId, userId),
			),
		)
		.limit(1);
	return row ?? null;
}
