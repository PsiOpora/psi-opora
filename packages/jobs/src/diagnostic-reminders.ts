import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import { getScenarioTexts } from "@psi-opora/bot-core";
import {
	DIAGNOSTIC_DT_FIELD,
	DIAGNOSTIC_STAGE_IDS,
	findContactEmail,
} from "./diagnostic-scheduling";
import {
	appendReminderSentComment,
	DEAL_CATEGORY_ID,
	extractClientContactId,
	formatConsultationTime,
	formatMoscowDateTime,
	botDeliveryLabel,
	normalizeConsultationDt,
	renderReminderMessage,
	sendReminderBotMessage,
	toTimestamp,
} from "./reminders/shared";

// Напоминание шлём, если диагностика через 0–65 минут — запас на случай
// редких прогонов крона.
const REMINDER_WINDOW_MS = 65 * 60 * 1000;
const SENT_TTL_SECONDS = 2 * 24 * 60 * 60;

/**
 * Ключ включает ISO-дату диагностики: если дата в сделке поменяется, ключ
 * станет другим и напоминание уйдёт заново на новое время — без отдельного
 * вебхука и Redis-состояния для отслеживания изменений, как у платной
 * консультации (см. consultation-reminders.ts).
 */
function sentKey(
	dealId: number,
	diagnosticAtIso: string,
	channel: "chat" | "email",
): string {
	return `diag-reminder:sent:${channel}:${dealId}:${diagnosticAtIso}`;
}

export interface SendDiagnosticRemindersResult {
	sent: number;
	skipped: number;
	errors: number;
	details: Array<{
		dealId: number;
		action: "sent" | "skip" | "error";
		reason?: string;
	}>;
}

async function findUpcomingDealIds(api: BitrixApi): Promise<number[]> {
	const now = new Date();
	const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);
	const deals = await api.list<{ ID: string | number }>("crm.deal.list", {
		select: ["ID"],
		filter: {
			CATEGORY_ID: DEAL_CATEGORY_ID,
			STAGE_ID: DIAGNOSTIC_STAGE_IDS,
			[`>=${DIAGNOSTIC_DT_FIELD}`]: now.toISOString(),
			[`<=${DIAGNOSTIC_DT_FIELD}`]: windowEnd.toISOString(),
		},
	});
	return deals
		.map((deal) => Number(deal.ID))
		.filter((id) => Number.isFinite(id) && id > 0);
}

async function trySendReminder(
	api: BitrixApi,
	redis: RedisClient,
	dealId: number,
): Promise<{ action: "sent" | "skip" | "error"; reason?: string }> {
	const deal = await api.call<Record<string, unknown> | false>("crm.deal.get", {
		id: dealId,
	});
	if (!deal) return { action: "skip", reason: "deal_not_found" };

	const diagnosticAt = normalizeConsultationDt(deal[DIAGNOSTIC_DT_FIELD]);
	if (diagnosticAt === null) {
		return { action: "skip", reason: "diagnostic_dt_empty" };
	}

	const diff = toTimestamp(diagnosticAt) - Date.now();
	if (diff <= 0 || diff > REMINDER_WINDOW_MS) {
		return { action: "skip", reason: "outside_1h_window" };
	}

	const clientContactId = extractClientContactId(deal);
	if (clientContactId <= 0)
		return { action: "skip", reason: "no_client_contact" };

	const texts = await getScenarioTexts();
	const template = texts.diagnostic_reminder_template?.trim();
	if (!template) return { action: "skip", reason: "empty_template_message" };

	const contact = await api.call<
		| {
				NAME?: string;
				EMAIL?: Array<{ VALUE?: string }>;
				IM?: Array<{ VALUE?: string; VALUE_TYPE?: string }>;
		  }
		| false
	>("crm.contact.get", { id: clientContactId });
	const clientName = contact ? String(contact.NAME ?? "").trim() : "";

	const message = renderReminderMessage(template, {
		name: clientName,
		time: formatConsultationTime(diagnosticAt),
	});

	const delivered: string[] = [];
	const reasons: string[] = [];
	let hadError = false;

	const chatKey = sentKey(dealId, diagnosticAt, "chat");
	const legacyChatKey = `diag-reminder:sent:${dealId}:${diagnosticAt}`;
	if ((await redis.get(chatKey)) || (await redis.get(legacyChatKey))) {
		reasons.push("chat_already_sent");
	} else {
		const botDelivery = await sendReminderBotMessage(deal, contact, message);
		if (botDelivery.status === "sent") {
			await redis.set(chatKey, "1", { ex: SENT_TTL_SECONDS });
			delivered.push(botDeliveryLabel(botDelivery.messenger));
		} else {
			reasons.push(botDelivery.reason);
			hadError ||= botDelivery.status === "error";
		}
	}

	const email = findContactEmail(contact);
	const emailKey = sentKey(dealId, diagnosticAt, "email");
	if (await redis.get(emailKey)) {
		reasons.push("email_already_sent");
	} else if (!email) {
		reasons.push("contact_email_empty");
	} else {
		try {
			const { sendDiagnosticEmail } = await import("./diagnostic-email");
			await sendDiagnosticEmail({
				to: email,
				subject: "Через час — диагностическая консультация",
				text: message,
			});
			await redis.set(emailKey, "1", { ex: SENT_TTL_SECONDS });
			delivered.push(`email ${email}`);
		} catch (error) {
			reasons.push(`email_send_failed: ${(error as Error).message}`);
			hadError = true;
		}
	}

	if (delivered.length > 0) {
		await appendReminderSentComment(
			api,
			dealId,
			`🔔 Напоминание о диагностике (${formatConsultationTime(diagnosticAt)} МСК) отправлено: ${delivered.join(" и ")} — ${formatMoscowDateTime()}`,
		);
		return { action: "sent", reason: reasons.join(", ") || undefined };
	}
	if (hadError) return { action: "error", reason: reasons.join(", ") };
	return { action: "skip", reason: reasons.join(", ") || "nothing_to_send" };
}

/**
 * Проход по сделкам, где диагностика попадает в ближайший час: шлём
 * автосообщение напрямую через нашего бота. В отличие от sendConsultationReminders,
 * без вебхука ONCRMDEALUPDATE — на каждый прогон крона просто вычитывает
 * подходящие сделки через REST (см. findUpcomingDealIds) и дедуплицирует
 * отправку по ключу Redis, завязанному на ISO-дату диагностики.
 */
export async function sendDiagnosticReminders(
	api: BitrixApi,
	redis: RedisClient,
): Promise<SendDiagnosticRemindersResult> {
	const dealIds = await findUpcomingDealIds(api);
	const result: SendDiagnosticRemindersResult = {
		sent: 0,
		skipped: 0,
		errors: 0,
		details: [],
	};

	for (const dealId of dealIds) {
		try {
			const outcome = await trySendReminder(api, redis, dealId);
			result.details.push({
				dealId,
				action: outcome.action,
				reason: outcome.reason,
			});
			if (outcome.action === "sent") {
				result.sent++;
			} else if (outcome.action === "error") {
				result.errors++;
				console.error(
					`[diagnostic-reminder] dealId=${dealId}: ${outcome.reason}`,
				);
			} else {
				result.skipped++;
				console.log(
					`[diagnostic-reminder] dealId=${dealId} skipped: ${outcome.reason}`,
				);
			}
		} catch (err) {
			result.errors++;
			result.details.push({
				dealId,
				action: "error",
				reason: (err as Error).message,
			});
			console.error(
				`[diagnostic-reminder] dealId=${dealId}: ${(err as Error).message}`,
			);
		}
	}

	return result;
}
