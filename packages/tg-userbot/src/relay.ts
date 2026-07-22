import { MemoryStorage, MtPeerNotFoundError, type tl } from "@mtcute/core";
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
  target: number | tl.TypeInputPeer,
  text: string,
): Promise<void> {
  await client.sendText(target, text);
}

/**
 * Резолвит номер телефона в Telegram-пира через официальный
 * `contacts.resolvePhone` (то же самое, что делает обычный клиент Telegram,
 * когда ищет человека по номеру) — так работает «написать клиенту первым»
 * (packages/api/src/routers/widget-message). Бросает читаемую ошибку, если
 * у номера нет Telegram-аккаунта либо владелец скрыл номер в настройках
 * приватности («Кто видит мой номер телефона»).
 */
export async function resolveClientPhoneNumber(
  client: TelegramClient,
  phone: string,
): Promise<tl.TypeInputPeer> {
  try {
    return await client.resolvePhoneNumber(phone);
  } catch (err) {
    if (err instanceof MtPeerNotFoundError) {
      throw new Error(
        "Клиент не найден в Telegram по этому номеру — либо у него нет Telegram, либо скрыт номер телефона в настройках приватности",
      );
    }
    throw err;
  }
}

/**
 * Резолвит username в Telegram-пира через `contacts.resolveUsername` (то же,
 * что делает поиск по @username в обычном клиенте) — альтернатива
 * resolveClientPhoneNumber, когда у контакта в CRM нет телефона, но есть
 * username (см. TelegramUsername_WZ и подобные UF-поля интеграций).
 */
export async function resolveClientUsername(
  client: TelegramClient,
  username: string,
): Promise<tl.TypeInputPeer> {
  const cleaned = username
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@/, "");
  try {
    return await client.resolvePeer(cleaned);
  } catch (err) {
    if (err instanceof MtPeerNotFoundError) {
      throw new Error(
        `Клиент не найден в Telegram по username @${cleaned}`,
      );
    }
    throw err;
  }
}
