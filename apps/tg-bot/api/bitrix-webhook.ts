import { createUpstashRedis } from "@psi-opora/bot-core";
import { Redis } from "@upstash/redis";

export const config = { runtime: "edge" };

interface BitrixWebhookPayload {
  event: string;
  data: {
    CONNECTOR?: string;
    LINE?: number;
    DATA?: Array<{
      connector?: {
        connector_id?: string;
        line_id?: number;
        chat_id?: number;
        user_id?: number;
      };
      session?: {
        id?: number;
      };
      chat?: {
        id?: number;
      };
      user?: {
        id?: number;
      };
    }>;
  };
}

const CHAT_KEY_PREFIX = "b24:chat:";

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("KV_REST_API_URL и KV_REST_API_TOKEN не заданы");
  }
  return new Redis({ url, token });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("ok");
  }

  let payload: BitrixWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { event, data } = payload;

  if (!data.DATA || data.DATA.length === 0) {
    return new Response("ok");
  }

  const item = data.DATA[0];
  if (!item) return new Response("ok");

  const chatId = item.connector?.chat_id ?? item.chat?.id;
  const userId = item.connector?.user_id ?? item.user?.id;
  const sessionId = item.session?.id;

  console.log(
    `[bitrix-webhook] event=${event} chatId=${chatId} userId=${userId} sessionId=${sessionId}`
  );

  if (!chatId) {
    return new Response("ok");
  }

  // Сохраняем chatId и operatorId в Redis по userId из Telegram
  // KEY = b24:chat:<telegram_user_id>
  // VALUE = { chatId, operatorId, sessionId, timestamp }
  if (userId && userId > 0) {
    try {
      const redis = getRedis();
      const key = `${CHAT_KEY_PREFIX}${userId}`;
      await redis.set(key, {
        chatId,
        operatorId: 0,
        sessionId: sessionId ?? 0,
        ts: Date.now(),
      });
      console.log(`[bitrix-webhook] сохранён chatId=${chatId} для userId=${userId}`);
    } catch (err: any) {
      console.error(`[bitrix-webhook] ошибка записи в Redis: ${err.message}`);
    }
  }

  return new Response("ok");
}
