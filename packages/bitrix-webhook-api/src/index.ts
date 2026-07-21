import { env } from "@psi-opora/config";

export interface BitrixChatInfo {
  chatId: number;
  operatorId: number;
  sessionId: number;
  ts: number;
}

export interface BitrixWebhookPayload {
  event: string;
  auth?: {
    application_token?: string;
  };
  data?: {
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
      message?: {
        text?: string;
      };
    }>;
  };
}

export interface OperatorReplyMessage {
  /** ID коннектора (data.CONNECTOR) — по нему определяем мессенджер (TG/MAX). */
  connector?: string;
  /** ID чата во внешней системе — тот же chat.id, что бот передавал в imconnector.send.messages. */
  chatId: number;
  text: string;
}

/**
 * Разбирает событие ONIMCONNECTORMESSAGEADD (ответ оператора в Открытой
 * линии) — возвращает данные для пересылки обратно в мессенджер, либо
 * null, если это не оно или текст/chatId отсутствуют.
 */
export function getOperatorReplyMessage(
  payload: BitrixWebhookPayload,
): OperatorReplyMessage | null {
  if (payload.event?.toUpperCase() !== "ONIMCONNECTORMESSAGEADD") return null;

  const item = payload.data?.DATA?.[0];
  const chatId = item?.chat?.id ?? item?.connector?.chat_id;
  const text = item?.message?.text?.trim();
  if (!chatId || !text) return null;

  return { connector: payload.data?.CONNECTOR, chatId, text };
}

const CHAT_KEY_PREFIX = "b24:chat:";

export interface BitrixWebhookHandlerOptions {
  redisUrl: string;
  redisToken: string;
  prefix?: string;
}

export async function handleBitrixWebhook(
  payload: BitrixWebhookPayload,
  options: BitrixWebhookHandlerOptions,
): Promise<void> {
  const { redisUrl, redisToken, prefix = CHAT_KEY_PREFIX } = options;

  const { data } = payload;

  if (!data?.DATA || data.DATA.length === 0) {
    return;
  }

  const item = data.DATA[0];
  if (!item) return;

  const chatId = item.connector?.chat_id ?? item.chat?.id;
  const userId = item.connector?.user_id ?? item.user?.id;
  const sessionId = item.session?.id;

  console.log(
    `[bitrix-webhook] event=${payload.event} chatId=${chatId} userId=${userId} sessionId=${sessionId}`,
  );

  if (!chatId) return;

  if (userId && userId > 0) {
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({ url: redisUrl, token: redisToken });
    const key = `${prefix}${userId}`;

    await redis.set(key, {
      chatId,
      operatorId: 0,
      sessionId: sessionId ?? 0,
      ts: Date.now(),
    });

    console.log(
      `[bitrix-webhook] сохранён chatId=${chatId} для userId=${userId}`,
    );
  }
}

export function bitrixWebhookHandler(options?: {
  token?: string;
  /** Вызывается, когда во входящем событии — ответ оператора Открытой линии. */
  onOperatorReply?: (reply: OperatorReplyMessage) => void | Promise<void>;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return new Response("ok");
    }

    const redisUrl = env.KV_REST_API_URL;
    const redisToken = env.KV_REST_API_TOKEN;
    const webhookToken = options?.token ?? env.BITRIX_WEBHOOK_TOKEN;

    if (!redisUrl || !redisToken) {
      console.error(
        "[bitrix-webhook] KV_REST_API_URL или KV_REST_API_TOKEN не заданы",
      );
      return new Response("Internal Server Error", { status: 500 });
    }

    if (!webhookToken) {
      console.error("[bitrix-webhook] BITRIX_WEBHOOK_TOKEN не задан");
      return new Response("Internal Server Error", { status: 500 });
    }

    let payload: BitrixWebhookPayload;
    try {
      payload = (await req.json()) as BitrixWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (payload.auth?.application_token !== webhookToken) {
      console.warn(
        `[bitrix-webhook] неверный токен: получено=${payload.auth?.application_token} ожидалось=${webhookToken}`,
      );
      return new Response("Unauthorized", { status: 401 });
    }

    await handleBitrixWebhook(payload, { redisUrl, redisToken });

    const reply = getOperatorReplyMessage(payload);
    if (reply && options?.onOperatorReply) {
      await options.onOperatorReply(reply);
    }

    return new Response("ok");
  };
}
