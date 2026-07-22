import { insertBotMessage } from "@psi-opora/db/queries";
import { sendMessengerMessage } from "@psi-opora/jobs";
import { getSendResult, pushOutboundMessage } from "@psi-opora/tg-userbot";
import { publicProcedure } from "../../orpc";
import {
  MESSAGE_MAX_LENGTH,
  sendWidgetMessageSchema,
} from "../../schemas/broadcast";
import { resolveContact } from "./helpers";

const MESSENGER_ERROR_MESSAGES: Record<string, string> = {
  "error.dialog.notfound":
    "Диалог с клиентом в MAX не найден — возможно, он не писал боту или удалил чат",
};

function formatSendError(message: string): string {
  for (const [code, text] of Object.entries(MESSENGER_ERROR_MESSAGES)) {
    if (message.includes(code)) return text;
  }
  return message;
}

const SEND_RESULT_POLL_INTERVAL_MS = 300;
const SEND_RESULT_TIMEOUT_MS = 6000;

/**
 * Личный номер (в отличие от бота) не держит соединение в этом процессе —
 * задача уходит в очередь always-on воркера (apps/tg-userbot-worker), а
 * результат (резолв номера в Telegram + сама отправка) ждём здесь коротким
 * поллингом, чтобы вернуть внятный ответ в виджет, а не «повесить» кнопку.
 */
async function sendViaPersonalNumber(params: {
  memberId: string;
  openLineId: string;
  phone: string;
  text: string;
}): Promise<{ ok?: true; error?: string }> {
  const jobId = crypto.randomUUID();
  await pushOutboundMessage({
    memberId: params.memberId,
    openLineId: params.openLineId,
    jobId,
    phone: params.phone,
    text: params.text,
  });

  const deadline = Date.now() + SEND_RESULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await getSendResult(jobId);
    if (result) {
      return result.ok
        ? { ok: true }
        : { error: `Не отправлено: ${result.error ?? "неизвестная ошибка"}` };
    }
    await new Promise((resolve) =>
      setTimeout(resolve, SEND_RESULT_POLL_INTERVAL_MS),
    );
  }
  return {
    error:
      "Не удалось дождаться ответа от воркера личного номера — проверьте, что apps/tg-userbot-worker запущен",
  };
}

/**
 * Отправляет сообщение клиенту от имени бота выбранного мессенджера (или
 * с личного номера Telegram) и фиксирует его комментарием в таймлайне контакта.
 *
 * userId/lineId получателя намеренно не принимаются от клиента напрямую для
 * отправки — канал ищется среди пересчитанных здесь же из актуальных данных
 * CRM (resolveContact), иначе вызывающий мог бы подставить произвольные
 * значения и отправить сообщение кому угодно, минуя привязку к контакту.
 */
export const send = publicProcedure
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
        context.memberId,
      ).catch((err) => ({
        error: (err as Error).message,
        contact: undefined,
      }));
      if (error || !contact) {
        return { error: error ?? "Не удалось определить контакт" };
      }

      const channel = contact.channels.find(
        (c) =>
          c.messenger === input.messenger &&
          (input.messenger !== "telegram-personal" ||
            c.lineId === input.lineId),
      );
      if (!channel) {
        return { error: "У контакта нет такого канала — обновите страницу" };
      }

      if (channel.messenger === "telegram-personal") {
        if (!context.memberId || !channel.lineId) {
          return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
        }
        const result = await sendViaPersonalNumber({
          memberId: context.memberId,
          openLineId: channel.lineId,
          phone: channel.userId,
          text,
        });
        if (result.error) return result;
      } else {
        try {
          await sendMessengerMessage(channel.messenger, channel.userId, text);
        } catch (err) {
          const error = err as Error;
          console.error(
            `[widget] ошибка отправки ${channel.messenger}: ${error.message}`,
            error.cause ?? "",
            error.stack ?? "",
          );
          return { error: `Не отправлено: ${formatSendError(error.message)}` };
        }
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
            COMMENT: `🤖 Отправлено ботом (${channel.label}):\n${text}`,
          },
        });
      } catch (err) {
        console.error(
          `[widget] не удалось добавить комментарий в таймлайн: ${(err as Error).message}`,
        );
      }

      return { ok: true };
    },
  );
