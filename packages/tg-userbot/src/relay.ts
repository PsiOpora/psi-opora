import { MemoryStorage } from "@mtcute/core";
import { TelegramClient } from "@mtcute/node";
import type { Message } from "@mtcute/node";
import type { TelegramApiCredentials } from "./login";

/**
 * Используется воркером (Фаза 2, apps/tg-userbot-worker) — держит живой
 * MTProto-клиент личного аккаунта для приёма/отправки сообщений. В отличие
 * от login.ts (одноразовые короткие подключения на каждый шаг логина),
 * этот клиент остаётся подключённым постоянно (см. план — always-on
 * процесс, не serverless). apiId/apiHash/session — то, что было сохранено
 * для этого номера при подключении (packages/db телеgram_personal_accounts).
 */
export async function createUserbotClient(
  session: string,
  credentials: TelegramApiCredentials,
): Promise<TelegramClient> {
  const tg = new TelegramClient({
    apiId: credentials.apiId,
    apiHash: credentials.apiHash,
    storage: new MemoryStorage(),
  });
  await tg.importSession(session);
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
