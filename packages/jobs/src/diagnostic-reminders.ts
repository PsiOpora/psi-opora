import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import { getScenarioTexts } from "@psi-opora/bot-core";
import {
  appendReminderSentComment,
  DEAL_CATEGORY_ID,
  DEAL_STAGE_IDS,
  extractClientContactId,
  formatConsultationTime,
  formatMoscowDateTime,
  MESSENGER_CONNECTOR_MAP,
  MESSENGER_FIELD,
  normalizeConsultationDt,
  pickChatIdForConnector,
  renderReminderMessage,
  toTimestamp,
} from "./reminders/shared";

const DIAGNOSTIC_DT_FIELD = "UF_CRM_1779871551489";

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
function sentKey(dealId: number, diagnosticAtIso: string): string {
  return `diag-reminder:sent:${dealId}:${diagnosticAtIso}`;
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
      STAGE_ID: DEAL_STAGE_IDS,
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

  const key = sentKey(dealId, diagnosticAt);
  const alreadySent = await redis.get(key);
  if (alreadySent) return { action: "skip", reason: "already_sent" };

  const messengerValue = String(deal[MESSENGER_FIELD] ?? "");
  const connectorContains = MESSENGER_CONNECTOR_MAP[messengerValue];
  if (!messengerValue || !connectorContains) {
    return { action: "skip", reason: "messenger_not_set_or_unknown" };
  }

  const clientContactId = extractClientContactId(deal);
  if (clientContactId <= 0)
    return { action: "skip", reason: "no_client_contact" };

  const texts = await getScenarioTexts();
  const template = texts.diagnostic_reminder_template?.trim();
  if (!template) return { action: "skip", reason: "empty_template_message" };

  const contact = await api.call<Record<string, unknown> | false>(
    "crm.contact.get",
    { id: clientContactId },
  );
  const clientName = contact ? String(contact.NAME ?? "").trim() : "";

  const message = renderReminderMessage(template, {
    name: clientName,
    time: formatConsultationTime(diagnosticAt),
  });

  const chatId = await pickChatIdForConnector(
    api,
    clientContactId,
    connectorContains,
  );
  if (chatId <= 0) return { action: "skip", reason: "no_openlines_chat" };

  // Отмечаем как отправленное до вызова send — повторный/параллельный
  // прогон крона в то же окно не продублирует сообщение.
  await redis.set(key, "1", { ex: SENT_TTL_SECONDS });

  const sent = await api.call("imopenlines.bot.session.message.send", {
    CHAT_ID: chatId,
    NAME: "DEFAULT",
    MESSAGE: message,
  });
  if (!sent) return { action: "error", reason: "send_failed" };

  await appendReminderSentComment(
    api,
    dealId,
    `🔔 Напоминание о диагностике (${formatConsultationTime(diagnosticAt)} МСК) отправлено клиенту в чат — ${formatMoscowDateTime()}`,
  );

  return { action: "sent" };
}

/**
 * Проход по сделкам, где диагностика попадает в ближайший час: шлём
 * автосообщение в Открытую линию. В отличие от sendConsultationReminders,
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
