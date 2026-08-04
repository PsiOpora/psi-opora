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

const CONSULTATION_DT_FIELD = "UF_CRM_1779802779513";
// ID пользователя Bitrix24 — Андрей Клюев. Используется и как ответственный
// за CRM-активность консультации, и как владелец календаря по умолчанию.
const RESPONSIBLE_USER_ID = 1;

// Напоминание шлём, если консультация через 0–65 минут — запас на случай
// редких прогонов крона.
const REMINDER_WINDOW_MS = 65 * 60 * 1000;
const STATE_TTL_SECONDS = 30 * 24 * 60 * 60;

// Бесплатная консультация проходит по телефону, без видеозвонка.
const CONSULTATION_DURATION_MS = 60 * 60 * 1000;
const CONSULTATION_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  dateStyle: "long",
  timeStyle: "short",
});

function dealStateKey(dealId: number): string {
  return `consult-reminder:deal:${dealId}`;
}

const INDEX_KEY = "consult-reminder:index";

interface ConsultationState {
  lastConsultationAt: string;
  lastActivityId?: number;
  lastDescription?: string;
  calendarEventId?: number;
  reminderSentAt: string | null;
  updatedAt: string;
}

interface ConsultationContactEmail {
  VALUE?: string;
}

interface ConsultationContactPhone {
  VALUE?: string;
}

interface ConsultationContact {
  ID?: string | number;
  NAME?: string;
  LAST_NAME?: string;
  EMAIL?: ConsultationContactEmail[];
  PHONE?: ConsultationContactPhone[];
}

// Владелец события — Андрей Клюев (RESPONSIBLE_USER_ID). Переменная окружения
// оставлена для явного переопределения, но по умолчанию событие всегда
// попадает именно в его календарь, а не в общий/системный.
function consultationOwnerUserId(): number {
  const configured = Number(
    process.env.BITRIX_CONSULTATION_USER_ID ?? RESPONSIBLE_USER_ID,
  );
  return Number.isInteger(configured) && configured > 0
    ? configured
    : RESPONSIBLE_USER_ID;
}

function consultationContactName(contact: ConsultationContact | false): string {
  if (!contact) return "";
  return [contact.NAME, contact.LAST_NAME]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function consultationContactPhone(
  contact: ConsultationContact | false,
): string {
  if (!contact) return "";
  return String(contact.PHONE?.[0]?.VALUE ?? "").trim();
}

function formatConsultationDate(iso: string): string {
  return CONSULTATION_DATE_FORMATTER.format(new Date(iso));
}

function consultationEventName(
  deal: Record<string, unknown>,
  clientName: string,
): string {
  const suffix = clientName || String(deal.TITLE ?? "").trim();
  return suffix ? `Бесплатная консультация — ${suffix}` : "Бесплатная консультация";
}

function consultationEventDescription(params: {
  dealId: number;
  clientName: string;
  phone: string;
}): string {
  return [
    params.clientName ? `Клиент: ${params.clientName}` : "",
    params.phone ? `Телефон: ${params.phone}` : "",
    `Сделка Bitrix24: D_${params.dealId}`,
    "Формат: звонок по телефону",
  ]
    .filter(Boolean)
    .join("\n");
}

function consultationCalendarFields(params: {
  dealId: number;
  contactId: number;
  consultationAt: string;
  name: string;
  description: string;
}): Record<string, unknown> {
  const startsAt = new Date(params.consultationAt);
  const endsAt = new Date(startsAt.getTime() + CONSULTATION_DURATION_MS);
  return {
    type: "user",
    ownerId: consultationOwnerUserId(),
    name: params.name,
    description: params.description,
    from: startsAt.toISOString(),
    to: endsAt.toISOString(),
    skip_time: "N",
    timezone_from: "Europe/Moscow",
    timezone_to: "Europe/Moscow",
    accessibility: "busy",
    importance: "high",
    private_event: "N",
    is_meeting: "N",
    remind: [{ type: "min", count: 15 }],
    crm_fields: [
      `D_${params.dealId}`,
      ...(params.contactId > 0 ? [`C_${params.contactId}`] : []),
    ],
  };
}

/**
 * Создаёт или обновляет событие в календаре Bitrix24 под бесплатную
 * консультацию. Отдельно от crm.activity.todo.add (задачи, а не события
 * календаря) — портал сам не показывал б/п консультации в календаре
 * Андрея Клюева, только диагностику.
 */
async function syncConsultationCalendarEvent(params: {
  api: BitrixApi;
  dealId: number;
  deal: Record<string, unknown>;
  contactId: number;
  consultationAt: string;
  previousConsultationAt?: string;
  previousCalendarEventId?: number;
}): Promise<number> {
  const { api, dealId, deal, contactId, consultationAt } = params;
  let calendarEventId = params.previousCalendarEventId ?? 0;

  if (calendarEventId && params.previousConsultationAt === consultationAt) {
    return calendarEventId;
  }

  const contact =
    contactId > 0
      ? await api.call<ConsultationContact | false>("crm.contact.get", {
          id: contactId,
        })
      : false;
  const clientName = consultationContactName(contact);
  const fields = consultationCalendarFields({
    dealId,
    contactId,
    consultationAt,
    name: consultationEventName(deal, clientName),
    description: consultationEventDescription({
      dealId,
      clientName,
      phone: consultationContactPhone(contact),
    }),
  });

  if (!calendarEventId) {
    calendarEventId = Number(
      await api.call("calendar.event.add", {
        ...fields,
        auto_detect_section: "Y",
      }),
    );
    if (!calendarEventId) {
      throw new Error("Bitrix24 не вернул ID события консультации");
    }
    return calendarEventId;
  }

  try {
    await api.call("calendar.event.update", { id: calendarEventId, ...fields });
  } catch (error) {
    console.warn(
      `[consultation-reminder] событие ${calendarEventId} не обновлено, создаём заново: ${(error as Error).message}`,
    );
    calendarEventId = Number(
      await api.call("calendar.event.add", {
        ...fields,
        auto_detect_section: "Y",
      }),
    );
    if (!calendarEventId) throw error;
  }
  return calendarEventId;
}

async function readState(
  redis: RedisClient,
  dealId: number,
): Promise<ConsultationState | undefined> {
  return (
    (await redis.get<ConsultationState>(dealStateKey(dealId))) ?? undefined
  );
}

async function writeState(
  redis: RedisClient,
  dealId: number,
  state: ConsultationState,
): Promise<void> {
  await redis.set(dealStateKey(dealId), state, { ex: STATE_TTL_SECONDS });
  await redis.sadd(INDEX_KEY, String(dealId));
}

async function dropFromIndex(
  redis: RedisClient,
  dealId: number,
): Promise<void> {
  await redis.srem(INDEX_KEY, String(dealId));
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
    const dt =
      activity.DEADLINE || activity.END_TIME || activity.START_TIME || "";
    if (!dt) continue;

    const ts = new Date(dt).getTime();
    if (!Number.isFinite(ts) || ts <= 0) continue;

    if (
      targetTs !== null &&
      targetTs > 0 &&
      Math.abs(ts - targetTs) <= 60_000
    ) {
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
  | { action: "init"; lastConsultationAt: string; calendarEventId?: number }
  | {
      action: "recreate";
      oldConsultationAt: string;
      newConsultationAt: string;
      oldActivityId: number;
      newActivityId: number | null;
      calendarEventId: number;
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
  redis: RedisClient,
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

  const newConsultationAt = normalizeConsultationDt(
    deal[CONSULTATION_DT_FIELD],
  );
  if (newConsultationAt === null) {
    return { action: "skip", reason: "consultation_dt_empty_or_invalid" };
  }

  const state = await readState(redis, dealId);
  const now = new Date().toISOString();
  const contactId = extractClientContactId(deal);

  if (!state?.lastConsultationAt) {
    const calendarEventId = await syncConsultationCalendarEvent({
      api,
      dealId,
      deal,
      contactId,
      consultationAt: newConsultationAt,
      previousCalendarEventId: state?.calendarEventId,
    });
    await writeState(redis, dealId, {
      lastConsultationAt: newConsultationAt,
      calendarEventId,
      reminderSentAt: null,
      updatedAt: now,
    });
    await appendReminderSentComment(
      api,
      dealId,
      `📅 Бесплатная консультация записана в календарь Андрея Клюева на ${formatConsultationDate(newConsultationAt)}. Событие #${calendarEventId}.`,
    );
    return {
      action: "init",
      lastConsultationAt: newConsultationAt,
      calendarEventId,
    };
  }

  const oldConsultationAt = state.lastConsultationAt;

  if (oldConsultationAt === newConsultationAt) {
    return {
      action: "skip",
      reason: "dt_not_changed",
      consultationAt: newConsultationAt,
    };
  }

  const oldTs = toTimestamp(oldConsultationAt);
  if (oldTs > 0 && oldTs <= Date.now()) {
    const calendarEventId = await syncConsultationCalendarEvent({
      api,
      dealId,
      deal,
      contactId,
      consultationAt: newConsultationAt,
      previousConsultationAt: oldConsultationAt,
      previousCalendarEventId: state.calendarEventId,
    });
    await writeState(redis, dealId, {
      ...state,
      lastConsultationAt: newConsultationAt,
      calendarEventId,
      updatedAt: now,
    });
    return {
      action: "skip",
      reason: "old_dt_already_passed",
      oldConsultationAt,
    };
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

  const oldActivity = pickConsultationActivity(
    activities ?? [],
    oldConsultationAt,
  );
  if (!oldActivity) {
    const calendarEventId = await syncConsultationCalendarEvent({
      api,
      dealId,
      deal,
      contactId,
      consultationAt: newConsultationAt,
      previousConsultationAt: oldConsultationAt,
      previousCalendarEventId: state.calendarEventId,
    });
    await writeState(redis, dealId, {
      ...state,
      lastConsultationAt: newConsultationAt,
      calendarEventId,
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

  const calendarEventId = await syncConsultationCalendarEvent({
    api,
    dealId,
    deal,
    contactId,
    consultationAt: newConsultationAt,
    previousConsultationAt: oldConsultationAt,
    previousCalendarEventId: state.calendarEventId,
  });

  await writeState(redis, dealId, {
    lastConsultationAt: newConsultationAt,
    lastActivityId: newActivityId ?? undefined,
    lastDescription: oldDescription,
    calendarEventId,
    reminderSentAt: null,
    updatedAt: now,
  });

  await appendReminderSentComment(
    api,
    dealId,
    `📅 Бесплатная консультация записана в календарь Андрея Клюева на ${formatConsultationDate(newConsultationAt)}. Событие #${calendarEventId}.`,
  );

  return {
    action: "recreate",
    oldConsultationAt,
    newConsultationAt,
    oldActivityId,
    newActivityId,
    calendarEventId,
    completedOld,
  };
}

export interface SendConsultationRemindersResult {
  sent: number;
  skipped: number;
  errors: number;
  details: Array<{
    dealId: number;
    action: "sent" | "skip" | "error";
    reason?: string;
  }>;
}

async function trySendOneHourReminder(
  api: BitrixApi,
  dealId: number,
  state: ConsultationState,
): Promise<{ action: "sent" | "skip" | "error"; reason?: string }> {
  const consultTs = toTimestamp(state.lastConsultationAt);
  if (consultTs <= 0)
    return { action: "skip", reason: "no_consultation_dt_in_state" };

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

  const dealConsultationAt = normalizeConsultationDt(
    deal[CONSULTATION_DT_FIELD],
  );
  if (dealConsultationAt === null) {
    return { action: "skip", reason: "deal_consultation_dt_empty" };
  }

  const messengerValue = String(deal[MESSENGER_FIELD] ?? "");
  const connectorContains = MESSENGER_CONNECTOR_MAP[messengerValue];
  if (!messengerValue || !connectorContains) {
    return { action: "skip", reason: "messenger_not_set_or_unknown" };
  }

  const clientContactId = extractClientContactId(deal);
  if (clientContactId <= 0)
    return { action: "skip", reason: "no_client_contact" };

  const texts = await getScenarioTexts();
  const template = texts.consultation_reminder_template?.trim();
  if (!template) return { action: "skip", reason: "empty_template_message" };

  const contact = await api.call<Record<string, unknown> | false>(
    "crm.contact.get",
    { id: clientContactId },
  );
  const clientName = contact ? String(contact.NAME ?? "").trim() : "";

  const message = renderReminderMessage(template, {
    name: clientName,
    time: formatConsultationTime(dealConsultationAt),
  });

  const chatId = await pickChatIdForConnector(
    api,
    clientContactId,
    connectorContains,
  );
  if (chatId <= 0) return { action: "skip", reason: "no_openlines_chat" };

  const sent = await api.call("imopenlines.bot.session.message.send", {
    CHAT_ID: chatId,
    NAME: "DEFAULT",
    MESSAGE: message,
  });
  if (!sent) return { action: "error", reason: "send_failed" };

  await appendReminderSentComment(
    api,
    dealId,
    `🔔 Напоминание о консультации (${formatConsultationTime(dealConsultationAt)} МСК) отправлено клиенту в чат — ${formatMoscowDateTime()}`,
  );

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
async function resyncFromRest(
  api: BitrixApi,
  redis: RedisClient,
): Promise<void> {
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
  redis: RedisClient,
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
      result.details.push({
        dealId,
        action: outcome.action,
        reason: outcome.reason,
      });
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
