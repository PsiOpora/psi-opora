import { createUpstashRedis } from "@psi-opora/bot-core";

export interface OutboundMessage {
  memberId: string;
  openLineId: string;
  telegramUserId: number;
  text: string;
}

function outboxKey(memberId: string, openLineId: string): string {
  return `tg-userbot:outbox:${memberId}:${openLineId}`;
}

/**
 * Очередь исходящих сообщений (ответ оператора → клиенту): продюсер —
 * apps/bitrix-webhook (стейтлес, не держит живой MTProto-клиент), консьюмер —
 * apps/tg-userbot-worker (Фаза 2, always-on процесс с живым клиентом на
 * каждый подключённый номер).
 */
export async function pushOutboundMessage(
  message: OutboundMessage,
): Promise<void> {
  const redis = createUpstashRedis();
  await redis.rpush(
    outboxKey(message.memberId, message.openLineId),
    JSON.stringify(message),
  );
}

/** Забирает все накопившиеся сообщения для конкретного номера (неблокирующе). */
export async function drainOutboundMessages(
  memberId: string,
  openLineId: string,
): Promise<OutboundMessage[]> {
  const redis = createUpstashRedis();
  const key = outboxKey(memberId, openLineId);
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
