import type { BitrixApi } from "@psi-opora/bitrix-client";

/**
 * Общие константы и хелперы для напоминаний о консультации и диагностике
 * (см. consultation-reminders.ts и diagnostic-reminders.ts). Портал
 * psi-opora.bitrix24.ru: воронка и стадии сделки, на которых отслеживаем
 * даты встреч (см. старый Bitrix-модуль
 * calls_consultation_reminders/config/app_config.php).
 */
export const DEAL_CATEGORY_ID = 0;
export const DEAL_STAGE_IDS = ["EXECUTING", "UC_WWIO8W"];
export const MESSENGER_FIELD = "UF_CRM_1779643796551";

// Значения поля "Мессенджер" → подстрока CONNECTOR_ID чата Открытой линии.
// "326" (MAX) подтверждён реальным ответом imopenlines.crm.chat.get
// (CONNECTOR_ID: "max", без префикса "wz_" — старое значение никогда не
// совпадало). "328" (Telegram) пока не перепроверен вживую — если
// напоминания в Telegram не долетают, см. no_openlines_chat в логах и
// свериться с реальным CONNECTOR_ID через imopenlines.crm.chat.get.
export const MESSENGER_CONNECTOR_MAP: Record<string, string> = {
  "326": "max",
  "328": "telegram",
};

/** Нормализует дату из поля сделки к ISO-строке; Bitrix отдаёт datetime уже со смещением. */
export function normalizeConsultationDt(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

export function toTimestamp(iso: string): number {
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

/** Время встречи по Москве для подстановки в шаблон напоминания, напр. "11:00". */
export function formatConsultationTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function renderReminderMessage(
  template: string,
  vars: { name: string; time: string },
): string {
  return template
    .replaceAll("{name}", vars.name)
    .replaceAll("{time}", vars.time);
}

/** Дата и время по Москве для комментария в таймлайне сделки, напр. "23.07.2026, 14:05". */
export function formatMoscowDateTime(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

/**
 * Отмечает в таймлайне сделки, что напоминание реально ушло клиенту —
 * иначе по одной сделке не видно, сработал ли крон, до какого чата
 * достучался и когда. Ошибки не пробрасываются: отсутствие комментария
 * не должно считаться сбоем отправки самого напоминания.
 */
export async function appendReminderSentComment(
  api: BitrixApi,
  dealId: number,
  comment: string,
): Promise<void> {
  try {
    await api.call("crm.timeline.comment.add", {
      fields: {
        ENTITY_ID: dealId,
        ENTITY_TYPE: "deal",
        COMMENT: comment,
      },
    });
  } catch (err) {
    console.error(
      `[reminder] не удалось добавить комментарий к сделке ${dealId}: ${(err as Error).message}`,
    );
  }
}

export function extractClientContactId(deal: Record<string, unknown>): number {
  const contactId = Number(deal.CONTACT_ID ?? 0);
  if (contactId > 0) return contactId;

  const ids = deal.CONTACT_IDS;
  if (Array.isArray(ids) && ids.length > 0) {
    const first = Number(ids[0] ?? 0);
    return first > 0 ? first : 0;
  }
  return 0;
}

interface OpenLinesChat {
  CHAT_ID?: string | number;
  CONNECTOR_ID?: string;
}

/**
 * Поле IM у контакта Bitrix24 синхронизируется Открытыми линиями: для
 * клиента, писавшего через коннектор, там появляется запись вида
 * VALUE_TYPE="IMOL|TELEGRAM" / "IMOL|MAX" — надёжнее поля "Мессенджер" в
 * сделке, которое менеджер мог не проставить руками.
 */
export function connectorFromContactIm(
  contact: { IM?: Array<{ VALUE?: string; VALUE_TYPE?: string }> } | false,
): string | undefined {
  return (contact ? contact.IM ?? [] : [])
    .map((entry) => String(entry.VALUE_TYPE ?? ""))
    .filter((type) => type.startsWith("IMOL|"))
    .map((type) => type.slice("IMOL|".length).toLowerCase())[0];
}

export async function pickChatIdForConnector(
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
