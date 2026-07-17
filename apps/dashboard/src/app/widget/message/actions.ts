"use server";

import { insertBotMessage, listBotMessages } from "@psi-opora/db/queries";
import { type Messenger, sendMessengerMessage } from "@psi-opora/jobs";
import { getBitrixApi } from "@/lib/bitrix/session";
import {
  discoverMessengerFields,
  findMaxId,
  findTelegram,
  type RawContact,
} from "@/lib/broadcast/send";

export interface WidgetChannel {
  messenger: Messenger;
  userId: string;
}

export interface WidgetHistoryItem {
  messenger: Messenger;
  direction: "in" | "out";
  source: string;
  text: string;
  /** ISO-строка — Date не сериализуется через границу server action. */
  createdAt: string;
}

export interface WidgetRecipient {
  contactId: string;
  contactName: string;
  channels: WidgetChannel[];
  /** Последние сообщения диалога (старые выше). */
  history: WidgetHistoryItem[];
  /** Пояснение, почему отправка недоступна (например, только username). */
  note?: string;
}

const HISTORY_LIMIT = 30;

async function loadHistory(
  channels: WidgetChannel[],
): Promise<WidgetHistoryItem[]> {
  const perChannel = await Promise.all(
    channels.map(async (channel) => {
      const rows = await listBotMessages(
        channel.messenger,
        channel.userId,
        HISTORY_LIMIT,
      ).catch(() => []);
      return rows.map((row) => ({
        messenger: channel.messenger,
        direction: row.direction === "in" ? ("in" as const) : ("out" as const),
        source: row.source,
        text: row.text,
        createdAt: row.createdAt.toISOString(),
      }));
    }),
  );
  return perChannel
    .flat()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-HISTORY_LIMIT);
}

export type WidgetEntity = "deal" | "contact";

/**
 * Определяет получателя для вкладки в карточке CRM: для сделки берём
 * привязанный контакт, у контакта ищем Telegram/MAX в поле IM (пишут наши
 * боты) и UF-полях интеграций — та же логика, что у рассылки.
 */
export async function loadWidgetRecipientAction(
  entity: WidgetEntity,
  id: string,
): Promise<{ recipient?: WidgetRecipient; error?: string }> {
  if (!/^\d+$/.test(id)) return { error: "Некорректный ID элемента CRM" };

  const api = await getBitrixApi();
  if (!api) {
    return { error: "Нет подключения к Битрикс24 — обновите страницу" };
  }

  try {
    let contactId = id;
    if (entity === "deal") {
      const deal = await api.call<{ CONTACT_ID?: string | null }>(
        "crm.deal.get",
        { id },
      );
      contactId = deal?.CONTACT_ID ?? "";
      if (!contactId) {
        return { error: "У сделки нет привязанного контакта" };
      }
    }

    const [fields, contact] = await Promise.all([
      discoverMessengerFields(api),
      api.call<RawContact>("crm.contact.get", { id: contactId }),
    ]);
    if (!contact) return { error: "Контакт не найден" };

    const channels: WidgetChannel[] = [];
    const telegram = findTelegram(contact, fields.telegram);
    if (telegram?.userId) {
      channels.push({ messenger: "telegram", userId: telegram.userId });
    }
    const maxId = findMaxId(contact, fields.max);
    if (maxId) channels.push({ messenger: "max", userId: maxId });

    const note =
      channels.length === 0 && telegram?.username
        ? `У контакта только Telegram-username (@${telegram.username}). Бот может писать лишь тем, кто сам открывал диалог с ботом — нужен числовой ID.`
        : undefined;

    return {
      recipient: {
        contactId,
        contactName:
          [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ") ||
          `Контакт #${contactId}`,
        channels,
        history: await loadHistory(channels),
        note,
      },
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export interface SendWidgetMessageInput {
  messenger: Messenger;
  userId: string;
  text: string;
  contactId: string;
}

/**
 * Отправляет сообщение клиенту от имени бота выбранного мессенджера
 * и фиксирует его комментарием в таймлайне контакта.
 */
export async function sendWidgetMessageAction(
  input: SendWidgetMessageInput,
): Promise<{ ok?: true; error?: string }> {
  const text = input.text.trim();
  if (!text) return { error: "Введите текст сообщения" };
  if (input.messenger !== "telegram" && input.messenger !== "max") {
    return { error: "Неизвестный канал отправки" };
  }
  if (!/^\d+$/.test(input.userId)) {
    return { error: "Некорректный ID получателя" };
  }

  try {
    await sendMessengerMessage(input.messenger, input.userId, text);
  } catch (err) {
    return { error: `Не отправлено: ${(err as Error).message}` };
  }

  // Журнал сообщений — история видна во вкладке при следующем открытии
  try {
    await insertBotMessage({
      messenger: input.messenger,
      userId: input.userId,
      direction: "out",
      source: "widget",
      text,
    });
  } catch (err) {
    console.error(
      `[widget] не удалось записать сообщение в журнал: ${(err as Error).message}`,
    );
  }

  // История переписки должна быть видна менеджеру — пишем в таймлайн.
  // Ошибка комментария не отменяет отправку, просто логируется.
  try {
    const api = await getBitrixApi();
    await api?.call("crm.timeline.comment.add", {
      fields: {
        ENTITY_ID: Number(input.contactId),
        ENTITY_TYPE: "contact",
        COMMENT: `🤖 Отправлено ботом (${input.messenger === "telegram" ? "Telegram" : "MAX"}):\n${text}`,
      },
    });
  } catch (err) {
    console.error(
      `[widget] не удалось добавить комментарий в таймлайн: ${(err as Error).message}`,
    );
  }

  return { ok: true };
}
