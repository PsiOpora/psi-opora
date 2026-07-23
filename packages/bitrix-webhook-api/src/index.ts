import { env } from "@psi-opora/config";

export interface BitrixWebhookPayload {
  event: string;
  auth?: {
    application_token?: string;
  };
  data?: {
    CONNECTOR?: string;
    LINE?: number;
    /** См. https://apidocs.bitrix24.ru/api-reference/imopenlines/imconnector/events/on-im-connector-message-add.html —
     * поле называется MESSAGES, не DATA (было расхождение с реальным payload). */
    MESSAGES?: Array<{
      im?: {
        chat_id?: number;
        message_id?: number;
      };
      chat?: {
        /** Число для ботов/личного Telegram, строка-jid для WhatsApp. */
        id?: number | string;
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
  /** Bitrix-ID оператора, отправившего ответ (data.MESSAGES[].message.user_id) —
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

  const item = payload.data?.MESSAGES?.[0];
  const chatId = item?.chat?.id;
  const text = item?.message?.text?.trim();
  if (!chatId || !text) return null;

  return {
    connector: payload.data?.CONNECTOR,
    lineId: payload.data?.LINE,
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

/** Токен — общий секрет с Bitrix, светить его в логах целиком нельзя. */
function redactAuthToken(payload: BitrixWebhookPayload): unknown {
  if (!payload.auth?.application_token) return payload;
  return { ...payload, auth: { ...payload.auth, application_token: "***" } };
}

/** "123" → 123, всё остальное — как есть (нужно для полей вроде data[LINE],
 * которые в form-urlencoded теле приходят строками, а по факту числа). */
function coerceNumeric(value: string): string | number {
  return /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : value;
}

function setNestedValue(
  target: Record<string, unknown>,
  path: string[],
  value: string,
): void {
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const nextIsIndex = /^\d+$/.test(path[i + 1]!);
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = nextIsIndex ? [] : {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]!] = coerceNumeric(value);
}

/**
 * Bitrix шлёт события коннектора (ONIMCONNECTORMESSAGEADD и т.д.) как
 * application/x-www-form-urlencoded с PHP-style bracket-нотацией для
 * вложенных полей (data[MESSAGES][0][im][chat_id]=...), а не как JSON —
 * пример тела запроса из документации приведён в JSON только для
 * читаемости. Раньше здесь стоял голый JSON.parse(rawBody), который падал
 * на каждом реальном событии от Bitrix (см. лог "невалидный JSON в теле
 * запроса").
 */
function parseBitrixFormBody(rawBody: string): BitrixWebhookPayload {
  const result: Record<string, unknown> = {};
  for (const [rawKey, value] of new URLSearchParams(rawBody)) {
    const segments = rawKey.match(/^[^[\]]+|\[[^[\]]*\]/g);
    if (!segments) continue;
    const path = segments.map((segment) => segment.replace(/^\[|\]$/g, ""));
    setNestedValue(result, path, value);
  }
  return result as unknown as BitrixWebhookPayload;
}

function parseBitrixWebhookBody(
  req: Request,
  rawBody: string,
): BitrixWebhookPayload {
  const contentType = req.headers.get("content-type") ?? "";
  if (
    !contentType.includes("application/x-www-form-urlencoded") &&
    (contentType.includes("application/json") || rawBody.trimStart().startsWith("{"))
  ) {
    return JSON.parse(rawBody) as BitrixWebhookPayload;
  }
  return parseBitrixFormBody(rawBody);
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

    // Лог каждого входящего POST-а до всяких проверок — иначе при обрыве
    // на токене/парсинге/маршрутизации в логах не остаётся ни следа того,
    // что Bitrix вообще стучался сюда, и непонятно, где искать причину
    // пропажи ответа оператора.
    const rawBody = await req.text();
    console.log(
      `[bitrix-webhook] входящий запрос, длина тела=${rawBody.length}`,
    );

    // Через запятую можно перечислить несколько валидных токенов: помимо
    // токена вручную настроенного «Исходящего вебхука» (Разработчикам →
    // Другое → Исходящий вебхук) сюда попадает application_token, который
    // Bitrix присваивает самому приложению дашборда и передаёт в каждом
    // событии, доставленном через event.bind (см.
    // apps/dashboard/src/lib/bitrix/connector-events.ts) — это другой токен,
    // не совпадающий с токеном исходящего вебхука.
    const webhookTokens = (options?.token ?? env.BITRIX_WEBHOOK_TOKEN ?? "")
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);
    if (webhookTokens.length === 0) {
      console.error("[bitrix-webhook] BITRIX_WEBHOOK_TOKEN не задан");
      return new Response("Internal Server Error", { status: 500 });
    }

    let payload: BitrixWebhookPayload;
    try {
      payload = parseBitrixWebhookBody(req, rawBody);
    } catch {
      console.warn(
        `[bitrix-webhook] не удалось разобрать тело запроса: ${rawBody.slice(0, 500)}`,
      );
      return new Response("Invalid body", { status: 400 });
    }

    console.log(
      `[bitrix-webhook] событие=${payload.event}, payload:`,
      JSON.stringify(redactAuthToken(payload)),
    );

    if (
      !payload.auth?.application_token ||
      !webhookTokens.includes(payload.auth.application_token)
    ) {
      console.warn(
        `[bitrix-webhook] неверный токен: получено=${payload.auth?.application_token}`,
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
        JSON.stringify(redactAuthToken(payload)),
      );
    }

    const disabled = getConnectorDisabledInfo(payload);
    if (disabled && options?.onConnectorDisabled) {
      await options.onConnectorDisabled(disabled);
    }

    return new Response("ok");
  };
}
