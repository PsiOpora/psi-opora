import { env } from "@psi-opora/config";

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
        /** Число для ботов/личного Telegram, строка-jid для WhatsApp. */
        chat_id?: number | string;
        user_id?: number;
      };
      session?: {
        id?: number;
      };
      chat?: {
        /** Число для ботов/личного Telegram, строка-jid для WhatsApp. */
        id?: number | string;
      };
      user?: {
        id?: number;
      };
      message?: {
        text?: string;
        /** Bitrix-ID пользователя, от имени которого отправлено сообщение
         * (оператор Открытой линии). */
        user_id?: number;
      };
    }>;
  };
}

export interface OperatorReplyMessage {
  /** ID коннектора (data.CONNECTOR) — по нему определяем мессенджер (TG/MAX)
   * или, для личного Telegram-номера, что это ответ на линию с userbot'ом. */
  connector?: string;
  /** ID линии (data.LINE) — нужен, чтобы найти нужный telegram_personal_accounts
   * (у бота линия одна, фиксирована в env, а у личных номеров — своя на каждый). */
  lineId?: number;
  /** ID чата во внешней системе — тот же chat.id, что мы передавали в
   * imconnector.send.messages: число (Telegram/MAX) или строка-jid (WhatsApp). */
  chatId: number | string;
  text: string;
  /** Bitrix-ID оператора, отправившего ответ (data.DATA[].message.user_id) —
   * для журналирования в bot_messages/назначения ответственного, см.
   * apps/bitrix-webhook. Может отсутствовать в старых версиях события. */
  operatorUserId?: number;
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

  return {
    connector: payload.data?.CONNECTOR,
    lineId: payload.data?.LINE ?? item?.connector?.line_id,
    chatId,
    text,
    operatorUserId: item?.message?.user_id,
  };
}

export interface ConnectorDisabledInfo {
  connector?: string;
  lineId?: number;
}

/**
 * Разбирает события ONIMCONNECTORSTATUSDELETE (администратор отключил канал
 * на линии) и ONIMCONNECTORLINEDELETE (линию удалили целиком) — в обоих
 * случаях коннектор/линия из bot_connectors больше не рабочие, запись нужно
 * удалить, иначе бот продолжит слать сообщения в неактивную линию.
 *
 * Точный состав полей payload для этих двух событий не проверялся на живом
 * портале (см. общий разбор data.CONNECTOR/data.LINE, который уже
 * подтверждён для ONIMCONNECTORMESSAGEADD) — при первом реальном срабатывании
 * стоит свериться с логом ниже.
 */
export function getConnectorDisabledInfo(
  payload: BitrixWebhookPayload,
): ConnectorDisabledInfo | null {
  const event = payload.event?.toUpperCase();
  if (event !== "ONIMCONNECTORSTATUSDELETE" && event !== "ONIMCONNECTORLINEDELETE") {
    return null;
  }
  return {
    connector: payload.data?.CONNECTOR,
    lineId: payload.data?.LINE,
  };
}

export function bitrixWebhookHandler(options?: {
  token?: string;
  /** Вызывается, когда во входящем событии — ответ оператора Открытой линии. */
  onOperatorReply?: (reply: OperatorReplyMessage) => void | Promise<void>;
  /** Вызывается, когда канал отключили от линии или линию удалили —
   * см. getConnectorDisabledInfo. */
  onConnectorDisabled?: (
    info: ConnectorDisabledInfo,
  ) => void | Promise<void>;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return new Response("ok");
    }

    const webhookToken = options?.token ?? env.BITRIX_WEBHOOK_TOKEN;
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

    const reply = getOperatorReplyMessage(payload);
    if (reply && options?.onOperatorReply) {
      await options.onOperatorReply(reply);
    } else if (
      !reply &&
      payload.event?.toUpperCase() === "ONIMCONNECTORMESSAGEADD"
    ) {
      // Событие распознано, но chatId/text не удалось извлечь (например,
      // оператор отправил вложение без текста) — раньше это падало молча,
      // без единой строки в логах, и разобрать причину пропажи ответа
      // оператора было невозможно.
      console.warn(
        `[bitrix-webhook] ONIMCONNECTORMESSAGEADD без chatId/text, payload:`,
        JSON.stringify(payload),
      );
    }

    const disabled = getConnectorDisabledInfo(payload);
    if (disabled) {
      console.log(
        `[bitrix-webhook] событие ${payload.event}, payload:`,
        JSON.stringify(payload),
      );
      if (options?.onConnectorDisabled) {
        await options.onConnectorDisabled(disabled);
      }
    }

    return new Response("ok");
  };
}
