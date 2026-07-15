import { env } from "@psi-opora/config";
import type { BitrixApi } from "@/lib/bitrix/client";

export type BroadcastChannel = "auto" | "telegram" | "max";
export type Messenger = "telegram" | "max";

export interface BroadcastRecipient {
  contactId: string;
  contactName: string;
  dealId: string;
  dealTitle: string;
  messenger: Messenger | null;
  /** ID пользователя в мессенджере из поля IM контакта. */
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
}

function resolveIm(
  contact: RawContact,
  channel: BroadcastChannel,
): { messenger: Messenger; userId: string } | null {
  const entries = contact.IM ?? [];
  const find = (messenger: Messenger) => {
    const entry = entries.find(
      (im) => im.VALUE_TYPE?.toLowerCase() === messenger && im.VALUE,
    );
    return entry ? { messenger, userId: entry.VALUE } : null;
  };

  if (channel === "telegram") return find("telegram");
  if (channel === "max") return find("max");
  // auto: приоритет Telegram, иначе MAX — одно сообщение на контакт
  return find("telegram") ?? find("max");
}

async function sendTelegram(userId: string, text: string): Promise<void> {
  const token = env.TG_BOT_TOKEN ?? env.BOT_TOKEN;
  if (!token) throw new Error("TG_BOT_TOKEN не задан");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: userId, text }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) {
    throw new Error(json.description ?? `Telegram HTTP ${res.status}`);
  }
}

async function sendMax(userId: string, text: string): Promise<void> {
  const token = env.MAX_BOT_TOKEN;
  if (!token) throw new Error("MAX_BOT_TOKEN не задан");

  const url = new URL("https://platform-api2.max.ru/messages");
  url.searchParams.set("user_id", userId);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(json?.message ?? `MAX HTTP ${res.status}`);
  }
}

/** Отправка одного сообщения пользователю мессенджера (используется и для теста). */
export async function sendMessengerMessage(
  messenger: Messenger,
  userId: string,
  text: string,
): Promise<void> {
  if (messenger === "telegram") await sendTelegram(userId, text);
  else await sendMax(userId, text);
}

const SEND_DELAY_MS = 100; // ~10 сообщений/сек — с запасом до лимитов Telegram

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Собирает получателей рассылки по сделкам выбранной стадии: у каждой сделки
 * берётся привязанный контакт, у контакта — мессенджер из поля IM
 * (VALUE_TYPE "telegram"/"max", записывается ботами при создании сделки).
 * Контакт получает не больше одного сообщения, даже если сделок несколько.
 */
export async function collectRecipients(
  api: BitrixApi,
  stageId: string,
  channel: BroadcastChannel,
): Promise<{ totalDeals: number; recipients: BroadcastRecipient[] }> {
  const deals = await api.list<RawDeal>("crm.deal.list", {
    select: ["ID", "TITLE", "CONTACT_ID"],
    filter: { STAGE_ID: stageId },
    order: { ID: "ASC" },
  });

  const contactIds = [
    ...new Set(deals.map((d) => d.CONTACT_ID).filter(Boolean)),
  ] as string[];

  const contacts = contactIds.length
    ? await api.list<RawContact>("crm.contact.list", {
        select: ["ID", "NAME", "LAST_NAME", "IM"],
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

    const im = resolveIm(contact, channel);
    recipients.push({
      contactId: contact.ID,
      contactName:
        [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ") ||
        `Контакт #${contact.ID}`,
      dealId: deal.ID,
      dealTitle: deal.TITLE,
      messenger: im?.messenger ?? null,
      userId: im?.userId ?? null,
      status: im ? "pending" : "skipped",
      ...(im ? {} : { error: "нет Telegram/MAX в контакте" }),
    });
  }

  return { totalDeals: deals.length, recipients };
}

/**
 * Рассылка по сделкам стадии. При dryRun только собирает получателей,
 * ничего не отправляя — для предпросмотра перед реальной отправкой.
 */
export async function runBroadcast(
  api: BitrixApi,
  options: {
    stageId: string;
    channel: BroadcastChannel;
    message: string;
    dryRun: boolean;
  },
): Promise<BroadcastReport> {
  const { totalDeals, recipients } = await collectRecipients(
    api,
    options.stageId,
    options.channel,
  );

  if (!options.dryRun) {
    for (const recipient of recipients) {
      if (
        recipient.status !== "pending" ||
        !recipient.userId ||
        !recipient.messenger
      ) {
        continue;
      }
      try {
        await sendMessengerMessage(
          recipient.messenger,
          recipient.userId,
          options.message,
        );
        recipient.status = "sent";
      } catch (err) {
        recipient.status = "error";
        recipient.error = (err as Error).message;
      }
      await sleep(SEND_DELAY_MS);
    }
  }

  return {
    totalDeals,
    recipients,
    sent: recipients.filter((r) => r.status === "sent").length,
    skipped: recipients.filter((r) => r.status === "skipped").length,
    failed: recipients.filter((r) => r.status === "error").length,
    dryRun: options.dryRun,
  };
}
