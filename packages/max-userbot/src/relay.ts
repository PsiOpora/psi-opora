import { sessionInit, type MaxUserbotSession } from "./login";
import { MaxProtocolClient } from "./protocol/client";
import { OPCODE } from "./protocol/opcodes";

/**
 * Держит постоянное соединение личного аккаунта MAX (Фаза 2, будущий
 * apps/max-userbot-worker, по образцу packages/tg-userbot/src/relay.ts) — в
 * отличие от login.ts (одноразовые короткие подключения на каждый шаг
 * логина), реконнектится на сохранённой сессии через LOGIN (opcode 19) так
 * же, как это делают независимые рабочие клиенты Grovvik/vkmax-nodejs
 * (`loginByToken`) и nsdkinx/vkmax (`login_by_token`) — единственные
 * найденные примеры именно реконнекта по токену, а не свежего входа по SMS.
 *
 * ВНИМАНИЕ: точная раскладка полей пуш-уведомлений (NOTIF_MESSAGE и т.д.,
 * opcode 128/129/132 — см. protocol/opcodes.ts) нигде не задокументирована.
 * И PronikFire/Max-API-Guide (таблица opcode без деталей payload), и оба
 * рабочих клиента выше прокидывают такие пуши как есть, без парсинга.
 * Поля ниже (chatId/messageId/senderId/text) подобраны по аналогии со
 * связанными структурами (MSG_SEND-запрос, CHAT_HISTORY-ответ) и почти
 * наверняка потребуют правки по итогам живой проверки —
 * см. scripts/manual-relay.ts.
 */

export interface MaxIncomingMessage {
  chatId: number;
  messageId: string | null;
  senderId: number | null;
  text: string;
  /** Исходный пейлоад пуша — на случай, если разбор выше промахнулся мимо
   * реальных имён полей (см. предупреждение вверху файла). */
  raw: Record<string, unknown>;
}

export interface MaxTypingEvent {
  chatId: number | null;
  userId: number | null;
  raw: Record<string, unknown>;
}

export interface MaxPresenceEvent {
  userId: number | null;
  raw: Record<string, unknown>;
}

export interface MaxUserbotHandlers {
  onMessage?: (message: MaxIncomingMessage) => void | Promise<void>;
  onTyping?: (event: MaxTypingEvent) => void | Promise<void>;
  onPresence?: (event: MaxPresenceEvent) => void | Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function parseIncomingMessage(
  payload: Record<string, unknown>,
): MaxIncomingMessage {
  const message = asRecord(payload.message) ?? payload;
  return {
    chatId: asNumber(payload.chatId ?? message.chatId) ?? 0,
    messageId:
      typeof message.id === "string"
        ? message.id
        : typeof message.id === "number"
          ? String(message.id)
          : null,
    senderId: asNumber(message.sender ?? message.senderId ?? payload.senderId),
    text: typeof message.text === "string" ? message.text : "",
    raw: payload,
  };
}

function dispatchPush(
  opcode: number,
  payload: Record<string, unknown>,
  handlers: MaxUserbotHandlers,
): void {
  switch (opcode) {
    case OPCODE.NOTIF_MESSAGE: {
      void handlers.onMessage?.(parseIncomingMessage(payload));
      return;
    }
    case OPCODE.NOTIF_TYPING: {
      void handlers.onTyping?.({
        chatId: asNumber(payload.chatId),
        userId: asNumber(payload.userId ?? payload.senderId),
        raw: payload,
      });
      return;
    }
    case OPCODE.NOTIF_PRESENCE: {
      void handlers.onPresence?.({
        userId: asNumber(payload.userId ?? payload.contactId),
        raw: payload,
      });
      return;
    }
    default:
      return;
  }
}

/**
 * Открывает постоянное соединение и реконнектится на сохранённой сессии.
 * `sessionJson` — то, что было сохранено в БД (расшифрованный `session` из
 * MaxUserbotSession, см. login.ts).
 */
export async function createUserbotClient(
  sessionJson: string,
  handlers: MaxUserbotHandlers = {},
): Promise<MaxProtocolClient> {
  const session: MaxUserbotSession = JSON.parse(sessionJson);

  const client = new MaxProtocolClient({
    onPush: (opcode, payload) => dispatchPush(opcode, payload, handlers),
  });
  await client.connect();
  await sessionInit(client, session.deviceId);

  // Поля синхронизации по нулям/-1 — так делают оба рабочих клиента
  // (Grovvik/vkmax-nodejs, nsdkinx/vkmax) при входе по сохранённому токену;
  // здесь это не полная синхронизация истории (см. CHAT_HISTORY отдельно),
  // а обязательный набор полей запроса LOGIN.
  const loginResponse = await client.request(OPCODE.LOGIN, {
    token: session.sessionToken,
    interactive: true,
    chatsSync: 0,
    contactsSync: 0,
    presenceSync: -1,
    draftsSync: 0,
    chatsCount: 40,
  });
  if (typeof loginResponse.error === "string") {
    throw new Error(`MAX отклонил вход по сохранённой сессии: ${loginResponse.error}`);
  }

  return client;
}

export async function sendUserbotMessage(
  client: MaxProtocolClient,
  chatId: number,
  text: string,
): Promise<string> {
  const response = await client.request(OPCODE.MSG_SEND, {
    chatId,
    message: {
      text,
      cid: Date.now(),
      elements: [],
      attaches: [],
    },
    notify: true,
  });
  const message = asRecord(response.message);
  const id = message?.id;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  throw new Error(`MAX не вернул id отправленного сообщения: ${JSON.stringify(response)}`);
}

/** Отзывает сообщение личного аккаунта. `deleteForMe: false` — отзыв для
 * обеих сторон диалога (аналог revoke у Telegram), см. MSG_DELETE. */
export async function deleteUserbotMessage(
  client: MaxProtocolClient,
  chatId: number,
  externalId: string,
  deleteForMe = false,
): Promise<void> {
  await client.request(OPCODE.MSG_DELETE, {
    chatId,
    messageIds: [externalId],
    forMe: deleteForMe,
  });
}

export interface MaxContact {
  userId: number;
  raw: Record<string, unknown>;
}

/**
 * Резолвит контакта по номеру телефона (CONTACT_INFO_BY_PHONE) — аналог
 * resolveClientPhoneNumber у tg-userbot. Возвращает только userId контакта:
 * подтверждённого opcode для создания/открытия приватного чата по userId в
 * доступных разборах протокола НЕТ (CHAT_CREATE=63 в PronikFire/Max-API-Guide
 * помечен `~`, т.е. не подтверждён исходниками) — поэтому «написать первым»
 * для MAX (в отличие от Telegram) пока нельзя довести до конца через этот
 * пакет: нужен либо подтверждённый CHAT_CREATE, либо chatId уже существующего
 * диалога. Известное ограничение, см. README «Известные ограничения».
 */
export async function resolveClientPhoneNumber(
  client: MaxProtocolClient,
  phone: string,
): Promise<MaxContact> {
  const response = await client.request(OPCODE.CONTACT_INFO_BY_PHONE, { phone });
  const contact = asRecord(response.contact);
  const userId = asNumber(contact?.id ?? contact?.userId ?? contact?.contactId);
  if (!contact || userId === null) {
    throw new Error(
      `MAX не нашёл контакт по номеру ${phone}: ${JSON.stringify(response)}`,
    );
  }
  return { userId, raw: contact };
}
