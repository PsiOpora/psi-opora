import { createRedisClient } from "@psi-opora/bot-core";

export interface OutboundMessage {
  memberId: string;
  openLineId: string;
  /** Коннектор конкретного номера — на одной openLineId может быть
   * несколько номеров, каждый со своей очередью (см. outboxKey). */
  connectorId: string;
  /** Уникальный ID задачи — по нему дашборд опрашивает результат (см.
   * setSendResult/getSendResult) при отправке «первого» сообщения по
   * телефону. Для ответов оператора (apps/bitrix-webhook) результат никто
   * не читает, но jobId всё равно генерируется — просто для единообразия. */
  jobId: string;
  /** Известен для ответа на уже идущий диалог (см. apps/bitrix-webhook), либо
   * когда в CRM найден готовый числовой Telegram ID контакта — воркер
   * передаёт его в клиент как есть, без резолва. */
  telegramUserId?: number;
  /** Известен, когда это первое сообщение клиенту, который ещё не писал
   * (см. widget-message/send.ts) — воркер сам резолвит номер в Telegram-ID
   * через client.resolvePhoneNumber перед отправкой. */
  phone?: string;
  /** Альтернатива phone, когда у контакта в CRM нет телефона, но есть
   * Telegram-username — резолвится через client.resolvePeer/resolveUsername
   * (см. resolveClientUsername в relay.ts). */
  telegramUsername?: string;
  text: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
  /** Канонический Telegram user ID после резолва телефона/username.
   * Нужен API, чтобы связать будущие входящие сообщения (они приходят уже
   * по числовому ID, а не по телефону первого исходящего сообщения) с тем
   * же CRM-контактом. */
  telegramUserId?: string;
}

function outboxKey(
  memberId: string,
  openLineId: string,
  connectorId: string,
): string {
  return `tg-userbot:outbox:${memberId}:${openLineId}:${connectorId}`;
}

function sendResultKey(jobId: string): string {
  return `tg-userbot:send-result:${jobId}`;
}

const SEND_RESULT_TTL_SECONDS = 60;

/**
 * Очередь исходящих сообщений (ответ оператора → клиенту, либо первое
 * сообщение по номеру телефона): продюсер — apps/bitrix-webhook и
 * packages/api/src/routers/widget-message (стейтлес, не держат живой
 * MTProto-клиент), консьюмер — apps/tg-userbot-worker (always-on процесс
 * с живым клиентом на каждый подключённый номер).
 */
export async function pushOutboundMessage(
  message: OutboundMessage,
): Promise<void> {
  const redis = createRedisClient();
  await redis.rpush(
    outboxKey(message.memberId, message.openLineId, message.connectorId),
    JSON.stringify(message),
  );
}

/** Забирает все накопившиеся сообщения для конкретного номера (неблокирующе). */
export async function drainOutboundMessages(
  memberId: string,
  openLineId: string,
  connectorId: string,
): Promise<OutboundMessage[]> {
  const redis = createRedisClient();
  const key = outboxKey(memberId, openLineId, connectorId);
  const messages: OutboundMessage[] = [];
  for (;;) {
    const raw = await redis.lpop<string>(key);
    if (!raw) break;
    messages.push(
      typeof raw === "string" ? JSON.parse(raw) : (raw as OutboundMessage),
    );
  }
  return messages;
}

/** Воркер пишет сюда результат обработки задачи (успех/ошибка резолва или
 * отправки) — короткий TTL, читает только тот, кто изначально её поставил. */
export async function setSendResult(
  jobId: string,
  result: SendResult,
): Promise<void> {
  const redis = createRedisClient();
  await redis.set(sendResultKey(jobId), result, {
    ex: SEND_RESULT_TTL_SECONDS,
  });
}

export async function getSendResult(jobId: string): Promise<SendResult | null> {
  const redis = createRedisClient();
  return (await redis.get<SendResult>(sendResultKey(jobId))) ?? null;
}
