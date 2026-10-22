import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../client";
import {
	type OutreachMessengerChannel,
	outreachCampaigns,
	outreachRecipients,
} from "../schema/outreach";

export type {
	OutreachChannelPacing,
	OutreachMessengerChannel,
	OutreachSendWindow,
	OutreachSettings,
} from "../schema/outreach";

/** Сколько отправок сделал личный номер с момента since — для дневного лимита и паузы. */
export interface OutreachAccountUsage {
	channel: OutreachMessengerChannel;
	connectorId: string;
	attempts: number;
	lastAt: Date | null;
}

/**
 * Попытки отправки с личных номеров по всем рассылкам начиная с since:
 * лимит «сообщений в сутки» относится к номеру, а не к одной рассылке.
 * Попытка без результата (номера нет в мессенджере) тоже считается — для
 * Telegram/MAX поиск по номеру сам по себе сигнал для антиспама.
 */
export async function getOutreachAccountUsage(
	since: Date,
): Promise<OutreachAccountUsage[]> {
	if (!db) return [];
	const sinceIso = since.toISOString();
	const attempt = sql`a.value`;
	const channel = sql<string>`${attempt}->>'channel'`;
	const connectorId = sql<
		string | null
	>`${outreachCampaigns.accounts} -> (${attempt}->>'channel') ->> 'connectorId'`;
	const at = sql`(${attempt}->>'at')::timestamptz`;
	const rows = await db
		.select({
			channel,
			connectorId,
			attempts: sql<number>`count(*)::int`,
			lastAt: sql<string | null>`max(${at})`,
		})
		.from(outreachRecipients)
		.innerJoin(
			outreachCampaigns,
			eq(outreachCampaigns.id, outreachRecipients.campaignId),
		)
		.innerJoin(
			sql`jsonb_array_elements(${outreachRecipients.attempts}) as a`,
			sql`true`,
		)
		.where(
			and(
				// Завершённые до since рассылки попыток после since не содержат.
				or(
					isNull(outreachCampaigns.finishedAt),
					gte(outreachCampaigns.finishedAt, since),
				),
				sql`${channel} <> 'email'`,
				sql`coalesce((${attempt}->>'skipped')::boolean, false) = false`,
				sql`${at} >= ${sinceIso}::timestamptz`,
			),
		)
		.groupBy(channel, connectorId);
	return rows.flatMap((row) =>
		row.connectorId &&
		(row.channel === "max" ||
			row.channel === "telegram" ||
			row.channel === "whatsapp")
			? [
					{
						channel: row.channel,
						connectorId: row.connectorId,
						attempts: Number(row.attempts),
						lastAt: row.lastAt ? new Date(row.lastAt) : null,
					},
				]
			: [],
	);
}

/**
 * Телефоны и адреса, до которых рассылка по списку уже дошла начиная с
 * since: «отправлено в мессенджер», «не подтверждено» (могло уйти) и
 * «передано в email». Нужны, чтобы не писать одним и тем же людям слишком часто.
 */
export async function findRecentlyContactedOutreach(params: {
	phones: string[];
	emails: string[];
	since: Date;
}): Promise<{ phones: Set<string>; emails: Set<string> }> {
	const result = { phones: new Set<string>(), emails: new Set<string>() };
	if (!db) return result;
	const r = outreachRecipients;
	const reached = or(
		and(inArray(r.status, ["sent", "email"]), gte(r.sentAt, params.since)),
		and(eq(r.status, "unknown"), gte(r.updatedAt, params.since)),
	);
	const CHUNK = 1000;
	for (let i = 0; i < params.phones.length; i += CHUNK) {
		const rows = await db
			.selectDistinct({ phone: r.phone })
			.from(r)
			.where(
				and(
					inArray(r.status, ["sent", "unknown"]),
					inArray(r.phone, params.phones.slice(i, i + CHUNK)),
					reached,
				),
			);
		for (const row of rows) if (row.phone) result.phones.add(row.phone);
	}
	for (let i = 0; i < params.emails.length; i += CHUNK) {
		const rows = await db
			.selectDistinct({ email: r.email })
			.from(r)
			.where(
				and(
					eq(r.status, "email"),
					inArray(r.email, params.emails.slice(i, i + CHUNK)),
					reached,
				),
			);
		for (const row of rows) if (row.email) result.emails.add(row.email);
	}
	return result;
}

/** Рассылка ждёт (окно отправки, лимит, перерыв) — показываем в отчёте до какого времени и почему. */
export async function setOutreachCampaignPause(
	id: string,
	pause: { resumeAt: Date; reason: string } | null,
): Promise<void> {
	if (!db) return;
	await db
		.update(outreachCampaigns)
		.set({
			resumeAt: pause?.resumeAt ?? null,
			pauseReason: pause?.reason ?? null,
		})
		.where(eq(outreachCampaigns.id, id));
}
