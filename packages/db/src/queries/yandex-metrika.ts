import { and, asc, count, eq, lt, sql } from "drizzle-orm";
import { db } from "../client";
import {
	yandexMetrikaDealVisitors,
	yandexMetrikaGoalEvents,
	yandexMetrikaSettings,
	yandexMetrikaStageGoals,
} from "../schema/yandex-metrika";

export type YandexMetrikaSettings = typeof yandexMetrikaSettings.$inferSelect;
export type YandexMetrikaStageGoal =
	typeof yandexMetrikaStageGoals.$inferSelect;

export async function getYandexMetrikaSettings(): Promise<YandexMetrikaSettings | null> {
	if (!db) return null;
	const rows = await db.select().from(yandexMetrikaSettings).limit(1);
	return rows[0] ?? null;
}

export async function upsertYandexMetrikaSettings(data: {
	counterId?: string | null;
	oauthToken?: string | null;
	goalId?: string | null;
	bitrixClientIdField?: string | null;
}): Promise<void> {
	if (!db) return;
	await db
		.insert(yandexMetrikaSettings)
		.values({ id: "singleton", ...data })
		.onConflictDoUpdate({ target: yandexMetrikaSettings.id, set: data });
}

export interface YandexMetrikaStageGoalWithStats
	extends YandexMetrikaStageGoal {
	/** Сколько конверсий по этой цели уже отправлено в Метрику. */
	sentCount: number;
}

/** Цели, привязанные к стадиям, с числом отправленных конверсий — для /settings/metrika. */
export async function listYandexMetrikaStageGoals(): Promise<
	YandexMetrikaStageGoalWithStats[]
> {
	if (!db) return [];
	const [goals, sent] = await Promise.all([
		db
			.select()
			.from(yandexMetrikaStageGoals)
			.orderBy(asc(yandexMetrikaStageGoals.createdAt)),
		db
			.select({
				stageGoalId: yandexMetrikaGoalEvents.stageGoalId,
				sent: count(),
			})
			.from(yandexMetrikaGoalEvents)
			.where(eq(yandexMetrikaGoalEvents.status, "sent"))
			.groupBy(yandexMetrikaGoalEvents.stageGoalId),
	]);
	const sentById = new Map(sent.map((row) => [row.stageGoalId, row.sent]));
	return goals.map((goal) => ({
		...goal,
		sentCount: sentById.get(goal.id) ?? 0,
	}));
}

/** Включённые цели, привязанные к стадии воронки — обработчик смены стадии сделки. */
export async function listEnabledYandexMetrikaGoalsForStage(
	stageId: string,
	categoryId: string,
): Promise<YandexMetrikaStageGoal[]> {
	if (!db) return [];
	return db
		.select()
		.from(yandexMetrikaStageGoals)
		.where(
			and(
				eq(yandexMetrikaStageGoals.stageId, stageId),
				eq(yandexMetrikaStageGoals.categoryId, categoryId),
				eq(yandexMetrikaStageGoals.enabled, true),
			),
		);
}

/** Проверяет наличие включённых целей; без подключения к БД возвращает false. */
export async function hasEnabledYandexMetrikaStageGoals(): Promise<boolean> {
	if (!db) return false;
	const rows = await db
		.select({ id: yandexMetrikaStageGoals.id })
		.from(yandexMetrikaStageGoals)
		.where(eq(yandexMetrikaStageGoals.enabled, true))
		.limit(1);
	return rows.length > 0;
}

export interface YandexMetrikaStageGoalInput {
	name: string;
	goalId: string;
	categoryId: string;
	stageId: string;
	enabled: boolean;
}

/** Создаёт привязку цели к стадии с заданным ID; без подключения к БД ничего не делает. */
export async function createYandexMetrikaStageGoal(
	id: string,
	data: YandexMetrikaStageGoalInput,
): Promise<void> {
	if (!db) return;
	await db.insert(yandexMetrikaStageGoals).values({ id, ...data });
}

/** Обновляет привязку и время изменения по ID; без подключения к БД ничего не делает. */
export async function updateYandexMetrikaStageGoal(
	id: string,
	data: YandexMetrikaStageGoalInput,
): Promise<void> {
	if (!db) return;
	await db
		.update(yandexMetrikaStageGoals)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(yandexMetrikaStageGoals.id, id));
}

/**
 * Удаляет привязку по ID вместе с её журналом конверсий (каскадное удаление).
 * Без подключения к БД ничего не делает.
 */
export async function deleteYandexMetrikaStageGoal(id: string): Promise<void> {
	if (!db) return;
	await db
		.delete(yandexMetrikaStageGoals)
		.where(eq(yandexMetrikaStageGoals.id, id));
}

export interface YandexMetrikaDealVisitor {
	clientId: string | null;
	yclid: string | null;
}

/** Запоминает ClientID/yclid визита, с которым бот создал сделку. */
export async function saveYandexMetrikaDealVisitor(
	dealId: string,
	visitor: { clientId?: string; yclid?: string },
): Promise<void> {
	if (!db) return;
	const values = {
		clientId: visitor.clientId || null,
		yclid: visitor.yclid || null,
	};
	await db
		.insert(yandexMetrikaDealVisitors)
		.values({ dealId, ...values })
		.onConflictDoUpdate({
			target: yandexMetrikaDealVisitors.dealId,
			set: values,
		});
}

/** Возвращает ClientID/yclid сделки или null, если записи либо подключения к БД нет. */
export async function getYandexMetrikaDealVisitor(
	dealId: string,
): Promise<YandexMetrikaDealVisitor | null> {
	if (!db) return null;
	const rows = await db
		.select({
			clientId: yandexMetrikaDealVisitors.clientId,
			yclid: yandexMetrikaDealVisitors.yclid,
		})
		.from(yandexMetrikaDealVisitors)
		.where(eq(yandexMetrikaDealVisitors.dealId, dealId))
		.limit(1);
	return rows[0] ?? null;
}

/** Срок резерва отправки; после сбоя воркера следующий вебхук может повторить её. */
export const YANDEX_METRIKA_GOAL_CLAIM_TTL_MS = 5 * 60 * 1000;

/** Возвращает токен резерва или null, если уже отправлено/занято другим воркером. */
export async function claimYandexMetrikaGoalEvent(
	stageGoalId: string,
	dealId: string,
): Promise<string | null> {
	if (!db) return null;
	const claimToken = crypto.randomUUID();
	const rows = await db
		.insert(yandexMetrikaGoalEvents)
		.values({ stageGoalId, dealId, status: "pending", claimToken })
		.onConflictDoUpdate({
			target: [
				yandexMetrikaGoalEvents.stageGoalId,
				yandexMetrikaGoalEvents.dealId,
			],
			set: { claimToken, claimedAt: sql`now()` },
			setWhere: and(
				eq(yandexMetrikaGoalEvents.status, "pending"),
				lt(
					yandexMetrikaGoalEvents.claimedAt,
					sql`now() - ${YANDEX_METRIKA_GOAL_CLAIM_TTL_MS} * interval '1 millisecond'`,
				),
			),
		})
		.returning({ claimToken: yandexMetrikaGoalEvents.claimToken });
	return rows[0]?.claimToken ?? null;
}

function pendingClaim(stageGoalId: string, dealId: string, claimToken: string) {
	return and(
		eq(yandexMetrikaGoalEvents.stageGoalId, stageGoalId),
		eq(yandexMetrikaGoalEvents.dealId, dealId),
		eq(yandexMetrikaGoalEvents.status, "pending"),
		eq(yandexMetrikaGoalEvents.claimToken, claimToken),
	);
}

/** Фиксирует успешную отправку только для текущего владельца резерва. */
export async function markYandexMetrikaGoalEventSent(
	stageGoalId: string,
	dealId: string,
	claimToken: string,
): Promise<void> {
	if (!db) return;
	await db
		.update(yandexMetrikaGoalEvents)
		.set({ status: "sent", sentAt: sql`now()` })
		.where(pendingClaim(stageGoalId, dealId, claimToken));
}

/** Снимает текущий резерв после неудачной отправки, не затрагивая sent. */
export async function releaseYandexMetrikaGoalEvent(
	stageGoalId: string,
	dealId: string,
	claimToken: string,
): Promise<void> {
	if (!db) return;
	await db
		.delete(yandexMetrikaGoalEvents)
		.where(pendingClaim(stageGoalId, dealId, claimToken));
}
