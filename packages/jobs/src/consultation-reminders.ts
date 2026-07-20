import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { Redis } from "@upstash/redis";

// Портал psi-opora.bitrix24.ru: воронка и стадии сделки, на которых
// отслеживаем дату консультации (см. старый Bitrix-модуль
// calls_consultation_reminders/config/app_config.php).
const DEAL_CATEGORY_ID = 0;
const DEAL_STAGE_IDS = ["EXECUTING", "UC_WWIO8W"];
const CONSULTATION_DT_FIELD = "UF_CRM_1779802779513";
const MESSENGER_FIELD = "UF_CRM_1779643796551";
const RESPONSIBLE_USER_ID = 1;
const TEMPLATE_CONTACT_ID = 6860;
const TEMPLATE_CONTACT_FIELD = "COMMENTS";

// Значения поля "Мессенджер" → подстрока CONNECTOR_ID чата Открытой линии
// (та же карта ID, что в bot-core/utils/bitrix.ts MESSENGER_FIELD_VALUES).
const MESSENGER_CONNECTOR_MAP: Record<string, string> = {
  "326": "wz_max",
  "328": "wz_telegram",
};

// Напоминание шлём, если консультация через 0–65 минут — запас на случай
// редких прогонов крона.
const REMINDER_WINDOW_MS = 65 * 60 * 1000;
const STATE_TTL_SECONDS = 30 * 24 * 60 * 60;

function dealStateKey(dealId: number): string {
  return `consult-reminder:deal:${dealId}`;
}

const INDEX_KEY = "consult-reminder:index";

interface ConsultationState {
  lastConsultationAt: string;
  lastActivityId?: number;
  lastDescription?: string;
  reminderSentAt: string | null;
  updatedAt: string;
}

async function readState(
  redis: Redis,
  dealId: number,
): Promise<ConsultationState | undefined> {
  return (await redis.get<ConsultationState>(dealStateKey(dealId))) ?? undefined;
}

async function writeState(
  redis: Redis,
  dealId: number,
  state: ConsultationState,
): Promise<void> {
  await redis.set(dealStateKey(dealId), state, { ex: STATE_TTL_SECONDS });
  await redis.sadd(INDEX_KEY, String(dealId));
}

async function dropFromIndex(redis: Redis, dealId: number): Promise<void> {
  await redis.srem(INDEX_KEY, String(dealId));
}

/** Нормализует дату из поля сделки к ISO-строке; Bitrix отдаёт datetime уже со смещением. */
function normalizeConsultationDt(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function toTimestamp(iso: string): number {
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

/** Убирает BBCode из шаблона сообщения (описание контакта-шаблона в CRM). */
export function stripBitrixBbCode(message: string): string {
  let text = message.trim();
  if (!text) return "";

  text = text.replace(/\[br\s*\/?\]/gi, "\n");
  text = text.replace(/\[\/?p\s*\]/gi, "\n");
  text = text.replace(/\[\/?quote[^\]]*\]/gi, "");
  text = text.replace(/\[\/?b\s*\]/gi, "");
  text = text.replace(/\[\/?i\s*\]/gi, "");
  text = text.replace(/\[\/?u\s*\]/gi, "");
  text = text.replace(/\[\/?code[^\]]*\]/gi, "");
  text = text.replace(/\[\/?list[^\]]*\]/gi, "");
  text = text.replace(/\[\/?li\s*\]/gi, "- ");
  text = text.replace(/\[\/?url[^\]]*\]/gi, "");
  text = text.replace(/\[[^\]]+\]/g, "");

  text = text.replace(/\r\n?/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

function extractClientContactId(deal: Record<string, unknown>): number {
  const contactId = Number(deal.CONTACT_ID ?? 0);
  if (contactId > 0) return contactId;

  const ids = deal.CONTACT_IDS;
  if (Array.isArray(ids) && ids.length > 0) {
    const first = Number(ids[0] ?? 0);
    return first > 0 ? first : 0;
  }
  return 0;
}

interface BitrixActivity {
  ID?: string | number;
  SUBJECT?: string;
  DESCRIPTION?: string;
  DEADLINE?: string;
  END_TIME?: string;
  START_TIME?: string;
}

function pickConsultationActivity(
  activities: BitrixActivity[],
  oldConsultationAt: string,
): BitrixActivity | null {
  const targetTs = toTimestamp(oldConsultationAt) || null;
  const now = Date.now();

  let best: BitrixActivity | null = null;
  let bestDelta: number | null = null;

  for (const activity of activities) {
    const dt = activity.DEADLINE || activity.END_TIME || activity.START_TIME || "";
    if (!dt) continue;

    const ts = new Date(dt).getTime();
    if (!Number.isFinite(ts) || ts <= 0) continue;

    if (targetTs !== null && targetTs > 0 && Math.abs(ts - targetTs) <= 60_000) {
      return activity;
    }

    if (ts <= now) continue;

    const delta = targetTs !== null ? Math.abs(ts - targetTs) : ts;
    if (bestDelta === null || delta < bestDelta) {
      bestDelta = delta;
      best = activity;
    }
  }

  return best;
}

export type ConsultationDealUpdateResult =
  | { action: "skip"; reason: string; [extra: string]: unknown }
  | { action: "init"; lastConsultationAt: string }
  | {
      action: "recreate";
      oldConsultationAt: string;
      newConsultationAt: string;
      oldActivityId: number;
      newActivityId: number | null;
      completedOld: boolean;
    };

/**
 * Обработка вебхука ONCRMDEALUPDATE: если дата консультации в сделке
 * поменялась — завершает старую CRM-активность и создаёт новую,
 * сбрасывая флаг отправленного напоминания. Порт
 * ConsultationActivityService::handleDealUpdate.
 */
export async function handleConsultationDealUpdate(
  api: BitrixApi,
  redis: Redis,
  dealId: number,
): Promise<ConsultationDealUpdateResult> {
  const deal = await api.call<Record<string, unknown> | false>("crm.deal.get", {
    id: dealId,
  });
  if (!deal) return { action: "skip", reason: "deal_not_found" };

  const categoryId = Number(deal.CATEGORY_ID ?? -1);
  if (categoryId !== DEAL_CATEGORY_ID) {
    return { action: "skip", reason: "category_mismatch", categoryId };
  }

  const stageId = String(deal.STAGE_ID ?? "");
  if (!DEAL_STAGE_IDS.includes(stageId)) {
    return { action: "skip", reason: "stage_mismatch", stageId };
  }

  const newConsultationAt = normalizeConsultationDt(deal[CONSULTATION_DT_FIELD]);
  if (newConsultationAt === null) {
    return { action: "skip", reason: "consultation_dt_empty_or_invalid" };
  }

  const state = await readState(redis, dealId);
  const now = new Date().toISOString();

  if (!state?.lastConsultationAt) {
    await writeState(redis, dealId, {
      lastConsultationAt: newConsultationAt,
      reminderSentAt: null,
      updatedAt: now,
    });
    return { action: "init", lastConsultationAt: newConsultationAt };
  }

  const oldConsultationAt = state.lastConsultationAt;

  if (oldConsultationAt === newConsultationAt) {
    return { action: "skip", reason: "dt_not_changed", consultationAt: newConsultationAt };
  }

  const oldTs = toTimestamp(oldConsultationAt);
  if (oldTs > 0 && oldTs <= Date.now()) {
    await writeState(redis, dealId, {
      ...state,
      lastConsultationAt: newConsultationAt,
      updatedAt: now,
    });
    return { action: "skip", reason: "old_dt_already_passed", oldConsultationAt };
  }

  const activities = await api.call<BitrixActivity[]>("crm.activity.list", {
    order: { ID: "DESC" },
    filter: {
      OWNER_TYPE_ID: 2,
      OWNER_ID: dealId,
      COMPLETED: "N",
      RESPONSIBLE_ID: RESPONSIBLE_USER_ID,
    },
    select: ["*"],
  });

  const oldActivity = pickConsultationActivity(activities ?? [], oldConsultationAt);
  if (!oldActivity) {
    await writeState(redis, dealId, {
      ...state,
      lastConsultationAt: newConsultationAt,
      reminderSentAt: null,
      updatedAt: now,
    });
    return { action: "skip", reason: "no_active_activity_found" };
  }

  const oldActivityId = Number(oldActivity.ID ?? 0);
  const oldTitle = String(oldActivity.SUBJECT ?? "");
  const oldDescription = String(oldActivity.DESCRIPTION ?? "");

  let completedOld = false;
  if (oldActivityId > 0) {
    try {
      const result = await api.call("crm.activity.update", {
        id: oldActivityId,
        fields: { COMPLETED: "Y", STATUS: 2, END_TIME: now },
      });
      completedOld = Boolean(result);
    } catch (err) {
      console.error(
        `[consultation-reminder] не удалось завершить активность ${oldActivityId}: ${(err as Error).message}`,
      );
    }
  }

  let newActivityId: number | null = null;
  try {
    const response = await api.call<{ id?: number | string }>(
      "crm.activity.todo.add",
      {
        ownerTypeId: 2,
        ownerId: dealId,
        deadline: newConsultationAt,
        title: oldTitle,
        description: oldDescription,
        responsibleId: RESPONSIBLE_USER_ID,
      },
    );
    const id = Number(response?.id ?? 0);
    newActivityId = id > 0 ? id : null;
  } catch (err) {
    console.error(
      `[consultation-reminder] не удалось создать активность для сделки ${dealId}: ${(err as Error).message}`,
    );
  }

  await writeState(redis, dealId, {
    lastConsultationAt: newConsultationAt,
    lastActivityId: newActivityId ?? undefined,
    lastDescription: oldDescription,
    reminderSentAt: null,
    updatedAt: now,
  });

  return {
    action: "recreate",
    oldConsultationAt,
    newConsultationAt,
    oldActivityId,
    newActivityId,
    completedOld,
  };
}

interface OpenLinesChat {
  CHAT_ID?: string | number;
  CONNECTOR_ID?: string;
}

async function pickChatIdForConnector(
  api: BitrixApi,
  clientContactId: number,
  connectorContains: string,
): Promise<number> {
  const chats = await api.call<OpenLinesChat[]>("imopenlines.crm.chat.get", {
    CRM_ENTITY_TYPE: "contact",
    CRM_ENTITY: clientContactId,
    ACTIVE_ONLY: "N",
  });
  const list = chats ?? [];

  if (!connectorContains) {
    return Number(list[0]?.CHAT_ID ?? 0);
  }

  for (const chat of list) {
    const connectorId = String(chat.CONNECTOR_ID ?? "");
    if (connectorId?.includes(connectorContains)) {
      return Number(chat.CHAT_ID ?? 0);
    }
  }
  return 0;
}

export interface SendConsultationRemindersResult {
  sent: number;
  skipped: number;
  errors: number;
  details: Array<{ dealId: number; action: "sent" | "skip" | "error"; reason?: string }>;
}

async function trySendOneHourReminder(
  api: BitrixApi,
  dealId: number,
  state: ConsultationState,
): Promise<{ action: "sent" | "skip" | "error"; reason?: string }> {
  const consultTs = toTimestamp(state.lastConsultationAt);
  if (consultTs <= 0) return { action: "skip", reason: "no_consultation_dt_in_state" };

  const diff = consultTs - Date.now();
  if (diff <= 0 || diff > REMINDER_WINDOW_MS) {
    return { action: "skip", reason: "outside_1h_window" };
  }

  if (state.reminderSentAt) return { action: "skip", reason: "already_sent" };

  const deal = await api.call<Record<string, unknown> | false>("crm.deal.get", {
    id: dealId,
  });
  if (!deal) return { action: "skip", reason: "deal_not_found" };

  if (Number(deal.CATEGORY_ID ?? -1) !== DEAL_CATEGORY_ID) {
    return { action: "skip", reason: "category_mismatch" };
  }
  if (!DEAL_STAGE_IDS.includes(String(deal.STAGE_ID ?? ""))) {
    return { action: "skip", reason: "stage_mismatch" };
  }

  const dealConsultationAt = normalizeConsultationDt(deal[CONSULTATION_DT_FIELD]);
  if (dealConsultationAt === null) {
    return { action: "skip", reason: "deal_consultation_dt_empty" };
  }

  const messengerValue = String(deal[MESSENGER_FIELD] ?? "");
  const connectorContains = MESSENGER_CONNECTOR_MAP[messengerValue];
  if (!messengerValue || !connectorContains) {
    return { action: "skip", reason: "messenger_not_set_or_unknown" };
  }

  const clientContactId = extractClientContactId(deal);
  if (clientContactId <= 0) return { action: "skip", reason: "no_client_contact" };

  const templateContact = await api.call<Record<string, unknown> | false>(
    "crm.contact.get",
    { id: TEMPLATE_CONTACT_ID },
  );
  const rawMessage = templateContact
    ? String(templateContact[TEMPLATE_CONTACT_FIELD] ?? "")
    : "";
  const message = stripBitrixBbCode(rawMessage);
  if (!message) return { action: "skip", reason: "empty_template_message" };

  const chatId = await pickChatIdForConnector(api, clientContactId, connectorContains);
  if (chatId <= 0) return { action: "skip", reason: "no_openlines_chat" };

  const sent = await api.call("imopenlines.bot.session.message.send", {
    CHAT_ID: chatId,
    NAME: "DEFAULT",
    MESSAGE: message,
  });
  if (!sent) return { action: "error", reason: "send_failed" };

  return { action: "sent" };
}

/**
 * Сделки, где консультация попадает в окно напоминания, но которых может
 * не быть в Redis-индексе — если вебхук ONCRMDEALUPDATE не сработал
 * (даунтайм, сетевой сбой) или дата поменялась до того, как вебхук был
 * настроен на сделке.
 */
async function findUpcomingDealIdsViaRest(api: BitrixApi): Promise<number[]> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);
  const deals = await api.list<{ ID: string | number }>("crm.deal.list", {
    select: ["ID"],
    filter: {
      CATEGORY_ID: DEAL_CATEGORY_ID,
      STAGE_ID: DEAL_STAGE_IDS,
      [`>=${CONSULTATION_DT_FIELD}`]: now.toISOString(),
      [`<=${CONSULTATION_DT_FIELD}`]: windowEnd.toISOString(),
    },
  });
  return deals
    .map((deal) => Number(deal.ID))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * Подстраховка от пропущенных вебхуков: прогоняет найденные через REST
 * сделки через тот же handleConsultationDealUpdate, что и сам вебхук —
 * если состояние в Redis уже актуально, это no-op (action: "skip").
 */
async function resyncFromRest(api: BitrixApi, redis: Redis): Promise<void> {
  const dealIds = await findUpcomingDealIdsViaRest(api);
  for (const dealId of dealIds) {
    try {
      await handleConsultationDealUpdate(api, redis, dealId);
    } catch (err) {
      console.error(
        `[consultation-reminder] resync dealId=${dealId}: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Проход по отслеживаемым сделкам: тем, у кого консультация в ближайший
 * час и напоминание ещё не отправлено, шлём автосообщение в Открытую
 * линию. Порт ReminderController::actionSendOneHour.
 *
 * Перед этим подчищает Redis-индекс через REST — на случай, если вебхук
 * ONCRMDEALUPDATE не долетел (см. resyncFromRest).
 */
export async function sendConsultationReminders(
  api: BitrixApi,
  redis: Redis,
): Promise<SendConsultationRemindersResult> {
  await resyncFromRest(api, redis);

  const dealIds = await redis.smembers(INDEX_KEY);
  const result: SendConsultationRemindersResult = {
    sent: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  for (const idStr of dealIds) {
    const dealId = Number(idStr);
    if (!dealId) {
      await redis.srem(INDEX_KEY, idStr);
      continue;
    }

    const state = await readState(redis, dealId);
    if (!state) {
      await dropFromIndex(redis, dealId);
      continue;
    }

    try {
      const outcome = await trySendOneHourReminder(api, dealId, state);
      result.details.push({ dealId, action: outcome.action, reason: outcome.reason });
      if (outcome.action === "sent") {
        result.sent++;
        await writeState(redis, dealId, {
          ...state,
          reminderSentAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        await dropFromIndex(redis, dealId);
      } else if (outcome.action === "error") {
        result.errors++;
        console.error(
          `[consultation-reminder] dealId=${dealId}: ${outcome.reason}`,
        );
      } else {
        result.skipped++;
        console.log(
          `[consultation-reminder] dealId=${dealId} skipped: ${outcome.reason}`,
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
        `[consultation-reminder] dealId=${dealId}: ${(err as Error).message}`,
      );
    }
  }

  return result;
}
