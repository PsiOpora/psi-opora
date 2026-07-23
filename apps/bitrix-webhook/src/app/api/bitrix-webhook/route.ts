import {
  bitrixWebhookHandler,
  type ConnectorDisabledInfo,
  type OperatorReplyMessage,
} from "@psi-opora/bitrix-webhook-api";
import { env } from "@psi-opora/config";
import {
  assignConversationIfUnassigned,
  getTelegramPersonalAccountByLine,
  getWhatsappPersonalAccountByLine,
  insertBotMessage,
  removeBotConnector,
} from "@psi-opora/db/queries";
import { type Messenger, sendMessengerMessage } from "@psi-opora/jobs";
import { pushOutboundMessage } from "@psi-opora/tg-userbot";
import { wahaSendText } from "@psi-opora/waha";

// Совпадает с CONNECTOR_IDS в packages/api/src/routers/bot-connector/helpers.ts —
// по CONNECTOR из события определяем, какому боту переслать ответ оператора.
function messengerByConnector(connector: string | undefined): Messenger | null {
  if (!connector) return null;
  if (connector === (process.env.TG_BITRIX_CONNECTOR_ID ?? "psiopora_tg_bot"))
    return "telegram";
  if (connector === (process.env.MAX_BITRIX_CONNECTOR_ID ?? "psiopora_max_bot"))
    return "max";
  return null;
}

/**
 * Журналирует ответ оператора в bot_messages (виден в едином инбоксе
 * дашборда, apps/dashboard/src/app/(dashboard)/clients) и, если у диалога
 * ещё нет ответственного, назначает ответившего оператора — «первый
 * ответивший — ответственный», как в Wazzup. Ошибка здесь не должна
 * блокировать доставку ответа клиенту, поэтому только логируется.
 */
async function logOperatorReply(
  messenger: string,
  reply: OperatorReplyMessage,
  externalId?: string,
): Promise<void> {
  const userId = String(reply.chatId);
  try {
    await insertBotMessage({
      messenger,
      userId,
      direction: "out",
      source: "operator",
      text: reply.text,
      operatorId:
        reply.operatorUserId !== undefined
          ? String(reply.operatorUserId)
          : undefined,
      externalId,
    });
  } catch (err) {
    console.error(
      `[bitrix-webhook] не удалось записать ответ оператора в журнал: ${(err as Error).message}`,
    );
  }

  if (reply.operatorUserId === undefined) return;
  try {
    await assignConversationIfUnassigned({
      messenger,
      userId,
      operatorId: String(reply.operatorUserId),
      operatorName: `Оператор #${reply.operatorUserId}`,
    });
  } catch (err) {
    console.error(
      `[bitrix-webhook] не удалось назначить ответственного по ответу оператора: ${(err as Error).message}`,
    );
  }
}

/**
 * Ответ оператора для личного Telegram-номера (packages/tg-userbot) не
 * шлём напрямую — этот процесс стейтлес и не держит живой MTProto-клиент.
 * Кладём в Redis-очередь (см. outbox.ts) — apps/tg-userbot-worker вычитывает
 * её и отправляет через уже подключённый клиент того самого номера.
 */
async function relayToTelegramPersonal(
  reply: OperatorReplyMessage,
): Promise<boolean> {
  const connectorId = env.TG_USERBOT_CONNECTOR_ID;
  if (reply.connector !== connectorId || !reply.lineId) return false;

  const account = await getTelegramPersonalAccountByLine(String(reply.lineId));
  if (!account) {
    console.warn(
      `[bitrix-webhook] не найден личный номер Telegram для линии ${reply.lineId}`,
    );
    return true;
  }

  await pushOutboundMessage({
    memberId: account.memberId,
    openLineId: account.openLineId,
    jobId: crypto.randomUUID(),
    telegramUserId: Number(reply.chatId),
    text: reply.text,
  });
  console.log(
    `[bitrix-webhook] ответ оператора поставлен в очередь личного номера ${account.phone} chat=${reply.chatId}`,
  );
  await logOperatorReply("telegram-personal", reply);
  return true;
}

/**
 * Ответ оператора для личного WhatsApp-номера шлём синхронно через REST
 * WAHA — в отличие от Telegram (relayToTelegramPersonal) очередь не нужна:
 * живое соединение с WhatsApp держит контейнер WAHA, а не наш процесс.
 */
async function relayToWhatsAppPersonal(
  reply: OperatorReplyMessage,
): Promise<boolean> {
  if (reply.connector !== env.WA_PERSONAL_CONNECTOR_ID || !reply.lineId) {
    return false;
  }

  const account = await getWhatsappPersonalAccountByLine(String(reply.lineId));
  if (!account) {
    console.warn(
      `[bitrix-webhook] не найден личный номер WhatsApp для линии ${reply.lineId}`,
    );
    return true;
  }

  let externalId: string | undefined;
  try {
    const result = await wahaSendText(
      account.sessionName,
      String(reply.chatId),
      reply.text,
    );
    externalId = result.id;
    console.log(
      `[bitrix-webhook] ответ оператора отправлен с личного номера ${account.phone} chat=${reply.chatId}`,
    );
  } catch (err) {
    console.error(
      `[bitrix-webhook] не удалось отправить ответ оператора в WhatsApp: ${(err as Error).message}`,
    );
  }
  await logOperatorReply("whatsapp-personal", reply, externalId);
  return true;
}

async function relayOperatorReply(reply: OperatorReplyMessage): Promise<void> {
  if (await relayToTelegramPersonal(reply)) return;
  if (await relayToWhatsAppPersonal(reply)) return;

  const messenger = messengerByConnector(reply.connector);
  if (!messenger) {
    console.warn(
      `[bitrix-webhook] неизвестный коннектор для ответа оператора: ${reply.connector}`,
    );
    return;
  }

  try {
    await sendMessengerMessage(messenger, String(reply.chatId), reply.text);
    console.log(
      `[bitrix-webhook] ответ оператора переслан в ${messenger} chat=${reply.chatId}`,
    );
  } catch (err) {
    console.error(
      `[bitrix-webhook] не удалось переслать ответ оператора в ${messenger}: ${(err as Error).message}`,
    );
  }

  await logOperatorReply(messenger, reply);
}

/**
 * Канал отключили от линии (или линию удалили) прямо в Bitrix, в обход
 * кнопки «Отключить» в дашборде — запись в bot_connectors подчищаем сами,
 * иначе бот продолжит слать сообщения в уже неактивную линию.
 * Личные номера (packages/tg-userbot) не трогаем — у них своя таблица
 * и свой процесс отключения.
 */
async function handleConnectorDisabled(
  info: ConnectorDisabledInfo,
): Promise<void> {
  const messenger = messengerByConnector(info.connector);
  if (!messenger) return;
  try {
    await removeBotConnector(messenger);
    console.log(
      `[bitrix-webhook] канал ${messenger} отключён на стороне Bitrix — запись в bot_connectors удалена`,
    );
  } catch (err) {
    console.error(
      `[bitrix-webhook] не удалось удалить bot_connectors для ${messenger}: ${(err as Error).message}`,
    );
  }
}

const handler = bitrixWebhookHandler({
  token: env.BITRIX_WEBHOOK_TOKEN,
  onOperatorReply: relayOperatorReply,
  onConnectorDisabled: handleConnectorDisabled,
});

export async function POST(request: Request) {
  return handler(request);
}

export async function GET() {
  return Response.json({ status: "ok" });
}
