import {
  insertBotMessage,
  listTelegramPersonalAccounts,
  listWhatsappPersonalAccounts,
} from "@psi-opora/db/queries";
import { sendMessengerMessage } from "@psi-opora/jobs";
import { wahaSendText } from "@psi-opora/waha";
import { publicProcedure } from "../../orpc";
import { sendClientMessageSchema } from "../../schemas/messages";
import { sendViaPersonalNumber } from "../widget-message/helpers";

/**
 * Отправляет через личный номер Telegram — userId диалога здесь тот же
 * численный chat/sender id, что и в bot_messages для этого канала (см.
 * apps/tg-userbot-worker logInboundMessage и apps/bitrix-webhook
 * logOperatorReply, где userId = String(chatId)), а не телефон — поэтому
 * адресуем как kind: "id", в отличие от вкладки CRM (widget-message/send.ts),
 * где телефон известен из карточки контакта и это kind: "phone".
 */
async function sendTelegramPersonal(
  memberId: string | null,
  userId: string,
  lineId: string | undefined,
  text: string,
): Promise<{ ok?: true; error?: string }> {
  if (!memberId) {
    return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
  }
  let openLineId = lineId;
  if (!openLineId) {
    const accounts = (await listTelegramPersonalAccounts(memberId)).filter(
      (a) => a.status === "connected",
    );
    if (accounts.length === 0) {
      return { error: "Личный номер Telegram не подключён" };
    }
    if (accounts.length > 1) {
      return {
        error:
          "На портале несколько личных номеров Telegram — отправка из единого инбокса пока поддерживает один",
      };
    }
    const account = accounts[0];
    if (!account) return { error: "Личный номер Telegram не подключён" };
    openLineId = account.openLineId;
  }

  return sendViaPersonalNumber({
    memberId,
    openLineId,
    target: { kind: "id", value: userId },
    text,
  });
}

/**
 * Отправляет через личный номер WhatsApp — userId диалога это jid
 * (`"79991234567@c.us"`, см. packages/waha phoneFromJid/jidFromPhone),
 * WAHA отправляет по нему напрямую, без отдельного шага резолва пира.
 */
async function sendWhatsappPersonal(
  memberId: string | null,
  userId: string,
  lineId: string | undefined,
  text: string,
): Promise<{ ok?: true; error?: string; externalId?: string }> {
  if (!memberId) {
    return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
  }
  const accounts = (await listWhatsappPersonalAccounts(memberId)).filter(
    (a) => a.status === "connected",
  );
  const account = lineId
    ? accounts.find((a) => a.openLineId === lineId)
    : accounts[0];
  if (!account) return { error: "Личный номер WhatsApp не подключён" };
  if (!lineId && accounts.length > 1) {
    return {
      error:
        "На портале несколько личных номеров WhatsApp — отправка из единого инбокса пока поддерживает один",
    };
  }

  try {
    const { id } = await wahaSendText(account.sessionName, userId, text);
    return { ok: true, externalId: id };
  } catch (err) {
    return { error: `Не отправлено: ${(err as Error).message}` };
  }
}

/**
 * Отправляет сообщение клиенту из единого инбокса («Клиенты»). В отличие от
 * вкладки CRM (widget-message/send.ts) канал уже надёжно известен — это тот
 * же messenger/userId, что и у выбранной строки списка (bot_users), поход в
 * CRM за резолвингом контакта не нужен. Комментарий в таймлайн CRM тоже не
 * пишем — здесь нет известного contactId, а история и так видна в инбоксе.
 */
export const send = publicProcedure
  .input(sendClientMessageSchema)
  .handler(
    async ({ input, context }): Promise<{ ok?: true; error?: string }> => {
      const text = input.text.trim();
      if (!text) return { error: "Введите текст сообщения" };

      let externalId: string | undefined;

      if (input.messenger === "telegram-personal") {
        const result = await sendTelegramPersonal(
          context.memberId,
          input.userId,
          input.lineId,
          text,
        );
        if (result.error) return result;
      } else if (input.messenger === "whatsapp-personal") {
        const result = await sendWhatsappPersonal(
          context.memberId,
          input.userId,
          input.lineId,
          text,
        );
        if (result.error) return result;
        externalId = result.externalId;
      } else {
        try {
          await sendMessengerMessage(input.messenger, input.userId, text);
        } catch (err) {
          const error = err as Error;
          console.error(
            `[messages] ошибка отправки ${input.messenger}: ${error.message}`,
            error.cause ?? "",
          );
          return { error: `Не отправлено: ${error.message}` };
        }
      }

      try {
        await insertBotMessage({
          messenger: input.messenger,
          userId: input.userId,
          direction: "out",
          source: "widget",
          text,
          operatorId: input.operatorId,
          operatorName: input.operatorName,
          externalId,
        });
      } catch (err) {
        console.error(
          `[messages] не удалось записать сообщение в журнал: ${(err as Error).message}`,
        );
      }

      return { ok: true };
    },
  );
