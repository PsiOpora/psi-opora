import { MemoryStorage } from "@mtcute/core";
import { TelegramClient } from "@mtcute/node";
import type { Message } from "@mtcute/node";
import { env } from "@psi-opora/config";

/**
 * Используется воркером (Фаза 2, apps/tg-userbot-worker) — держит живой
 * MTProto-клиент личного аккаунта для приёма/отправки сообщений. В отличие
 * от login.ts (одноразовые короткие подключения на каждый шаг логина),
 * этот клиент остаётся подключённым постоянно (см. план — always-on
 * процесс, не serverless).
 */
export function createUserbotClient(session: string): TelegramClient {
  const apiId = env.TG_USERBOT_API_ID;
  const apiHash = env.TG_USERBOT_API_HASH;
  if (!apiId || !apiHash) {
    throw new Error(
      "TG_USERBOT_API_ID/TG_USERBOT_API_HASH не заданы (получить на my.telegram.org/apps)",
    );
  }
  const tg = new TelegramClient({ apiId, apiHash, storage: new MemoryStorage() });
  return tg;
}

/**
 * Подписка на входящие личные сообщения. Точное имя события/сигнатура —
 * сверить с типами @mtcute/node при реализации Фазы 2 (воркер ещё не
 * подключён к реальному Bitrix24-порталу, чтобы протестировать вживую).
 */
export function listenForMessages(
  client: TelegramClient,
  onMessage: (message: Message) => void | Promise<void>,
): void {
  client.onNewMessage.add((message) => {
    if (message.isOutgoing) return;
    void onMessage(message);
  });
}

export async function sendUserbotMessage(
  client: TelegramClient,
  telegramUserId: number,
  text: string,
): Promise<void> {
  await client.sendText(telegramUserId, text);
}
