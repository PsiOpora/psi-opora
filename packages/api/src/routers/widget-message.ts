import {
  insertBotMessage,
  listBotMessages,
  listBotMessagesSince,
} from "@psi-opora/db/queries";
import { type Messenger, sendMessengerMessage } from "@psi-opora/jobs";
import type { BitrixApi } from "@psi-opora/bitrix-client";
import { publicProcedure, router } from "../orpc";
import type { RawContact } from "../broadcast-send";
import {
  discoverMessengerFields,
  findMaxId,
  findTelegram,
} from "../broadcast-send";
import {
  MESSAGE_MAX_LENGTH,
  sendWidgetMessageSchema,
  widgetPollSchema,
  widgetRecipientSchema,
} from "../schemas/broadcast";

export interface WidgetChannel {
  messenger: Messenger;
  userId: string;
}

export interface WidgetHistoryItem {
  id: string;
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

export type WidgetEntity = "deal" | "contact";

interface ResolvedContact {
  contactId: string;
  contactName: string;
  channels: WidgetChannel[];
  telegramUsername?: string;
}

/**
 * Резолвит ID контакта и его каналы (Telegram/MAX) из CRM: для сделки
 * сначала берём привязанный контакт, у контакта ищем мессенджеры в поле IM
 * (пишут наши боты) и UF-полях интеграций — та же логика, что у рассылки.
 *
 * Используется и для отображения виджета, и для отправки — так отправка
 * никогда не доверяет messenger/userId, присланным из браузера напрямую,
 * а всегда пересчитывает их из актуальных данных CRM.
 */
async function resolveContact(
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

export const widgetMessageRouter = router({
  loadRecipient: publicProcedure
    .input(widgetRecipientSchema)
    .handler(
      async ({
        input,
        context,
      }): Promise<{ recipient?: WidgetRecipient; error?: string }> => {
        if (!/^\d+$/.test(input.id)) {
          return { error: "Некорректный ID элемента CRM" };
        }

        const api = await context.getBitrixApi();
        if (!api) {
          return { error: "Нет подключения к Битрикс24 — обновите страницу" };
        }

        try {
          const { contact, error } = await resolveContact(
            api,
            input.entity,
            input.id,
          );
          if (error || !contact) return { error };

          const note =
            contact.channels.length === 0 && contact.telegramUsername
              ? `У контакта только Telegram-username (@${contact.telegramUsername}). Бот может писать лишь тем, кто сам открывал диалог с ботом — нужен числовой ID.`
              : undefined;

          return {
            recipient: {
              contactId: contact.contactId,
              contactName: contact.contactName,
              channels: contact.channels,
              history: await loadHistory(contact.channels),
              note,
            },
          };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
    ),

  /**
   * Новые сообщения диалога после `sinceIso` — для поллинга истории в открытой
   * вкладке. Как и в send, каналы не принимаются от клиента: они каждый раз
   * пересчитываются из актуальных данных CRM (resolveContact), иначе можно
   * было бы подставить чужие messenger/userId и читать чужую переписку.
   */
  poll: publicProcedure
    .input(widgetPollSchema)
    .handler(
      async ({
        input,
        context,
      }): Promise<{ messages?: WidgetHistoryItem[]; error?: string }> => {
        if (!/^\d+$/.test(input.id)) {
          return { error: "Некорректный ID элемента CRM" };
        }

        const since = new Date(input.sinceIso);
        if (Number.isNaN(since.getTime())) return { error: "Некорректная дата" };

        const api = await context.getBitrixApi();
        if (!api) {
          return { error: "Нет подключения к Битрикс24 — обновите страницу" };
        }

        try {
          const { contact, error } = await resolveContact(
            api,
            input.entity,
            input.id,
          );
          if (error || !contact) return { error };

          const perChannel = await Promise.all(
            contact.channels.map(async (channel) => {
              const rows = await listBotMessagesSince(
                channel.messenger,
                channel.userId,
                since,
              ).catch(() => []);
              return rows.map((row) => ({
                id: row.id,
                messenger: channel.messenger,
                direction:
                  row.direction === "in" ? ("in" as const) : ("out" as const),
                source: row.source,
                text: row.text,
                createdAt: row.createdAt.toISOString(),
              }));
            }),
          );

          return {
            messages: perChannel
              .flat()
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
    ),

  /**
   * Отправляет сообщение клиенту от имени бота выбранного мессенджера
   * и фиксирует его комментарием в таймлайне контакта.
   *
   * userId получателя намеренно не принимается от клиента: его значение
   * пересчитывается здесь же из актуальных данных CRM (resolveContact),
   * иначе вызывающий мог бы подставить произвольный messenger/userId
   * и разослать сообщение через бота кому угодно, минуя привязку к контакту.
   */
  send: publicProcedure
    .input(sendWidgetMessageSchema)
    .handler(
      async ({ input, context }): Promise<{ ok?: true; error?: string }> => {
        const text = input.text.trim();
        if (!text) return { error: "Введите текст сообщения" };
        if (text.length > MESSAGE_MAX_LENGTH) {
          return { error: `Сообщение длиннее ${MESSAGE_MAX_LENGTH} символов` };
        }

        const api = await context.getBitrixApi();
        if (!api) {
          return { error: "Нет подключения к Битрикс24 — обновите страницу" };
        }

        const { contact, error } = await resolveContact(
          api,
          input.entity,
          input.entityId,
        ).catch((err) => ({
          error: (err as Error).message,
          contact: undefined,
        }));
        if (error || !contact) {
          return { error: error ?? "Не удалось определить контакт" };
        }

        const channel = contact.channels.find(
          (c) => c.messenger === input.messenger,
        );
        if (!channel) {
          return { error: "У контакта нет такого канала — обновите страницу" };
        }

        try {
          await sendMessengerMessage(channel.messenger, channel.userId, text);
        } catch (err) {
          return { error: `Не отправлено: ${(err as Error).message}` };
        }

        // Журнал сообщений — история видна во вкладке при следующем открытии
        try {
          await insertBotMessage({
            messenger: channel.messenger,
            userId: channel.userId,
            direction: "out",
            source: "widget",
            text,
          });
        } catch (err) {
          const error = err as Error;
          console.error(
            `[widget] не удалось записать сообщение в журнал: ${error.message}`,
            error.cause ?? "",
            error.stack ?? "",
          );
        }

        // История переписки должна быть видна менеджеру — пишем в таймлайн.
        // Ошибка комментария не отменяет отправку, просто логируется.
        try {
          await api.call("crm.timeline.comment.add", {
            fields: {
              ENTITY_ID: Number(contact.contactId),
              ENTITY_TYPE: "contact",
              COMMENT: `🤖 Отправлено ботом (${channel.messenger === "telegram" ? "Telegram" : "MAX"}):\n${text}`,
            },
          });
        } catch (err) {
          console.error(
            `[widget] не удалось добавить комментарий в таймлайн: ${(err as Error).message}`,
          );
        }

        return { ok: true };
      },
    ),
});
