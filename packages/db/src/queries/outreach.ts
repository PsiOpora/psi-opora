import {
	and,
	asc,
	count,
	desc,
	eq,
	ilike,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "../client";
import { bookPreorderOrders } from "../schema/book-preorder-orders";
import { botGuideDeliveries } from "../schema/bot-guide-deliveries";
import { emailCampaignRecipients } from "../schema/email-campaign";
import {
	type OutreachAttempt,
	type OutreachChannel,
	outreachCampaigns,
	outreachRecipients,
} from "../schema/outreach";

export type OutreachCampaign = typeof outreachCampaigns.$inferSelect;
export type NewOutreachCampaign = typeof outreachCampaigns.$inferInsert;
export type OutreachRecipient = typeof outreachRecipients.$inferSelect;
export type NewOutreachRecipient = typeof outreachRecipients.$inferInsert;
export type {
	OutreachAccountRef,
	OutreachAccounts,
	OutreachAttempt,
	OutreachChannel,
} from "../schema/outreach";

/**
 * Статусы получателя:
 * - pending — ждёт отправки;
 * - sending — идёт попытка (если задачу прервали, становится unknown);
 * - sent — ушло в мессенджер (channel);
 * - email_pending — мессенджеры не сработали, ждёт email-фазы;
 * - email — передано в email-кампанию (статус письма — в emailRecipientId);
 * - failed — не удалось ни одним каналом;
 * - skipped — не отправлялось (рассылку отменили);
 * - unknown — воркер личного номера мог отправить, но не подтвердил.
 */
export type OutreachRecipientStatus =
	| "pending"
	| "sending"
	| "sent"
	| "email_pending"
	| "email"
	| "failed"
	| "skipped"
	| "unknown";

export type OutreachCampaignStatus =
	| "queued"
	| "running"
	| "done"
	| "error"
	| "cancelled";

export async function createOutreachCampaign(
	data: Omit<NewOutreachCampaign, "status" | "createdAt">,
): Promise<void> {
	if (!db) return;
	await db.insert(outreachCampaigns).values({ ...data, status: "queued" });
}

export async function insertOutreachRecipients(
	rows: NewOutreachRecipient[],
): Promise<void> {
	if (!db || rows.length === 0) return;
	// Пачками — у Postgres лимит на число параметров в одном запросе.
	for (let i = 0; i < rows.length; i += 1000) {
		await db.insert(outreachRecipients).values(rows.slice(i, i + 1000));
	}
}

export async function getOutreachCampaign(
	id: string,
): Promise<OutreachCampaign | null> {
	if (!db) return null;
	const [row] = await db
		.select()
		.from(outreachCampaigns)
		.where(eq(outreachCampaigns.id, id))
		.limit(1);
	return row ?? null;
}

export async function markOutreachCampaignRunning(id: string): Promise<void> {
	if (!db) return;
	await db
		.update(outreachCampaigns)
		.set({
			status: "running",
			startedAt: sql`coalesce(${outreachCampaigns.startedAt}, now())`,
			resumeAt: null,
			pauseReason: null,
		})
		.where(
			and(
				eq(outreachCampaigns.id, id),
				inArray(outreachCampaigns.status, ["queued", "running"]),
			),
		);
}

export async function finishOutreachCampaign(
	id: string,
	data: { status: "done" | "error"; error?: string | null },
): Promise<void> {
	if (!db) return;
	await db
		.update(outreachCampaigns)
		.set({ ...data, finishedAt: new Date(), resumeAt: null, pauseReason: null })
		// Отменённую рассылку задача не «завершает» обратно в done.
		.where(
			and(
				eq(outreachCampaigns.id, id),
				inArray(outreachCampaigns.status, ["queued", "running"]),
			),
		);
}

export async function setOutreachEmailCampaign(
	id: string,
	emailCampaignId: string,
): Promise<void> {
	if (!db) return;
	await db
		.update(outreachCampaigns)
		.set({ emailCampaignId })
		.where(eq(outreachCampaigns.id, id));
}

/**
 * Отмена: ещё не обработанные получатели помечаются skipped, задача увидит
 * статус cancelled перед следующей отправкой и остановится. Тем, кому
 * мессенджеры уже не дошли (email_pending), задача всё равно отправит письмо —
 * каскад для них уже решил, что канал — email. Возвращает false, если
 * рассылка уже завершена.
 */
export async function cancelOutreachCampaign(id: string): Promise<boolean> {
	if (!db) return false;
	const rows = await db
		.update(outreachCampaigns)
		.set({
			status: "cancelled",
			finishedAt: new Date(),
			resumeAt: null,
			pauseReason: null,
		})
		.where(
			and(
				eq(outreachCampaigns.id, id),
				inArray(outreachCampaigns.status, ["queued", "running"]),
			),
		)
		.returning({ id: outreachCampaigns.id });
	if (rows.length === 0) return false;
	await db
		.update(outreachRecipients)
		.set({
			status: "skipped",
			error: "Рассылка отменена",
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(outreachRecipients.campaignId, id),
				eq(outreachRecipients.status, "pending"),
			),
		);
	return true;
}

/**
 * Откат передачи в email, если задачу отправки писем не удалось поставить:
 * получатели снова ждут email-фазы (а не числятся «передано в email»), а
 * причина видна в отчёте.
 */
export async function revertOutreachEmailHandoff(
	campaignId: string,
	emailCampaignId: string,
	error: string,
): Promise<void> {
	if (!db) return;
	await db
		.update(outreachRecipients)
		.set({
			status: "email_pending",
			channel: null,
			emailRecipientId: null,
			sentAt: null,
			error,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(outreachRecipients.campaignId, campaignId),
				eq(outreachRecipients.status, "email"),
				inArray(
					outreachRecipients.emailRecipientId,
					db
						.select({ id: emailCampaignRecipients.id })
						.from(emailCampaignRecipients)
						.where(eq(emailCampaignRecipients.campaignId, emailCampaignId)),
				),
			),
		);
}

/** Идёт ли по списку незавершённая рассылка — такой список удалять нельзя. */
export async function hasActiveOutreachForList(
	listId: string,
): Promise<boolean> {
	if (!db) return false;
	const rows = await db
		.select({ id: outreachCampaigns.id })
		.from(outreachCampaigns)
		.where(
			and(
				eq(outreachCampaigns.listId, listId),
				inArray(outreachCampaigns.status, ["queued", "running"]),
			),
		)
		.limit(1);
	return rows.length > 0;
}

export async function listOutreachRecipientsByStatus(
	campaignId: string,
	status: OutreachRecipientStatus,
	limit = 1000,
): Promise<OutreachRecipient[]> {
	if (!db) return [];
	return db
		.select()
		.from(outreachRecipients)
		.where(
			and(
				eq(outreachRecipients.campaignId, campaignId),
				eq(outreachRecipients.status, status),
			),
		)
		.orderBy(asc(outreachRecipients.id))
		.limit(limit);
}

export async function updateOutreachRecipient(
	id: string,
	data: {
		status: OutreachRecipientStatus;
		channel?: OutreachChannel | null;
		attempts?: OutreachAttempt[];
		externalId?: string | null;
		emailRecipientId?: string | null;
		error?: string | null;
		sentAt?: Date | null;
	},
): Promise<void> {
	if (!db) return;
	await db
		.update(outreachRecipients)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(outreachRecipients.id, id));
}

/**
 * Получатели, на которых прервалась прошлая задача (рестарт воркера, таймаут):
 * доставка не подтверждена, но и не исключена — повторно не шлём, чтобы не
 * задублить, а честно показываем «статус неизвестен».
 */
export async function markInterruptedOutreachRecipients(
	campaignId: string,
): Promise<number> {
	if (!db) return 0;
	const rows = await db
		.update(outreachRecipients)
		.set({
			status: "unknown",
			error: "Отправка прервана — доставка не подтверждена",
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(outreachRecipients.campaignId, campaignId),
				eq(outreachRecipients.status, "sending"),
			),
		)
		.returning({ id: outreachRecipients.id });
	return rows.length;
}

export interface OutreachStats {
	total: number;
	pending: number;
	/** Через официальных ботов MAX/Telegram (номер уже писал боту). */
	sentBots: number;
	sentMax: number;
	sentTelegram: number;
	sentWhatsapp: number;
	/** Переданы в email-кампанию. */
	email: number;
	failed: number;
	skipped: number;
	unknown: number;
}

const EMPTY_STATS: OutreachStats = {
	total: 0,
	pending: 0,
	sentBots: 0,
	sentMax: 0,
	sentTelegram: 0,
	sentWhatsapp: 0,
	email: 0,
	failed: 0,
	skipped: 0,
	unknown: 0,
};

function toStats(
	rows: Array<{ status: string; channel: string | null; total: number }>,
): OutreachStats {
	const stats = { ...EMPTY_STATS };
	for (const row of rows) {
		const n = Number(row.total);
		stats.total += n;
		switch (row.status) {
			case "pending":
			case "sending":
			case "email_pending":
				stats.pending += n;
				break;
			case "sent":
				if (row.channel === "max_bot" || row.channel === "telegram_bot")
					stats.sentBots += n;
				else if (row.channel === "max") stats.sentMax += n;
				else if (row.channel === "telegram") stats.sentTelegram += n;
				else if (row.channel === "whatsapp") stats.sentWhatsapp += n;
				break;
			case "email":
				stats.email += n;
				break;
			case "failed":
				stats.failed += n;
				break;
			case "skipped":
				stats.skipped += n;
				break;
			case "unknown":
				stats.unknown += n;
				break;
		}
	}
	return stats;
}

export async function getOutreachStats(
	campaignId: string,
): Promise<OutreachStats> {
	if (!db) return { ...EMPTY_STATS };
	const rows = await db
		.select({
			status: outreachRecipients.status,
			channel: outreachRecipients.channel,
			total: count(),
		})
		.from(outreachRecipients)
		.where(eq(outreachRecipients.campaignId, campaignId))
		.groupBy(outreachRecipients.status, outreachRecipients.channel);
	return toStats(rows);
}

export interface OutreachCampaignWithStats extends OutreachCampaign {
	stats: OutreachStats;
}

export async function listOutreachCampaigns(
	limit = 30,
): Promise<OutreachCampaignWithStats[]> {
	if (!db) return [];
	const campaigns = await db
		.select()
		.from(outreachCampaigns)
		.orderBy(desc(outreachCampaigns.createdAt))
		.limit(limit);
	if (campaigns.length === 0) return [];
	const rows = await db
		.select({
			campaignId: outreachRecipients.campaignId,
			status: outreachRecipients.status,
			channel: outreachRecipients.channel,
			total: count(),
		})
		.from(outreachRecipients)
		.where(
			inArray(
				outreachRecipients.campaignId,
				campaigns.map((c) => c.id),
			),
		)
		.groupBy(
			outreachRecipients.campaignId,
			outreachRecipients.status,
			outreachRecipients.channel,
		);
	return campaigns.map((campaign) => ({
		...campaign,
		stats: toStats(rows.filter((r) => r.campaignId === campaign.id)),
	}));
}

export const OUTREACH_RECIPIENT_FILTERS = [
	"all",
	"bots",
	"max",
	"telegram",
	"whatsapp",
	"email",
	"failed",
	"unknown",
	"pending",
	"skipped",
] as const;
export type OutreachRecipientFilter =
	(typeof OUTREACH_RECIPIENT_FILTERS)[number];

function filterCondition(filter: OutreachRecipientFilter): SQL | undefined {
	const r = outreachRecipients;
	switch (filter) {
		case "all":
			return undefined;
		case "bots":
			return and(
				eq(r.status, "sent"),
				inArray(r.channel, ["max_bot", "telegram_bot"]),
			);
		case "max":
		case "telegram":
		case "whatsapp":
			return and(eq(r.status, "sent"), eq(r.channel, filter));
		case "email":
			return eq(r.status, "email");
		case "pending":
			return inArray(r.status, ["pending", "sending", "email_pending"]);
		case "failed":
		case "unknown":
		case "skipped":
			return eq(r.status, filter);
	}
}

export interface OutreachRecipientRow extends OutreachRecipient {
	/** Статус письма в связанной email-кампании (sent/delivered/opened/bounced…). */
	emailStatus: string | null;
	emailError: string | null;
}

function recipientsQuery(where: SQL | undefined) {
	if (!db) throw new Error("База данных недоступна");
	return db
		.select({
			recipient: outreachRecipients,
			emailStatus: emailCampaignRecipients.status,
			emailError: emailCampaignRecipients.error,
		})
		.from(outreachRecipients)
		.leftJoin(
			emailCampaignRecipients,
			eq(emailCampaignRecipients.id, outreachRecipients.emailRecipientId),
		)
		.where(where);
}

function toRecipientRow(row: {
	recipient: OutreachRecipient;
	emailStatus: string | null;
	emailError: string | null;
}): OutreachRecipientRow {
	return {
		...row.recipient,
		emailStatus: row.emailStatus ?? null,
		emailError: row.emailError ?? null,
	};
}

export async function listOutreachRecipientsPage(params: {
	campaignId: string;
	filter: OutreachRecipientFilter;
	search?: string;
	limit: number;
	offset: number;
}): Promise<{ rows: OutreachRecipientRow[]; total: number }> {
	if (!db) return { rows: [], total: 0 };
	const conditions: SQL[] = [
		eq(outreachRecipients.campaignId, params.campaignId),
	];
	const condition = filterCondition(params.filter);
	if (condition) conditions.push(condition);
	const search = params.search?.trim();
	if (search) {
		const likePattern = (value: string) =>
			`%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
		const digits = search.replace(/\D/g, "");
		const match = or(
			ilike(outreachRecipients.name, likePattern(search)),
			ilike(outreachRecipients.email, likePattern(search)),
			...(digits.length >= 3
				? [ilike(outreachRecipients.phone, likePattern(digits))]
				: []),
		);
		if (match) conditions.push(match);
	}
	const where = and(...conditions);
	const [rows, [totalRow]] = await Promise.all([
		recipientsQuery(where)
			.orderBy(desc(outreachRecipients.updatedAt), asc(outreachRecipients.id))
			.limit(params.limit)
			.offset(params.offset),
		db.select({ total: count() }).from(outreachRecipients).where(where),
	]);
	return {
		rows: rows.map(toRecipientRow),
		total: Number(totalRow?.total ?? 0),
	};
}

/** Все получатели рассылки — для выгрузки отчёта в CSV. */
export async function listAllOutreachRecipients(
	campaignId: string,
): Promise<OutreachRecipientRow[]> {
	if (!db) return [];
	const rows = await recipientsQuery(
		eq(outreachRecipients.campaignId, campaignId),
	).orderBy(asc(outreachRecipients.id));
	return rows.map(toRecipientRow);
}

/** Диалог с официальным ботом (messenger — telegram | max, userId — ID в мессенджере). */
export interface BotDialogRef {
	messenger: "telegram" | "max";
	userId: string;
}

/**
 * Диалоги с ботами, в которых клиент сам оставил этот телефон в сценарии
 * (выдача материала, предзаказ книги). Номера там записаны как ввёл клиент
 * («8 999…», «+7999…»), поэтому сравниваем полные нормализованные номера,
 * сохраняя международный префикс.
 */
export async function listBotDialogsByScenarioPhone(
	phone: string,
): Promise<BotDialogRef[]> {
	if (!db) return [];
	const digits = phone.replace(/\D/g, "");
	if (digits.length < 10) return [];
	// Одна нормализация для входа и обеих колонок: явный «+» сохраняет код
	// страны, российские местные номера дополняются кодом 7.
	const canonical = (
		value:
			| string
			| typeof botGuideDeliveries.phone
			| typeof bookPreorderOrders.phone,
	) => {
		const digits = sql`regexp_replace(${value}, '[^0-9]', '', 'g')`;
		return sql`case
			when position('+' in ${value}) = 0 and ${digits} ~ '^[3-9][0-9]{9}$'
				then '7' || ${digits}
			when position('+' in ${value}) = 0 and ${digits} ~ '^8[0-9]{10}$'
				then '7' || substring(${digits} from 2)
			else ${digits}
		end`;
	};
	const matches = (
		column: typeof botGuideDeliveries.phone | typeof bookPreorderOrders.phone,
	) => sql`${canonical(column)} = ${canonical(phone)}`;
	const bots = ["telegram", "max"];
	const [guides, preorders] = await Promise.all([
		db
			.select({
				messenger: botGuideDeliveries.messenger,
				userId: botGuideDeliveries.userId,
			})
			.from(botGuideDeliveries)
			.where(
				and(
					inArray(botGuideDeliveries.messenger, bots),
					matches(botGuideDeliveries.phone),
				),
			)
			.orderBy(desc(botGuideDeliveries.deliveredAt))
			.limit(10),
		db
			.select({
				messenger: bookPreorderOrders.messenger,
				userId: bookPreorderOrders.userId,
			})
			.from(bookPreorderOrders)
			.where(
				and(
					inArray(bookPreorderOrders.messenger, bots),
					matches(bookPreorderOrders.phone),
				),
			)
			.limit(10),
	]);
	return [...guides, ...preorders].flatMap((row) =>
		row.messenger === "telegram" || row.messenger === "max"
			? [{ messenger: row.messenger, userId: row.userId }]
			: [],
	);
}
