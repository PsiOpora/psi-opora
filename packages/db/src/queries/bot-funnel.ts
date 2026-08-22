import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { botFunnelEvents, botFunnelUserSteps } from "../schema/bot-funnel";
import { botUsers } from "../schema/bot-users";

export type BotFunnelEvent = typeof botFunnelEvents.$inferSelect;
export type NewBotFunnelEvent = typeof botFunnelEvents.$inferInsert;

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
): string {
	return `${day}:${messenger}:${userId}:${step}`;
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

	const userStepId = makeUserStepId(
		data.day,
		data.messenger,
		String(data.userId),
		data.step,
	);
	await db
		.insert(botFunnelUserSteps)
		.values({
			id: userStepId,
			day: data.day,
			messenger: data.messenger,
			userId: String(data.userId),
			step: data.step,
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
	source: string;
	campaign: string;
	/** Число уникальных пользователей мессенджера, дошедших до шага хотя бы
	 * раз за весь диапазон дат (COUNT DISTINCT user_id) — повторные /start
	 * одного и того же человека считаются один раз. */
	uniqueUsers: number;
}

/** Уникальные (по user_id) счётчики шагов воронки за диапазон дат — то, что
 * должно показываться в отчёте вместо "сырых" bot_funnel_events, которые
 * инкрементируются на каждое событие без дедупликации по пользователю. */
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
			source: botFunnelUserSteps.source,
			campaign: botFunnelUserSteps.campaign,
			uniqueUsers: sql<number>`count(distinct ${botFunnelUserSteps.userId})`,
		})
		.from(botFunnelUserSteps)
		.where(
			sql`${botFunnelUserSteps.day} >= ${fromDate} AND ${botFunnelUserSteps.day} <= ${toDate}`,
		)
		.groupBy(
			botFunnelUserSteps.messenger,
			botFunnelUserSteps.step,
			botFunnelUserSteps.source,
			botFunnelUserSteps.campaign,
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
	/** Первый и последний день в диапазоне, когда пользователь дошёл до шага. */
	firstDay: string;
	lastDay: string;
}

/**
 * Список уникальных клиентов, дошедших до конкретного шага воронки за
 * диапазон дат — данные для drill-down при клике на число в отчёте.
 * source/campaign берутся с первого дня, когда пользователь дошёл до шага
 * (в диапазоне могут отличаться по дням, если менялась атрибуция).
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
	},
): Promise<BotFunnelStepClient[]> {
	if (!db) return [];

	const conditions = [
		eq(botFunnelUserSteps.step, params.step),
		sql`${botFunnelUserSteps.day} >= ${params.fromDate} AND ${botFunnelUserSteps.day} <= ${params.toDate}`,
	];
	if (params.messenger)
		conditions.push(eq(botFunnelUserSteps.messenger, params.messenger));
	if (params.source)
		conditions.push(eq(botFunnelUserSteps.source, params.source));
	if (params.campaign)
		conditions.push(eq(botFunnelUserSteps.campaign, params.campaign));

	const rows = await db
		.select({
			messenger: botFunnelUserSteps.messenger,
			userId: botFunnelUserSteps.userId,
			day: botFunnelUserSteps.day,
			source: botFunnelUserSteps.source,
			campaign: botFunnelUserSteps.campaign,
		})
		.from(botFunnelUserSteps)
		.where(and(...conditions))
		.orderBy(botFunnelUserSteps.day);

	const byUser = new Map<
		string,
		{
			messenger: string;
			userId: string;
			source: string;
			campaign: string;
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
				firstDay: g.firstDay,
				lastDay: g.lastDay,
			};
		})
		.sort((a, b) => b.firstDay.localeCompare(a.firstDay));
}
