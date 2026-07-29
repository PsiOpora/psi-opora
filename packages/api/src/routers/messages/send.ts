import { type BitrixApi, resolveBitrixApi } from "@psi-opora/bitrix-client";
import { mirrorOperatorMessageToOpenLine } from "@psi-opora/bot-core";
import {
  getBitrixCrmLink,
  getBotConnector,
  insertBotMessage,
  listTelegramPersonalAccounts,
  listWhatsappPersonalAccounts,
  upsertBitrixCrmLink,
} from "@psi-opora/db/queries";
import { formatMessengerError, sendMessengerMessage } from "@psi-opora/jobs";
import { wahaSendText } from "@psi-opora/waha";
import { bitrixProcedure } from "../../orpc";
import { sendClientMessageSchema } from "../../schemas/messages";
import {
  captureWhatsappPresence,
  sendViaPersonalNumber,
} from "../widget-message/helpers";
import { resolveTelegramPersonalTarget } from "./telegram-personal-target";

interface OpenLineConnectorRef {
  connectorId: string;
  openLineId: string;
}

/**
 * Отправляет через личный номер Telegram — userId диалога здесь тот же
 * численный chat/sender id, что и в bot_messages для этого канала (см.
 * apps/tg-userbot-worker logInboundMessage и apps/bitrix-webhook
 * logOperatorReply, где userId = String(chatId)), а не телефон — поэтому
 * адресуем как kind: "id", в отличие от вкладки CRM (widget-message/send.ts),
 * где телефон известен из карточки контакта и это kind: "phone".
 */
async function sendTelegramPersonal(
  api: BitrixApi | null,
  memberId: string | null,
  userId: string,
  lineId: string | undefined,
  connectorId: string | undefined,
  text: string,
): Promise<{
  ok?: true;
  error?: string;
  connector?: OpenLineConnectorRef;
  telegramUserId?: string;
}> {
  if (!memberId) {
    return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
  }
  const accounts = (await listTelegramPersonalAccounts(memberId)).filter(
    (a) => a.status === "connected",
  );

  let account: (typeof accounts)[number] | undefined;
  if (connectorId) {
    account = accounts.find((a) => a.connectorId === connectorId);
  } else {
    const matches = lineId
      ? accounts.filter((a) => a.openLineId === lineId)
      : accounts;
    if (matches.length > 1) {
      return {
        error: lineId
          ? "На этой линии несколько личных номеров Telegram — уточните, с какого отправить"
          : "На портале несколько личных номеров Telegram — отправка из единого инбокса пока поддерживает один",
      };
    }
    account = matches[0];
  }
  if (!account) return { error: "Личный номер Telegram не подключён" };

  const target = await resolveTelegramPersonalTarget(api, userId);
  const result = await sendViaPersonalNumber({
    memberId,
    openLineId: account.openLineId,
    connectorId: account.connectorId,
    target,
    text,
  });
  if (result.error) return result;
  return {
    ok: true,
    connector: {
      connectorId: account.connectorId,
      openLineId: account.openLineId,
    },
    telegramUserId: result.telegramUserId,
  };
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
  connectorId: string | undefined,
  text: string,
): Promise<{
  ok?: true;
  error?: string;
  externalId?: string;
  connector?: OpenLineConnectorRef;
}> {
  if (!memberId) {
    return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
  }
  const accounts = (await listWhatsappPersonalAccounts(memberId)).filter(
    (a) => a.status === "connected",
  );

  let account: (typeof accounts)[number] | undefined;
  if (connectorId) {
    account = accounts.find((a) => a.connectorId === connectorId);
  } else {
    const matches = lineId
      ? accounts.filter((a) => a.openLineId === lineId)
      : accounts;
    if (matches.length > 1) {
      return {
        error: lineId
          ? "На этой линии несколько личных номеров WhatsApp — уточните, с какого отправить"
          : "На портале несколько личных номеров WhatsApp — отправка из единого инбокса пока поддерживает один",
      };
    }
    account = matches[0];
  }
  if (!account) return { error: "Личный номер WhatsApp не подключён" };

  try {
    const { id } = await wahaSendText(account.sessionName, userId, text);
    await captureWhatsappPresence(account.sessionName, userId).catch((err) =>
      console.error(
        `[messages] не удалось получить WhatsApp presence ${userId}: ${(err as Error).message}`,
      ),
    );
    return {
      ok: true,
      externalId: id,
      connector: {
        connectorId: account.connectorId,
        openLineId: account.openLineId,
      },
    };
  } catch (err) {
    return { error: `Не отправлено: ${(err as Error).message}` };
  }
}

/**
 * Отправляет сообщение клиенту из единого инбокса («Клиенты»). В отличие от
 * вкладки CRM (widget-message/send.ts) канал уже надёжно известен — это тот
 * же messenger/userId, что и у выбранной строки списка (bot_users), поход в
 * CRM за резолвингом контакта не нужен. Комментарий в таймлайн CRM не пишем —
 * здесь нет известного contactId, а история и так видна в инбоксе. Но в саму
 * Открытую линию ответ дублируем (см. mirrorOperatorMessageToOpenLine ниже),
 * чтобы оператор, работающий из Открытой линии, видел и эти реплики тоже.
 */
export const send = bitrixProcedure
  .input(sendClientMessageSchema)
  .handler(
    async ({ input, context }): Promise<{ ok?: true; error?: string }> => {
      const text = input.text.trim();
      if (!text) return { error: "Введите текст сообщения" };
      // Авторство берём из подписанной Bitrix-сессии, а не из клиентского
      // payload: профиль оператора в React может ещё не успеть загрузиться.
      const operatorId = context.bitrixSession.userId;

      let externalId: string | undefined;
      let connector: OpenLineConnectorRef | undefined;
      let canonicalTelegramUserId: string | undefined;

      if (input.messenger === "telegram-personal") {
        const api = await context.getBitrixApi();
        const result = await sendTelegramPersonal(
          api,
          context.memberId,
          input.userId,
          input.lineId,
          input.connectorId,
          text,
        );
        if (result.error) return result;
        connector = result.connector;
        canonicalTelegramUserId = result.telegramUserId;

        // Если старый диалог был заведён по телефону, после успешного
        // резолва сохраняем канонический Telegram ID как второй ключ того же
        // контакта. Следующее входящее сообщение придёт уже по этому ID.
        if (
          canonicalTelegramUserId &&
          canonicalTelegramUserId !== input.userId
        ) {
          try {
            const link = await getBitrixCrmLink(
              "telegram-personal",
              input.userId,
            );
            if (link?.contactId) {
              await upsertBitrixCrmLink({
                messenger: "telegram-personal",
                userId: canonicalTelegramUserId,
                contactId: link.contactId,
              });
            }
          } catch (err) {
            console.error(
              `[messages] не удалось сохранить канонический Telegram ID: ${(err as Error).message}`,
            );
          }
        }
      } else if (input.messenger === "whatsapp-personal") {
        const result = await sendWhatsappPersonal(
          context.memberId,
          input.userId,
          input.lineId,
          input.connectorId,
          text,
        );
        if (result.error) return result;
        externalId = result.externalId;
        connector = result.connector;
      } else {
        try {
          externalId = await sendMessengerMessage(
            input.messenger,
            input.userId,
            text,
          );
        } catch (err) {
          const error = err as Error;
          console.error(
            `[messages] ошибка отправки ${input.messenger}: ${error.message}`,
            error.cause ?? "",
          );
          return {
            error: `Не отправлено: ${formatMessengerError(error.message)}`,
          };
        }
        const botConnector = await getBotConnector(input.messenger).catch(
          () => null,
        );
        if (botConnector) {
          connector = {
            connectorId: botConnector.connectorId,
            openLineId: botConnector.openLineId,
          };
        }
      }

      try {
        await insertBotMessage({
          messenger: input.messenger,
          userId: input.userId,
          direction: "out",
          source: "widget",
          text,
          operatorId,
          operatorName: input.operatorName,
          externalId,
          connectorId: connector?.connectorId,
        });
      } catch (err) {
        console.error(
          `[messages] не удалось записать сообщение в журнал: ${(err as Error).message}`,
        );
      }

      // Если диалог/коннектор известен, отражаем сообщение в Открытой линии.
      // operatorId надёжно получен из подписанной Bitrix-сессии выше.
      if (connector) {
        const api = resolveBitrixApi(context.memberId ?? undefined);
        await mirrorOperatorMessageToOpenLine(api ?? undefined, connector, {
          messenger: input.messenger,
          userId: canonicalTelegramUserId ?? input.userId,
          text,
          operatorId,
        });
      }

      return { ok: true };
    },
  );
