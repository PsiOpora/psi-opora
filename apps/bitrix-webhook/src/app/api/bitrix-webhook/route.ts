import {
  bitrixWebhookHandler,
  type OperatorReplyMessage,
} from "@psi-opora/bitrix-webhook-api";
import { env } from "@psi-opora/config";
import { sendMessengerMessage, type Messenger } from "@psi-opora/jobs";

// Совпадает с getConnectorId() в packages/bot-core/src/utils/bitrix.ts —
// по CONNECTOR из события определяем, какому боту переслать ответ оператора.
function messengerByConnector(connector: string | undefined): Messenger | null {
  if (!connector) return null;
  if (connector === (process.env.TG_BITRIX_CONNECTOR_ID ?? "psiopora_telegram_bot"))
    return "telegram";
  if (connector === (process.env.MAX_BITRIX_CONNECTOR_ID ?? "psiopora_max_bot"))
    return "max";
  return null;
}

async function relayOperatorReply(reply: OperatorReplyMessage): Promise<void> {
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
}

const handler = bitrixWebhookHandler({
  token: env.BITRIX_WEBHOOK_TOKEN,
  onOperatorReply: relayOperatorReply,
});

export async function POST(request: Request) {
  return handler(request);
}

export async function GET() {
  return Response.json({ status: "ok" });
}
