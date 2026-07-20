import { listBotMessages } from "@psi-opora/db/queries";
import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RawContact } from "../../broadcast-send";
import {
  findMaxId,
  findTelegram,
} from "../../broadcast-send";
import type {
  WidgetChannel,
  WidgetEntity,
  WidgetHistoryItem,
} from "./types";

export const HISTORY_LIMIT = 30;

export async function loadHistory(
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
        id: row.id,
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

export interface ResolvedContact {
  contactId: string;
  contactName: string;
  channels: WidgetChannel[];
  telegramUsername?: string;
}

/**
 * Резолвит ID контакта и его каналы (Telegram/MAX) из CRM: для сделки
 * сначала берём привязанный контакт, у контакта ищем мессенджеры только в
 * стандартном поле IM (Мессенджер). UF-поля интеграций игнорируются,
 * потому что менеджер видит и редактирует именно поле Мессенджер.
 *
 * Используется и для отображения виджета, и для отправки — так отправка
 * никогда не доверяет messenger/userId, присланным из браузера напрямую,
 * а всегда пересчитывает их из актуальных данных CRM.
 */
export async function resolveContact(
  api: BitrixApi,
  entity: WidgetEntity,
  id: string,
): Promise<{ contact?: ResolvedContact; error?: string }> {
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

  const contact = await api.call<RawContact>("crm.contact.get", {
    id: contactId,
  });
  if (!contact) return { error: "Контакт не найден" };

  console.log(
    "[widget:resolveContact] contactId=%s, IM=%s",
    contactId,
    JSON.stringify(contact.IM),
  );

  const channels: WidgetChannel[] = [];
  const telegram = findTelegram(contact, [], { includeUf: false });
  if (telegram?.userId) {
    channels.push({ messenger: "telegram", userId: telegram.userId });
  }
  const maxId = findMaxId(contact, [], { includeUf: false });
  if (maxId) channels.push({ messenger: "max", userId: maxId });

  console.log(
    "[widget:resolveContact] resolved channels=%s, telegram=%s, max=%s",
    JSON.stringify(channels),
    JSON.stringify(telegram),
    maxId ?? "null",
  );

  return {
    contact: {
      contactId,
      contactName:
        [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ") ||
        `Контакт #${contactId}`,
      channels,
      telegramUsername: telegram?.username,
    },
  };
}
