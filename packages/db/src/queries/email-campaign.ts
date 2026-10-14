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
	notInArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "../client";
import {
	emailCampaignRecipients,
	emailCampaigns,
} from "../schema/email-campaign";

export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type EmailCampaignRecipientRow =
	typeof emailCampaignRecipients.$inferSelect;
export type NewEmailCampaignRecipient =
	typeof emailCampaignRecipients.$inferInsert;

export type EmailCampaignAudience = "crm_stage" | "list";

export async function createEmailCampaign(data: {
	id: string;
	audience: EmailCampaignAudience;
	stageId?: string | null;
	stageName?: string | null;
	listId?: string | null;
	listName?: string | null;
	templateId: string;
	templateName?: string;
	subject: string;
	senderEmail: string;
	senderName?: string;
	provider: "unisender" | "rusender";
	publicBaseUrl?: string | null;
	totalDeals?: number;
	recipientsCount?: number;
}): Promise<void> {
	if (!db) return;
	await db.insert(emailCampaigns).values({ ...data, status: "queued" });
}

/** Фоновая задача взяла кампанию в работу. */
export async function markEmailCampaignRunning(id: string): Promise<void> {
	if (!db) return;
	await db
		.update(emailCampaigns)
		.set({ status: "running" })
		.where(eq(emailCampaigns.id, id));
}

/** Сохраняет id списка/письма/кампании Unisender после успешного запуска рассылки. */
export async function setEmailCampaignUnisenderIds(
	id: string,
	data: {
		unisenderListId: string;
		unisenderMessageId: string;
		unisenderCampaignId: string;
		recipientsCount: number;
	},
): Promise<void> {
	if (!db) return;
	await db
		.update(emailCampaigns)
		.set({ ...data, status: "running" })
		.where(eq(emailCampaigns.id, id));
}

export async function updateEmailCampaignStats(
	id: string,
	data: {
		sentCount?: number;
		openedCount?: number;
		clickedCount?: number;
		unsubscribedCount?: number;
	},
): Promise<void> {
	if (!db) return;
	await db.update(emailCampaigns).set(data).where(eq(emailCampaigns.id, id));
}

export async function finishEmailCampaign(
	id: string,
	data: {
		status: "done" | "error";
		error?: string;
		sentCount?: number;
		openedCount?: number;
		clickedCount?: number;
		unsubscribedCount?: number;
	},
): Promise<void> {
	if (!db) return;
	await db
		.update(emailCampaigns)
		.set({ ...data, finishedAt: new Date() })
		.where(eq(emailCampaigns.id, id));
}

export async function insertEmailCampaignRecipients(
	rows: NewEmailCampaignRecipient[],
): Promise<void> {
	if (!db || rows.length === 0) return;
	// Пачками — у Postgres лимит на число параметров в одном запросе.
	for (let i = 0; i < rows.length; i += 1000) {
		await db.insert(emailCampaignRecipients).values(rows.slice(i, i + 1000));
	}
}

export async function updateEmailCampaignRecipient(
	id: string,
	data: {
		status: "imported" | "sent" | "skipped" | "error";
		error: string | null;
		providerMessageId?: string | null;
		sentAt?: Date | null;
	},
): Promise<void> {
	if (!db) return;
	await db
		.update(emailCampaignRecipients)
		.set(data)
		.where(eq(emailCampaignRecipients.id, id));
}

export async function listEmailCampaigns(limit = 30): Promise<EmailCampaign[]> {
	if (!db) return [];
	return db
		.select()
		.from(emailCampaigns)
		.orderBy(desc(emailCampaigns.startedAt))
		.limit(limit);
}

export interface EmailCampaignWithStats extends EmailCampaign {
	stats: {
		recipients: number;
		sent: number;
		delivered: number;
		opened: number;
		clicked: number;
	};
}

/** История кампаний с воронкой по получателям — для таблицы на /email-broadcast. */
export async function listEmailCampaignsWithStats(
	limit = 50,
): Promise<EmailCampaignWithStats[]> {
	if (!db) return [];
	const r = emailCampaignRecipients;
	const stats = db
		.select({
			campaignId: r.campaignId,
			recipients: count().as("recipients"),
			sent: sql<number>`count(*) filter (where ${r.status} not in ('pending', 'skipped', 'error'))`.as(
				"sent",
			),
			delivered: count(r.deliveredAt).as("delivered"),
			opened: count(r.openedAt).as("opened"),
			clicked: count(r.clickedAt).as("clicked"),
		})
		.from(r)
		.groupBy(r.campaignId)
		.as("stats");
	const rows = await db
		.select({
			campaign: emailCampaigns,
			recipients: stats.recipients,
			sent: stats.sent,
			delivered: stats.delivered,
			opened: stats.opened,
			clicked: stats.clicked,
		})
		.from(emailCampaigns)
		.leftJoin(stats, eq(stats.campaignId, emailCampaigns.id))
		.orderBy(desc(emailCampaigns.startedAt))
		.limit(limit);
	return rows.map((row) => ({
		...row.campaign,
		stats: {
			recipients: Number(row.recipients ?? 0),
			sent: Number(row.sent ?? 0),
			delivered: Number(row.delivered ?? 0),
			opened: Number(row.opened ?? 0),
			clicked: Number(row.clicked ?? 0),
		},
	}));
}

/** Кампании в процессе отправки — опрашиваются фоновой задачей раз в 5 минут. */
export async function listRunningEmailCampaigns(): Promise<EmailCampaign[]> {
	if (!db) return [];
	return db
		.select()
		.from(emailCampaigns)
		.where(
			and(
				eq(emailCampaigns.status, "running"),
				isNotNull(emailCampaigns.unisenderCampaignId),
			),
		);
}

/** Последняя кампания по стадии — для предупреждения о возможном дубле. */
export async function getLastEmailCampaignForStage(
	stageId: string,
): Promise<EmailCampaign | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(emailCampaigns)
		.where(eq(emailCampaigns.stageId, stageId))
		.orderBy(desc(emailCampaigns.startedAt))
		.limit(1);
	return rows[0] ?? null;
}

/** Последняя кампания по списку — для предупреждения о возможном дубле. */
export async function getLastEmailCampaignForList(
	listId: string,
): Promise<EmailCampaign | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(emailCampaigns)
		.where(eq(emailCampaigns.listId, listId))
		.orderBy(desc(emailCampaigns.startedAt))
		.limit(1);
	return rows[0] ?? null;
}

/** Есть ли по шаблону незавершённая рассылка — используется, чтобы не дать удалить шаблон посреди отправки. */
export async function hasActiveEmailCampaignForTemplate(
	templateId: string,
): Promise<boolean> {
	if (!db) return false;
	const rows = await db
		.select({ id: emailCampaigns.id })
		.from(emailCampaigns)
		.where(
			and(
				eq(emailCampaigns.templateId, templateId),
				inArray(emailCampaigns.status, ["queued", "running"]),
			),
		)
		.limit(1);
	return rows.length > 0;
}

export async function getEmailCampaign(
	id: string,
): Promise<EmailCampaign | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(emailCampaigns)
		.where(eq(emailCampaigns.id, id))
		.limit(1);
	return rows[0] ?? null;
}

export async function listEmailCampaignRecipients(
	campaignId: string,
): Promise<EmailCampaignRecipientRow[]> {
	if (!db) return [];
	return db
		.select()
		.from(emailCampaignRecipients)
		.where(eq(emailCampaignRecipients.campaignId, campaignId))
		.orderBy(emailCampaignRecipients.contactName);
}

export async function getEmailCampaignRecipient(
	id: string,
): Promise<EmailCampaignRecipientRow | null> {
	if (!db) return null;
	const [row] = await db
		.select()
		.from(emailCampaignRecipients)
		.where(eq(emailCampaignRecipients.id, id))
		.limit(1);
	return row ?? null;
}

/**
 * Воронка кампании по получателям. Счётчики кумулятивные: открывший письмо
 * учитывается и в «доставлено», кликнувший — и в «открыто», поэтому
 * проценты открытий/кликов считаются честно от доставленных.
 */
export interface EmailCampaignFunnel {
	total: number;
	skipped: number;
	pending: number;
	sent: number;
	delivered: number;
	opened: number;
	clicked: number;
	bounced: number;
	complained: number;
	unsubscribed: number;
	failed: number;
	byStatus: Record<string, number>;
}

export async function getEmailCampaignFunnel(
	campaignId: string,
): Promise<EmailCampaignFunnel> {
	const funnel: EmailCampaignFunnel = {
		total: 0,
		skipped: 0,
		pending: 0,
		sent: 0,
		delivered: 0,
		opened: 0,
		clicked: 0,
		bounced: 0,
		complained: 0,
		unsubscribed: 0,
		failed: 0,
		byStatus: {},
	};
	if (!db) return funnel;

	const rows = await db
		.select({
			total: count(),
			delivered: count(emailCampaignRecipients.deliveredAt),
			opened: count(emailCampaignRecipients.openedAt),
			clicked: count(emailCampaignRecipients.clickedAt),
			bounced: count(emailCampaignRecipients.bouncedAt),
			complained: count(emailCampaignRecipients.complainedAt),
			unsubscribed: count(emailCampaignRecipients.unsubscribedAt),
		})
		.from(emailCampaignRecipients)
		.where(eq(emailCampaignRecipients.campaignId, campaignId));
	const byStatusRows = await db
		.select({ status: emailCampaignRecipients.status, n: count() })
		.from(emailCampaignRecipients)
		.where(eq(emailCampaignRecipients.campaignId, campaignId))
		.groupBy(emailCampaignRecipients.status);

	const agg = rows[0];
	for (const r of byStatusRows) funnel.byStatus[r.status] = Number(r.n);
	const status = (s: string) => funnel.byStatus[s] ?? 0;

	funnel.total = Number(agg?.total ?? 0);
	funnel.skipped = status("skipped");
	funnel.pending = status("pending");
	funnel.failed = status("error");
	funnel.delivered = Number(agg?.delivered ?? 0);
	funnel.opened = Number(agg?.opened ?? 0);
	funnel.clicked = Number(agg?.clicked ?? 0);
	funnel.bounced = Number(agg?.bounced ?? 0);
	funnel.complained = Number(agg?.complained ?? 0);
	funnel.unsubscribed = Number(agg?.unsubscribed ?? 0);
	// Ушло к провайдеру всё, что не пропущено, не ждёт очереди и не упало
	// с ошибкой: у Unisender до вебхука ok_sent получатель лишь «импортирован».
	funnel.sent = funnel.total - funnel.skipped - funnel.pending - funnel.failed;
	return funnel;
}

/** Статусы, по которым можно отфильтровать получателей на странице кампании. */
export const EMAIL_RECIPIENT_FILTERS = [
	"all",
	"sent",
	"delivered",
	"opened",
	"clicked",
	"not_opened",
	"bounced",
	"complained",
	"unsubscribed",
	"error",
	"skipped",
	"pending",
] as const;
export type EmailRecipientFilter = (typeof EMAIL_RECIPIENT_FILTERS)[number];

function recipientFilterCondition(
	filter: EmailRecipientFilter,
): SQL | undefined {
	const r = emailCampaignRecipients;
	switch (filter) {
		case "all":
			return undefined;
		// Кумулятивные фильтры совпадают со счётчиками воронки.
		case "sent":
			return notInArray(r.status, ["pending", "skipped", "error"]);
		case "delivered":
			return isNotNull(r.deliveredAt);
		case "opened":
			return isNotNull(r.openedAt);
		case "clicked":
			return isNotNull(r.clickedAt);
		case "not_opened":
			return and(isNotNull(r.deliveredAt), isNull(r.openedAt));
		case "bounced":
			return isNotNull(r.bouncedAt);
		case "complained":
			return isNotNull(r.complainedAt);
		case "unsubscribed":
			return isNotNull(r.unsubscribedAt);
		case "error":
		case "skipped":
		case "pending":
			return eq(r.status, filter);
	}
}

export async function listEmailCampaignRecipientsPage(params: {
	campaignId: string;
	filter: EmailRecipientFilter;
	search?: string;
	limit: number;
	offset: number;
}): Promise<{ rows: EmailCampaignRecipientRow[]; total: number }> {
	if (!db) return { rows: [], total: 0 };
	const conditions: SQL[] = [
		eq(emailCampaignRecipients.campaignId, params.campaignId),
	];
	const filterCondition = recipientFilterCondition(params.filter);
	if (filterCondition) conditions.push(filterCondition);
	const search = params.search?.trim();
	if (search) {
		const pattern = `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
		const match = or(
			ilike(emailCampaignRecipients.email, pattern),
			ilike(emailCampaignRecipients.contactName, pattern),
			ilike(emailCampaignRecipients.dealTitle, pattern),
		);
		if (match) conditions.push(match);
	}
	const where = and(...conditions);
	const [rows, [totalRow]] = await Promise.all([
		db
			.select()
			.from(emailCampaignRecipients)
			.where(where)
			.orderBy(
				asc(emailCampaignRecipients.email),
				asc(emailCampaignRecipients.id),
			)
			.limit(params.limit)
			.offset(params.offset),
		db.select({ total: count() }).from(emailCampaignRecipients).where(where),
	]);
	return { rows, total: Number(totalRow?.total ?? 0) };
}
