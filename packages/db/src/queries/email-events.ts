import { and, asc, eq } from "drizzle-orm";
import { db } from "../client";
import {
	emailCampaignRecipients,
	emailCampaigns,
} from "../schema/email-campaign";
import { emailEvents } from "../schema/email-events";
import {
	applyEmailEvent,
	type EmailEventType,
	SUPPRESSING_EVENTS,
} from "./email-recipient-state";
import { addEmailSuppression } from "./email-suppressions";

export type EmailEventRow = typeof emailEvents.$inferSelect;
export type { EmailEventType } from "./email-recipient-state";
export {
	applyEmailEvent,
	deriveRecipientStatus,
	EMAIL_EVENT_TYPES,
} from "./email-recipient-state";

/** Как найти получателя рассылки, к которому относится событие. */
export type EmailEventMatch =
	| { recipientId: string }
	/** uuid письма Rusender (taskId в вебхуке). */
	| { providerMessageId: string }
	/** Unisender шлёт campaign_id своей кампании и адрес получателя. */
	| { unisenderCampaignId: string; email: string };

export interface IncomingEmailEvent {
	provider: "rusender" | "unisender" | "internal";
	/** Уникальный ID события у источника — повтор с тем же ID игнорируется. */
	externalId: string;
	type: EmailEventType;
	occurredAt: Date;
	email?: string | null;
	details?: string | null;
	payload?: unknown;
	match: EmailEventMatch;
}

type RecipientRow = typeof emailCampaignRecipients.$inferSelect;

async function findRecipient(
	match: EmailEventMatch,
): Promise<RecipientRow | null> {
	if (!db) return null;
	if ("recipientId" in match) {
		const [row] = await db
			.select()
			.from(emailCampaignRecipients)
			.where(eq(emailCampaignRecipients.id, match.recipientId))
			.limit(1);
		return row ?? null;
	}
	if ("providerMessageId" in match) {
		const [row] = await db
			.select()
			.from(emailCampaignRecipients)
			.where(
				eq(emailCampaignRecipients.providerMessageId, match.providerMessageId),
			)
			.limit(1);
		return row ?? null;
	}
	const [row] = await db
		.select({ recipient: emailCampaignRecipients })
		.from(emailCampaignRecipients)
		.innerJoin(
			emailCampaigns,
			eq(emailCampaigns.id, emailCampaignRecipients.campaignId),
		)
		.where(
			and(
				eq(emailCampaigns.unisenderCampaignId, match.unisenderCampaignId),
				eq(emailCampaignRecipients.email, match.email.trim().toLowerCase()),
			),
		)
		.limit(1);
	return row?.recipient ?? null;
}

const MAX_UPDATE_ATTEMPTS = 5;

/**
 * Применяет событие к строке получателя с оптимистичной блокировкой:
 * параллельный вебхук по тому же письму увеличит tracking_version, и
 * наше обновление повторится уже поверх его результата.
 */
async function applyToRecipient(
	initial: RecipientRow,
	event: IncomingEmailEvent,
): Promise<void> {
	if (!db) return;
	let row: RecipientRow | null = initial;
	for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS && row; attempt++) {
		const next = applyEmailEvent(row, event);
		const updated = await db
			.update(emailCampaignRecipients)
			.set({
				status: next.status,
				error: next.error,
				sentAt: next.sentAt,
				deliveredAt: next.deliveredAt,
				openedAt: next.openedAt,
				clickedAt: next.clickedAt,
				bouncedAt: next.bouncedAt,
				complainedAt: next.complainedAt,
				unsubscribedAt: next.unsubscribedAt,
				openCount: next.openCount,
				clickCount: next.clickCount,
				lastEventAt: next.lastEventAt,
				trackingVersion: row.trackingVersion + 1,
			})
			.where(
				and(
					eq(emailCampaignRecipients.id, row.id),
					eq(emailCampaignRecipients.trackingVersion, row.trackingVersion),
				),
			)
			.returning({ id: emailCampaignRecipients.id });
		if (updated.length > 0) return;
		row = await findRecipient({ recipientId: row.id });
	}
	console.error(
		`[email-events] не удалось применить событие ${event.type} к получателю ${initial.id}: конкурентные обновления`,
	);
}

/**
 * Записывает события доставки в журнал и обновляет статусы получателей.
 * Повторно доставленное событие (тот же provider + externalId) пропускается.
 * Отписка, жалоба и hard bounce добавляют адрес в глобальный стоп-лист —
 * даже если получатель не найден (например, письмо из старой рассылки).
 */
export async function recordEmailEvents(
	events: IncomingEmailEvent[],
): Promise<{ applied: number; duplicates: number; unmatched: number }> {
	const stats = { applied: 0, duplicates: 0, unmatched: 0 };
	if (!db) return stats;

	for (const event of events) {
		const recipient = await findRecipient(event.match);
		const email = (event.email ?? recipient?.email ?? null)
			?.trim()
			.toLowerCase();

		const inserted = await db
			.insert(emailEvents)
			.values({
				id: crypto.randomUUID(),
				provider: event.provider,
				externalId: event.externalId,
				campaignId: recipient?.campaignId ?? null,
				recipientId: recipient?.id ?? null,
				email: email ?? null,
				type: event.type,
				occurredAt: event.occurredAt,
				details: event.details ?? null,
				payload: event.payload ?? null,
			})
			.onConflictDoNothing({
				target: [emailEvents.provider, emailEvents.externalId],
			})
			.returning({ id: emailEvents.id });
		if (inserted.length === 0) {
			stats.duplicates++;
			continue;
		}

		const suppressReason = SUPPRESSING_EVENTS[event.type];
		if (suppressReason && email) {
			await addEmailSuppression({
				email,
				reason: suppressReason,
				campaignId: recipient?.campaignId ?? null,
				details: event.details ?? null,
			});
		}

		if (!recipient) {
			stats.unmatched++;
			continue;
		}
		await applyToRecipient(recipient, event);
		stats.applied++;
	}

	return stats;
}

export async function listEmailEventsForRecipient(
	recipientId: string,
): Promise<EmailEventRow[]> {
	if (!db) return [];
	return db
		.select()
		.from(emailEvents)
		.where(eq(emailEvents.recipientId, recipientId))
		.orderBy(asc(emailEvents.occurredAt));
}
