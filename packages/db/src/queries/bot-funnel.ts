import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { botFunnelEvents, botFunnelUserSteps } from "../schema/bot-funnel";
import { botUsers } from "../schema/bot-users";

export type BotFunnelEvent = typeof botFunnelEvents.$inferSelect;
export type NewBotFunnelEvent = typeof botFunnelEvents.$inferInsert;

/** "-" — обычный успешный шаг, не причина отвала (см. botFunnelUserSteps). */
const NO_REASON = "-";

function makeId(
	day: string,
	messenger: string,
	step: string,
	source: string,
	campaign: string,
): string {
	return `${day}:${messenger}:${step}:${source}:${campaign}`;
}

function makeUserStepId(
	day: string,
	messenger: string,
	userId: string,
	step: string,
	reason: string,
): string {
	return `${day}:${messenger}:${userId}:${step}:${reason}`;
}

export async function upsertBotFunnelEvent(
	db: Database,
	data: {
		day: string;
		messenger: string;
		step: string;
		source?: string;
		campaign?: string;
		/** ID пользователя мессенджера — если задан, шаг также фиксируется в
		 * bot_funnel_user_steps для подсчёта уникальных пользователей. */
		userId?: string | number;
		/** Ветка сценария ("consult" | "guide") — "-" до выбора ветки (шаг start). */
		flow?: string;
		/** "-" (по умолчанию) — обычное прохождение шага. Другое значение —
		 * это не прогресс, а причина, по которой пользователь застрял/ушёл
		 * именно на этом шаге ("declined", "timeout", "blocked" и т.п.). */
		reason?: string;
	},
): Promise<void> {
	if (!db) return;

	const source = data.source || "-";
	const campaign = data.campaign || "-";
	const id = makeId(data.day, data.messenger, data.step, source, campaign);

	await db
		.insert(botFunnelEvents)
		.values({
			id,
			day: data.day,
			messenger: data.messenger,
			step: data.step,
			source,
			campaign,
			count: 1,
		})
		.onConflictDoUpdate({
			target: botFunnelEvents.id,
			set: {
				count: sql`${botFunnelEvents.count} + 1`,
				updatedAt: sql`now()`,
			},
		});

	if (data.userId === undefined) return;

	const flow = data.flow || "-";
	const reason = data.reason || NO_REASON;
	const userStepId = makeUserStepId(
		data.day,
		data.messenger,
		String(data.userId),
		data.step,
		reason,
	);
	await db
		.insert(botFunnelUserSteps)
		.values({
			id: userStepId,
			day: data.day,
			messenger: data.messenger,
			userId: String(data.userId),
			step: data.step,
			flow,
			reason,
			source,
			campaign,
		})
		.onConflictDoNothing({ target: botFunnelUserSteps.id });
}

export async function getBotFunnelEventsByDateRange(
	db: Database,
	fromDate: string,
	toDate: string,
): Promise<BotFunnelEvent[]> {
	if (!db) return [];
	return db
		.select()
		.from(botFunnelEvents)
		.where(
			sql`${botFunnelEvents.day} >= ${fromDate} AND ${botFunnelEvents.day} <= ${toDate}`,
		)
		.orderBy(
			botFunnelEvents.day,
			botFunnelEvents.messenger,
			botFunnelEvents.step,
		);
}

export interface BotFunnelUniqueStepCount {
	messenger: string;
	step: string;
	flow: string;
	source: string;
	campaign: string;
	/** Число уникальных пользователей мессенджера, дошедших до шага хотя бы
	 * раз за весь диапазон дат (COUNT DISTINCT user_id) — повторные /start
	 * одного и того же человека считаются один раз. */
	uniqueUsers: number;
}

/** Уникальные (по user_id) счётчики шагов воронки за диапазон дат — то, что
 * должно показываться в отчёте вместо "сырых" bot_funnel_events, которые
 * инкрементируются на каждое событие без дедупликации по пользователю.
 * Считает только обычный прогресс (reason = "-"), без событий-причин
 * отвала — см. getBotFunnelDropReasonsByDateRange. */
export async function getBotFunnelUniqueStepCountsByDateRange(
	db: Database,
	fromDate: string,
	toDate: string,
): Promise<BotFunnelUniqueStepCount[]> {
	if (!db) return [];

	const rows = await db
		.select({
			messenger: botFunnelUserSteps.messenger,
			step: botFunnelUserSteps.step,
			flow: botFunnelUserSteps.flow,
			source: botFunnelUserSteps.source,
			campaign: botFunnelUserSteps.campaign,
			uniqueUsers: sql<number>`count(distinct ${botFunnelUserSteps.userId})`,
		})
		.from(botFunnelUserSteps)
		.where(
			and(
				eq(botFunnelUserSteps.reason, NO_REASON),
				sql`${botFunnelUserSteps.day} >= ${fromDate} AND ${botFunnelUserSteps.day} <= ${toDate}`,
			),
		)
		.groupBy(
			botFunnelUserSteps.messenger,
			botFunnelUserSteps.step,
			botFunnelUserSteps.flow,
			botFunnelUserSteps.source,
			botFunnelUserSteps.campaign,
		);

	return rows.map((row) => ({ ...row, uniqueUsers: Number(row.uniqueUsers) }));
}

export interface BotFunnelDropReasonCount {
	messenger: string;
	step: string;
	flow: string;
	reason: string;
	/** Уникальные пользователи, у которых на этом шаге зафиксирована эта
	 * причина остановки, за диапазон дат. */
	uniqueUsers: number;
}

/** Причины, по которым пользователи не пошли дальше конкретного шага —
 * declined/timeout/blocked и т.п. (reason <> "-"), см. botFunnelUserSteps. */
export async function getBotFunnelDropReasonsByDateRange(
	db: Database,
	fromDate: string,
	toDate: string,
): Promise<BotFunnelDropReasonCount[]> {
	if (!db) return [];

	const rows = await db
		.select({
			messenger: botFunnelUserSteps.messenger,
			step: botFunnelUserSteps.step,
			flow: botFunnelUserSteps.flow,
			reason: botFunnelUserSteps.reason,
			uniqueUsers: sql<number>`count(distinct ${botFunnelUserSteps.userId})`,
		})
		.from(botFunnelUserSteps)
		.where(
			and(
				sql`${botFunnelUserSteps.reason} <> ${NO_REASON}`,
				sql`${botFunnelUserSteps.day} >= ${fromDate} AND ${botFunnelUserSteps.day} <= ${toDate}`,
			),
		)
		.groupBy(
			botFunnelUserSteps.messenger,
			botFunnelUserSteps.step,
			botFunnelUserSteps.flow,
			botFunnelUserSteps.reason,
		);

	return rows.map((row) => ({ ...row, uniqueUsers: Number(row.uniqueUsers) }));
}

export interface BotFunnelStepClient {
	messenger: string;
	userId: string;
	name: string | null;
	firstName: string | null;
	lastName: string | null;
	username: string | null;
	source: string;
	campaign: string;
	flow: string;
	reason: string;
	/** Первый и последний день в диапазоне, когда пользователь дошёл до шага
	 * (при фильтре по reason — когда была зафиксирована эта причина). */
	firstDay: string;
	lastDay: string;
}

/**
 * Список уникальных клиентов, дошедших до конкретного шага воронки (или
 * остановившихся на нём по конкретной причине) за диапазон дат — данные для
 * drill-down при клике на число в отчёте. source/campaign/flow берутся с
 * первого дня в диапазоне (в диапазоне могут отличаться по дням, если
 * менялась атрибуция).
 */
export async function getBotFunnelStepClients(
	db: Database,
	params: {
		step: string;
		fromDate: string;
		toDate: string;
		messenger?: string;
		source?: string;
		campaign?: string;
		flow?: string;
		/** Если не задан — обычные (успешные) прохождения шага (reason = "-").
		 * Если задан — конкретная причина отвала на этом шаге. */
		reason?: string;
		limit?: number;
	},
): Promise<BotFunnelStepClient[]> {
	if (!db) return [];

	const limit = params.limit ?? 1000;

	const conditions = [
		eq(botFunnelUserSteps.step, params.step),
		eq(botFunnelUserSteps.reason, params.reason || NO_REASON),
		sql`${botFunnelUserSteps.day} >= ${params.fromDate} AND ${botFunnelUserSteps.day} <= ${params.toDate}`,
	];
	if (params.messenger)
		conditions.push(eq(botFunnelUserSteps.messenger, params.messenger));
	if (params.source)
		conditions.push(eq(botFunnelUserSteps.source, params.source));
	if (params.campaign)
		conditions.push(eq(botFunnelUserSteps.campaign, params.campaign));
	if (params.flow) conditions.push(eq(botFunnelUserSteps.flow, params.flow));

	const rows = await db
		.select({
			messenger: botFunnelUserSteps.messenger,
			userId: botFunnelUserSteps.userId,
			day: botFunnelUserSteps.day,
			source: botFunnelUserSteps.source,
			campaign: botFunnelUserSteps.campaign,
			flow: botFunnelUserSteps.flow,
			reason: botFunnelUserSteps.reason,
		})
		.from(botFunnelUserSteps)
		.where(and(...conditions))
		.orderBy(botFunnelUserSteps.day)
		.limit(limit);

	const byUser = new Map<
		string,
		{
			messenger: string;
			userId: string;
			source: string;
			campaign: string;
			flow: string;
			reason: string;
			firstDay: string;
			lastDay: string;
		}
	>();
	for (const row of rows) {
		const key = `${row.messenger}:${row.userId}`;
		const existing = byUser.get(key);
		if (!existing) {
			byUser.set(key, {
				messenger: row.messenger,
				userId: row.userId,
				source: row.source,
				campaign: row.campaign,
				flow: row.flow,
				reason: row.reason,
				firstDay: row.day,
				lastDay: row.day,
			});
		} else {
			existing.lastDay = row.day;
		}
	}

	const grouped = [...byUser.values()];
	if (grouped.length === 0) return [];

	const profiles = await db
		.select()
		.from(botUsers)
		.where(
			inArray(
				botUsers.id,
				grouped.map((g) => `${g.messenger}:${g.userId}`),
			),
		);
	const profileById = new Map(profiles.map((p) => [p.id, p]));

	return grouped
		.map((g) => {
			const profile = profileById.get(`${g.messenger}:${g.userId}`);
			return {
				messenger: g.messenger,
				userId: g.userId,
				name: profile?.name ?? null,
				firstName: profile?.firstName ?? null,
				lastName: profile?.lastName ?? null,
				username: profile?.username ?? null,
				source: g.source,
				campaign: g.campaign,
				flow: g.flow,
				reason: g.reason,
				firstDay: g.firstDay,
				lastDay: g.lastDay,
			};
		})
		.sort((a, b) => b.firstDay.localeCompare(a.firstDay));
}
