import { and, asc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../client";
import {
	type ScheduledMessageAttachment,
	type ScheduledMessageKind,
	type ScheduledMessageStatus,
	scheduledMessages,
} from "../schema/scheduled-messages";

export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type {
	ScheduledMessageAttachment,
	ScheduledMessageKind,
	ScheduledMessageStatus,
};

/** Сколько после сбоя оператор ещё видит неотправленное сообщение с причиной. */
const FAILED_VISIBLE_MS = 24 * 60 * 60 * 1000;

/** Ждущие/отправляемые, а также недавно упавшие — чтобы сбой не остался незамеченным. */
function visibleToOperator() {
	return or(
		inArray(scheduledMessages.status, ["pending", "sending"]),
		and(
			eq(scheduledMessages.status, "failed"),
			gte(
				scheduledMessages.updatedAt,
				new Date(Date.now() - FAILED_VISIBLE_MS),
			),
		),
	);
}

export interface NewScheduledMessage {
	memberId: string | null;
	kind: ScheduledMessageKind;
	messenger: string;
	userId?: string;
	entity?: string;
	entityId?: string;
	lineId?: string;
	connectorId?: string;
	text: string;
	attachment?: ScheduledMessageAttachment;
	operatorId?: string;
	operatorName?: string;
	sendAt: Date;
}

export async function insertScheduledMessage(
	entry: NewScheduledMessage,
): Promise<ScheduledMessage | null> {
	if (!db) return null;
	const [row] = await db
		.insert(scheduledMessages)
		.values({
			id: crypto.randomUUID(),
			memberId: entry.memberId,
			kind: entry.kind,
			messenger: entry.messenger,
			userId: entry.userId ?? null,
			entity: entry.entity ?? null,
			entityId: entry.entityId ?? null,
			lineId: entry.lineId ?? null,
			connectorId: entry.connectorId ?? null,
			text: entry.text,
			attachment: entry.attachment ?? null,
			operatorId: entry.operatorId ?? null,
			operatorName: entry.operatorName ?? null,
			sendAt: entry.sendAt,
		})
		.returning();
	return row ?? null;
}

/** Отложенные сообщения диалога из инбокса (ближайшие — первыми). */
export async function listScheduledMessagesForDialog(
	messenger: string,
	userIds: string[],
): Promise<ScheduledMessage[]> {
	if (!db || userIds.length === 0) return [];
	return db
		.select()
		.from(scheduledMessages)
		.where(
			and(
				eq(scheduledMessages.kind, "inbox"),
				eq(scheduledMessages.messenger, messenger),
				inArray(scheduledMessages.userId, userIds),
				visibleToOperator(),
			),
		)
		.orderBy(asc(scheduledMessages.sendAt));
}

/** Отложенные сообщения вкладки CRM для сделки/контакта. */
export async function listScheduledMessagesForEntity(
	entity: string,
	entityId: string,
): Promise<ScheduledMessage[]> {
	if (!db) return [];
	return db
		.select()
		.from(scheduledMessages)
		.where(
			and(
				eq(scheduledMessages.kind, "widget"),
				eq(scheduledMessages.entity, entity),
				eq(scheduledMessages.entityId, entityId),
				visibleToOperator(),
			),
		)
		.orderBy(asc(scheduledMessages.sendAt));
}

export async function getScheduledMessage(
	id: string,
): Promise<ScheduledMessage | null> {
	if (!db) return null;
	const [row] = await db
		.select()
		.from(scheduledMessages)
		.where(eq(scheduledMessages.id, id))
		.limit(1);
	return row ?? null;
}

/**
 * Отмена до отправки (а для упавшего сообщения — «убрать из списка»). Условие
 * по статусу делает её атомарной: если воркер уже взял сообщение (sending) или
 * отправил, отмена не пройдёт, и вызывающий получит false, а не «отменили то,
 * что уже ушло».
 */
export async function cancelScheduledMessage(id: string): Promise<boolean> {
	if (!db) return false;
	const rows = await db
		.update(scheduledMessages)
		.set({ status: "cancelled", updatedAt: new Date() })
		.where(
			and(
				eq(scheduledMessages.id, id),
				inArray(scheduledMessages.status, ["pending", "failed"]),
			),
		)
		.returning({ id: scheduledMessages.id });
	return rows.length > 0;
}

/**
 * Атомарно забирает до limit созревших сообщений (sendAt <= now), переводя их
 * в sending. FOR UPDATE SKIP LOCKED — параллельные запуски (или реплики
 * воркера) не возьмут одно и то же сообщение дважды.
 */
export async function claimDueScheduledMessages(
	now: Date,
	limit: number,
): Promise<ScheduledMessage[]> {
	if (!db) return [];
	const due = db
		.select({ id: scheduledMessages.id })
		.from(scheduledMessages)
		.where(
			and(
				eq(scheduledMessages.status, "pending"),
				lte(scheduledMessages.sendAt, now),
			),
		)
		.orderBy(asc(scheduledMessages.sendAt))
		.limit(limit)
		.for("update", { skipLocked: true });
	const rows = await db
		.update(scheduledMessages)
		.set({
			status: "sending",
			attempts: sql`${scheduledMessages.attempts} + 1`,
			updatedAt: now,
		})
		.where(inArray(scheduledMessages.id, due))
		.returning();
	return rows.sort((a, b) => a.sendAt.getTime() - b.sendAt.getTime());
}

export async function finishScheduledMessage(
	id: string,
	result: { status: "sent" | "failed"; error?: string },
): Promise<void> {
	if (!db) return;
	const now = new Date();
	await db
		.update(scheduledMessages)
		.set({
			status: result.status,
			error: result.error ?? null,
			sentAt: result.status === "sent" ? now : null,
			updatedAt: now,
		})
		.where(eq(scheduledMessages.id, id));
}

/**
 * Сообщения, зависшие в sending (воркер упал посреди отправки). Повторять их
 * нельзя — сообщение могло уйти клиенту, и он получил бы дубль, — поэтому
 * помечаем failed с пояснением, чтобы оператор проверил историю диалога.
 */
export async function failStaleSendingScheduledMessages(
	olderThan: Date,
	error: string,
): Promise<number> {
	if (!db) return 0;
	const rows = await db
		.update(scheduledMessages)
		.set({ status: "failed", error, updatedAt: new Date() })
		.where(
			and(
				eq(scheduledMessages.status, "sending"),
				lt(scheduledMessages.updatedAt, olderThan),
			),
		)
		.returning({ id: scheduledMessages.id });
	return rows.length;
}

/**
 * Давно просроченные pending (воркер долго не работал): отправлять их через
 * сутки уже неуместно — «напишу завтра в 10:00» к вечеру теряет смысл.
 */
export async function failOverdueScheduledMessages(
	dueBefore: Date,
	error: string,
): Promise<number> {
	if (!db) return 0;
	const rows = await db
		.update(scheduledMessages)
		.set({ status: "failed", error, updatedAt: new Date() })
		.where(
			and(
				eq(scheduledMessages.status, "pending"),
				lt(scheduledMessages.sendAt, dueBefore),
			),
		)
		.returning({ id: scheduledMessages.id });
	return rows.length;
}
