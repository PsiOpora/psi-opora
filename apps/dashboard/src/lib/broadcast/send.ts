import type { Messenger } from "@psi-opora/jobs";
import type { BitrixApi } from "@/lib/bitrix/client";

export type BroadcastChannel = "auto" | "telegram" | "max";
export type { Messenger };

export interface BroadcastRecipient {
  contactId: string;
  contactName: string;
  dealId: string;
  dealTitle: string;
  messenger: Messenger | null;
  /** ID пользователя в мессенджере: из поля IM или UF-полей интеграций. */
  userId: string | null;
  status: "pending" | "sent" | "skipped" | "error";
  error?: string;
}

export interface BroadcastReport {
  totalDeals: number;
  recipients: BroadcastRecipient[];
  sent: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
}

interface RawDeal {
  ID: string;
  TITLE: string;
  CONTACT_ID: string | null;
}

interface RawContactIm {
  VALUE: string;
  VALUE_TYPE: string;
}

interface RawContact {
  ID: string;
  NAME?: string;
  LAST_NAME?: string;
  IM?: RawContactIm[];
  /** UF-поля интеграций (Wazzup и др.): TelegramId_WZ, TelegramUsername_WZ… */
  [ufCode: string]: unknown;
}

/** Коды UF-полей контакта, в которых интеграции хранят данные мессенджеров. */
export interface MessengerFieldCodes {
  telegram: string[];
  max: string[];
}

/**
 * Находит среди всех полей контакта кастомные поля с данными Telegram/MAX —
 * по коду и подписи поля (например, UF_CRM_TELEGRAMID_WZ / «TelegramId_WZ»
 * от Wazzup). Названия полей у интеграций различаются, поэтому ищем по
 * шаблону, а не по фиксированному списку.
 */
export async function discoverMessengerFields(
  api: BitrixApi,
): Promise<MessengerFieldCodes> {
  const defs = await api.call<Record<string, Record<string, unknown>>>(
    "crm.contact.fields",
    {},
  );
  const telegram: string[] = [];
  const max: string[] = [];

  for (const [code, def] of Object.entries(defs)) {
    if (!code.startsWith("UF_")) continue;
    const haystack = [
      code,
      def.title,
      def.listLabel,
      def.formLabel,
      def.editFormLabel,
      def.filterLabel,
    ]
      .filter((v): v is string => typeof v === "string")
      .join(" ");

    if (/telegram|телеграм/i.test(haystack)) {
      telegram.push(code);
    } else if (/max/i.test(haystack) && /\bid\b|id_|_id|id$/i.test(haystack)) {
      max.push(code);
    }
  }

  return { telegram, max };
}

/** Все непустые строковые значения контакта по списку кодов полей. */
function fieldValues(contact: RawContact, codes: string[]): string[] {
  const out: string[] = [];
  for (const code of codes) {
    const raw = contact[code];
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (typeof value === "string" && value.trim()) out.push(value.trim());
      else if (typeof value === "number") out.push(String(value));
    }
  }
  return out;
}

function imValues(contact: RawContact, messenger: Messenger): string[] {
  return (contact.IM ?? [])
    .filter((im) => im.VALUE_TYPE?.toLowerCase() === messenger && im.VALUE)
    .map((im) => im.VALUE.trim());
}

interface TelegramData {
  userId?: string;
  username?: string;
}

/**
 * Telegram-данные контакта: сначала поле IM (пишут наши боты), затем
 * UF-поля интеграций. Числовое значение — ID (боту нужен именно он),
 * нечисловое — username: по нему Bot API отправить не может.
 */
function findTelegram(
  contact: RawContact,
  ufCodes: string[],
): TelegramData | null {
  const candidates = [...imValues(contact, "telegram"), ...fieldValues(contact, ufCodes)];
  let username: string | undefined;
  for (const value of candidates) {
    if (/^\d+$/.test(value)) return { userId: value };
    const cleaned = value.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
    if (!username && cleaned) username = cleaned;
  }
  return username ? { username } : null;
}

/** MAX-данные: IM-поле от нашего бота, затем UF-поля. Нужен числовой ID. */
function findMaxId(contact: RawContact, ufCodes: string[]): string | null {
  const candidates = [...imValues(contact, "max"), ...fieldValues(contact, ufCodes)];
  return candidates.find((value) => /^\d+$/.test(value)) ?? null;
}

type ResolvedMessenger =
  | { messenger: Messenger; userId: string; reason?: undefined }
  | { messenger: null; userId: null; reason: string };

const NO_MESSENGER_REASON = "нет Telegram/MAX в контакте";

function resolveMessenger(
  contact: RawContact,
  channel: BroadcastChannel,
  fields: MessengerFieldCodes,
): ResolvedMessenger {
  const telegram =
    channel !== "max" ? findTelegram(contact, fields.telegram) : null;
  const maxId = channel !== "telegram" ? findMaxId(contact, fields.max) : null;

  if (telegram?.userId) {
    return { messenger: "telegram", userId: telegram.userId };
  }
  if (maxId) return { messenger: "max", userId: maxId };
  if (telegram?.username) {
    return {
      messenger: null,
      userId: null,
      reason: `в Telegram только username (@${telegram.username}) — боту для отправки нужен числовой ID`,
    };
  }
  return { messenger: null, userId: null, reason: NO_MESSENGER_REASON };
}

/**
 * Собирает получателей рассылки по сделкам выбранной стадии: у каждой сделки
 * берётся привязанный контакт, у контакта — мессенджер из поля IM
 * (VALUE_TYPE "telegram"/"max", записывается ботами) или из UF-полей
 * интеграций (TelegramId_WZ и т.п. — находятся динамически по всем полям).
 * Контакт получает не больше одного сообщения, даже если сделок несколько.
 */
export async function collectRecipients(
  api: BitrixApi,
  stageId: string,
  channel: BroadcastChannel,
): Promise<{ totalDeals: number; recipients: BroadcastRecipient[] }> {
  const [deals, messengerFields] = await Promise.all([
    api.list<RawDeal>("crm.deal.list", {
      select: ["ID", "TITLE", "CONTACT_ID"],
      filter: { STAGE_ID: stageId },
      order: { ID: "ASC" },
    }),
    discoverMessengerFields(api),
  ]);

  const contactIds = [
    ...new Set(deals.map((d) => d.CONTACT_ID).filter(Boolean)),
  ] as string[];

  const contacts = contactIds.length
    ? await api.list<RawContact>("crm.contact.list", {
        select: [
          "ID",
          "NAME",
          "LAST_NAME",
          "IM",
          ...messengerFields.telegram,
          ...messengerFields.max,
        ],
        filter: { "@ID": contactIds },
      })
    : [];
  const contactById = new Map(contacts.map((c) => [c.ID, c]));

  const recipients: BroadcastRecipient[] = [];
  const seenContacts = new Set<string>();

  for (const deal of deals) {
    if (!deal.CONTACT_ID || seenContacts.has(deal.CONTACT_ID)) continue;
    seenContacts.add(deal.CONTACT_ID);

    const contact = contactById.get(deal.CONTACT_ID);
    if (!contact) continue;

    const resolved = resolveMessenger(contact, channel, messengerFields);
    recipients.push({
      contactId: contact.ID,
      contactName:
        [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ") ||
        `Контакт #${contact.ID}`,
      dealId: deal.ID,
      dealTitle: deal.TITLE,
      messenger: resolved.messenger,
      userId: resolved.userId,
      status: resolved.messenger ? "pending" : "skipped",
      ...(resolved.reason ? { error: resolved.reason } : {}),
    });
  }

  return { totalDeals: deals.length, recipients };
}

/**
 * Доставка сообщения собранным получателям: мутирует status/error каждого.
 * Ошибка отправки одному получателю не прерывает рассылку остальным.
 */
export async function deliverToRecipients(
  recipients: BroadcastRecipient[],
  message: string,
): Promise<void> {
  for (const recipient of recipients) {
    if (
      recipient.status !== "pending" ||
      !recipient.userId ||
      !recipient.messenger
    ) {
      continue;
    }
    try {
      await sendMessengerMessage(recipient.messenger, recipient.userId, message);
      recipient.status = "sent";
    } catch (err) {
      recipient.status = "error";
      recipient.error = (err as Error).message;
    }
    await sleep(SEND_DELAY_MS);
  }
}

export function buildReport(
  totalDeals: number,
  recipients: BroadcastRecipient[],
  dryRun: boolean,
): BroadcastReport {
  return {
    totalDeals,
    recipients,
    sent: recipients.filter((r) => r.status === "sent").length,
    skipped: recipients.filter((r) => r.status === "skipped").length,
    failed: recipients.filter((r) => r.status === "error").length,
    dryRun,
  };
}

/** Пауза между отправками при досылке — та же, что и в основной рассылке. */
export const sendDelay = (): Promise<void> => sleep(SEND_DELAY_MS);
