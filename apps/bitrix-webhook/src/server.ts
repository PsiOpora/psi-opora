import { createHmac, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
  bitrixWebhookHandler,
  type ConnectorDisabledInfo,
  type OperatorReplyMessage,
} from "@psi-opora/bitrix-webhook-api";
import { createUpstashRedis } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import {
  assignConversationIfUnassigned,
  getTelegramPersonalAccountByLine,
  getWhatsappPersonalAccountByLine,
  getWhatsappPersonalAccountBySession,
  insertBotMessage,
  type MessageDeliveryStatus,
  removeBotConnector,
  updateBotMessageStatus,
  upsertBotUser,
} from "@psi-opora/db/queries";
import { type Messenger, handleConsultationDealUpdate, sendMessengerMessage } from "@psi-opora/jobs";
import { pushOutboundMessage } from "@psi-opora/tg-userbot";
import { phoneFromJid, wahaAckToStatus, wahaSendText } from "@psi-opora/waha";
import { Hono } from "hono";
import { uploadWahaMedia } from "./media-storage.js";

// Совпадает с CONNECTOR_IDS в packages/api/src/routers/bot-connector/helpers.ts —
// по CONNECTOR из события определяем, какому боту переслать ответ оператора.
function messengerByConnector(connector: string | undefined): Messenger | null {
  if (!connector) return null;
  if (connector === (process.env.TG_BITRIX_CONNECTOR_ID ?? "psiopora_tg_bot"))
    return "telegram";
  if (connector === (process.env.MAX_BITRIX_CONNECTOR_ID ?? "psiopora_max_bot"))
    return "max";
  return null;
}

/**
 * Журналирует ответ оператора в bot_messages (виден в едином инбоксе
 * дашборда, apps/dashboard/src/app/(dashboard)/clients) и, если у диалога
 * ещё нет ответственного, назначает ответившего оператора — «первый
 * ответивший — ответственный», как в Wazzup. Ошибка здесь не должна
 * блокировать доставку ответа клиенту, поэтому только логируется.
 */
async function logOperatorReply(
  messenger: string,
  reply: OperatorReplyMessage,
  externalId?: string,
  status?: MessageDeliveryStatus,
): Promise<void> {
  const userId = String(reply.chatId);
  try {
    await insertBotMessage({
      messenger,
      userId,
      direction: "out",
      source: "operator",
      text: reply.text,
      operatorId:
        reply.operatorUserId !== undefined
          ? String(reply.operatorUserId)
          : undefined,
      externalId,
      status,
    });
  } catch (err) {
    console.error(
      `[bitrix-webhook] не удалось записать ответ оператора в журнал: ${(err as Error).message}`,
    );
  }

  if (reply.operatorUserId === undefined) return;
  try {
    await assignConversationIfUnassigned({
      messenger,
      userId,
      operatorId: String(reply.operatorUserId),
      operatorName: `Оператор #${reply.operatorUserId}`,
    });
  } catch (err) {
    console.error(
      `[bitrix-webhook] не удалось назначить ответственного по ответу оператора: ${(err as Error).message}`,
    );
  }
}

/**
 * Ответ оператора для личного Telegram-номера (packages/tg-userbot) не
 * шлём напрямую — этот процесс стейтлес и не держит живой MTProto-клиент.
 * Кладём в Redis-очередь (см. outbox.ts) — apps/tg-userbot-worker вычитывает
 * её и отправляет через уже подключённый клиент того самого номера.
 */
async function relayToTelegramPersonal(
  reply: OperatorReplyMessage,
): Promise<boolean> {
  const connectorId = env.TG_USERBOT_CONNECTOR_ID;
  if (reply.connector !== connectorId || !reply.lineId) return false;

  const account = await getTelegramPersonalAccountByLine(String(reply.lineId));
  if (!account) {
    console.warn(
      `[bitrix-webhook] не найден личный номер Telegram для линии ${reply.lineId}`,
    );
    return true;
  }

  await pushOutboundMessage({
    memberId: account.memberId,
    openLineId: account.openLineId,
    jobId: crypto.randomUUID(),
    telegramUserId: Number(reply.chatId),
    text: reply.text,
  });
  console.log(
    `[bitrix-webhook] ответ оператора поставлен в очередь личного номера ${account.phone} chat=${reply.chatId}`,
  );
  await logOperatorReply("telegram-personal", reply);
  return true;
}

/**
 * Ответ оператора для личного WhatsApp-номера шлём синхронно через REST
 * WAHA — в отличие от Telegram (relayToTelegramPersonal) очередь не нужна:
 * живое соединение с WhatsApp держит контейнер WAHA, а не наш процесс.
 */
async function relayToWhatsAppPersonal(
  reply: OperatorReplyMessage,
): Promise<boolean> {
  if (reply.connector !== env.WA_PERSONAL_CONNECTOR_ID || !reply.lineId) {
    return false;
  }

  const account = await getWhatsappPersonalAccountByLine(String(reply.lineId));
  if (!account) {
    console.warn(
      `[bitrix-webhook] не найден личный номер WhatsApp для линии ${reply.lineId}`,
    );
    return true;
  }

  let externalId: string | undefined;
  let status: MessageDeliveryStatus = "sent";
  try {
    const result = await wahaSendText(
      account.sessionName,
      String(reply.chatId),
      reply.text,
    );
    externalId = result.id;
    console.log(
      `[bitrix-webhook] ответ оператора отправлен с личного номера ${account.phone} chat=${reply.chatId}`,
    );
  } catch (err) {
    status = "failed";
    console.error(
      `[bitrix-webhook] не удалось отправить ответ оператора в WhatsApp: ${(err as Error).message}`,
    );
  }
  await logOperatorReply("whatsapp-personal", reply, externalId, status);
  return true;
}

/** Ответ оператора считается отправленным без ошибки только если сам
 * вызов sendMessengerMessage не бросил исключение — иначе тред в едином
 * инбоксе показывал бы галочку «отправлено» даже на упавшей отправке. */
async function relayOperatorReply(reply: OperatorReplyMessage): Promise<void> {
  if (await relayToTelegramPersonal(reply)) return;
  if (await relayToWhatsAppPersonal(reply)) return;

  const messenger = messengerByConnector(reply.connector);
  if (!messenger) {
    console.warn(
      `[bitrix-webhook] неизвестный коннектор для ответа оператора: ${reply.connector}`,
    );
    return;
  }

  let status: MessageDeliveryStatus = "sent";
  try {
    await sendMessengerMessage(messenger, String(reply.chatId), reply.text);
    console.log(
      `[bitrix-webhook] ответ оператора переслан в ${messenger} chat=${reply.chatId}`,
    );
  } catch (err) {
    status = "failed";
    console.error(
      `[bitrix-webhook] не удалось переслать ответ оператора в ${messenger}: ${(err as Error).message}`,
    );
  }

  await logOperatorReply(messenger, reply, undefined, status);
}

/**
 * Канал отключили от линии (или линию удалили) прямо в Bitrix, в обход
 * кнопки «Отключить» в дашборде — запись в bot_connectors подчищаем сами,
 * иначе бот продолжит слать сообщения в уже неактивную линию.
 * Личные номера (packages/tg-userbot) не трогаем — у них своя таблица
 * и свой процесс отключения.
 */
async function handleConnectorDisabled(
  info: ConnectorDisabledInfo,
): Promise<void> {
  const messenger = messengerByConnector(info.connector);
  if (!messenger) return;
  try {
    await removeBotConnector(messenger);
    console.log(
      `[bitrix-webhook] канал ${messenger} отключён на стороне Bitrix — запись в bot_connectors удалена`,
    );
  } catch (err) {
    console.error(
      `[bitrix-webhook] не удалось удалить bot_connectors для ${messenger}: ${(err as Error).message}`,
    );
  }
}

const bitrixHandler = bitrixWebhookHandler({
  token: env.BITRIX_WEBHOOK_TOKEN,
  onOperatorReply: relayOperatorReply,
  onConnectorDisabled: handleConnectorDisabled,
});

/**
 * Приём входящих сообщений личных номеров WhatsApp от WAHA (событие
 * `message`, настраивается per-session при создании — см.
 * packages/api/src/routers/whatsapp-personal). Аналог relayInboundMessage
 * в apps/tg-userbot-worker, но без always-on процесса: постоянное
 * соединение держит контейнер WAHA, а сюда прилетает обычный HTTP POST.
 */

interface WahaMessageEvent {
  event?: string;
  session?: string;
  payload?: {
    id?: string;
    timestamp?: number;
    from?: string;
    fromMe?: boolean;
    body?: string;
    /** В групповых чатах — jid автора сообщения. */
    participant?: string;
    _data?: { notifyName?: string; pushName?: string };
    /** Только для event === "message.ack". */
    ack?: number;
    ackName?: string;
    /** Голосовые/аудио и другие вложения — WAHA скачивает медиа сама и
     * отдаёт ссылку в вебхуке (опция downloadMedia в конфиге сессии).
     * Форма пейлоада не задокументирована жёстко — код ниже читает поля
     * защитно и просто не считает сообщение голосовым, если их нет. */
    hasMedia?: boolean;
    media?: {
      url?: string;
      mimetype?: string;
      filename?: string;
    };
  };
}

/** WAHA подписывает тело запроса HMAC-ключом сессии (sha512) — сверяем,
 * чтобы роут нельзя было накормить поддельными сообщениями. */
function verifyHmac(rawBody: string, header: string | null): boolean {
  const key = env.WAHA_WEBHOOK_SECRET;
  if (!key) return true; // секрет не настроен — работаем без проверки
  if (!header) return false;
  const expected = createHmac("sha512", key).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleWahaWebhook(request: Request): Promise<Response> {
  const rawBody = await request.text();
  if (!verifyHmac(rawBody, request.headers.get("x-webhook-hmac"))) {
    console.warn("[waha-webhook] неверная HMAC-подпись — запрос отброшен");
    return new Response("Unauthorized", { status: 401 });
  }

  let event: WahaMessageEvent;
  try {
    event = JSON.parse(rawBody) as WahaMessageEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (event.event === "message.ack") {
    const id = event.payload?.id;
    const status = id ? wahaAckToStatus(event.payload ?? {}) : null;
    if (id && status) {
      await updateBotMessageStatus(id, status).catch((err) =>
        console.error(
          `[waha-webhook] не удалось обновить статус сообщения ${id}: ${(err as Error).message}`,
        ),
      );
    }
    return Response.json({ ok: true });
  }

  if (event.event !== "message") return Response.json({ ok: true });

  const { session, payload } = event;
  const chatId = payload?.from;
  const text = payload?.body?.trim();
  const isAudio =
    Boolean(payload?.hasMedia) &&
    Boolean(payload?.media?.url) &&
    (payload?.media?.mimetype?.startsWith("audio/") ?? false);
  // fromMe: и собственные сообщения оператора (мы сами их отправили через
  // sendText — Bitrix уже показал их в чате), и сообщения владельца номера
  // с телефона — их дублировать в линию нечем идентифицировать, пропускаем.
  if (!session || !chatId || (!text && !isAudio) || payload?.fromMe) {
    return Response.json({ ok: true });
  }
  // Группы и статусы в Открытую линию не тащим: чат линии — диалог 1:1.
  if (!chatId.endsWith("@c.us")) return Response.json({ ok: true });

  const effectiveText = text || (isAudio ? "Голосовое сообщение" : "");

  const account = await getWhatsappPersonalAccountBySession(session);
  if (!account) {
    console.warn(`[waha-webhook] нет аккаунта для WAHA-сессии ${session}`);
    return Response.json({ ok: true });
  }

  const api = resolveBitrixApi(account.memberId);
  if (!api) {
    console.error(
      `[waha-webhook] нет OAuth-клиента Bitrix для портала ${account.memberId}`,
    );
    return Response.json({ ok: true });
  }

  // Телефон из jid передаём отдельно от user.id — по нему CRM-трекер Bitrix
  // привязывает существующий контакт/лид вместо создания «неопознанного»
  // (см. relayInboundMessage в apps/tg-userbot-worker — та же логика).
  const senderPhone = phoneFromJid(chatId);
  const senderName =
    payload?._data?.notifyName ??
    payload?._data?.pushName ??
    `WhatsApp ${senderPhone ?? chatId}`;

  // Голосовое/аудио — перезаливаем в наше S3, чтобы инбокс «Клиенты»
  // показывал плеер, а не просто заглушку.
  let mediaS3Key: string | undefined;
  if (isAudio && payload?.media?.url) {
    try {
      const res = await fetch(
        payload.media.url,
        env.WAHA_API_KEY
          ? { headers: { "X-Api-Key": env.WAHA_API_KEY } }
          : undefined,
      );
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const contentType =
          payload.media.mimetype ||
          res.headers.get("content-type") ||
          "audio/ogg";
        const uploaded = await uploadWahaMedia({
          bytes,
          contentType,
          messageId: payload?.id ?? `wa-personal-${Date.now()}`,
        });
        mediaS3Key = uploaded.mediaS3Key;
      }
    } catch (err) {
      console.error(
        `[waha-webhook] не удалось перезалить аудио-вложение: ${(err as Error).message}`,
      );
    }
  }

  // Журналируем в bot_messages/bot_users — без этого единый инбокс дашборда
  // (apps/clients) видел бы только реплики, отправленные из него самого, без
  // единого сообщения от клиента. Не блокирует пересылку в Открытую линию.
  try {
    await upsertBotUser({
      messenger: "whatsapp-personal",
      userId: chatId,
      name: senderName,
    });
    await insertBotMessage({
      messenger: "whatsapp-personal",
      userId: chatId,
      direction: "in",
      source: "scenario",
      text: effectiveText,
      ...(mediaS3Key
        ? {
            kind: "voice",
            mediaS3Key,
            mediaMimeType: payload?.media?.mimetype,
          }
        : {}),
    });
  } catch (err) {
    console.error(
      `[waha-webhook] не удалось записать входящее сообщение в журнал: ${(err as Error).message}`,
    );
  }

  try {
    await api.call("imconnector.send.messages", {
      CONNECTOR: account.connectorId,
      LINE: Number(account.openLineId),
      MESSAGES: [
        {
          user: {
            id: chatId,
            name: senderName,
            ...(senderPhone ? { phone: senderPhone } : {}),
            skip_phone_validate: "Y",
          },
          message: {
            id: payload?.id ?? `wa-personal-${Date.now()}`,
            date: payload?.timestamp ?? Math.floor(Date.now() / 1000),
            text: effectiveText,
            ...(isAudio && payload?.media?.url
              ? {
                  files: [
                    { url: payload.media.url, name: payload.media.filename ?? "audio" },
                  ],
                }
              : {}),
          },
          chat: { id: chatId, name: senderName },
        },
      ],
    });
  } catch (err) {
    console.error(
      `[waha-webhook] не удалось переслать сообщение в Открытую линию (${account.memberId}:${account.openLineId}): ${(err as Error).message}`,
    );
  }

  return Response.json({ ok: true });
}

/**
 * Обработчик события ONCRMDEALUPDATE (привязывается через event.bind).
 * Bitrix шлёт его как application/x-www-form-urlencoded, а не JSON.
 */
async function handleConsultationReminderDealUpdate(
  request: Request,
): Promise<Response> {
  try {
    const webhookToken = env.BITRIX_CRM_WEBHOOK_TOKEN;
    if (!webhookToken) {
      return Response.json(
        { success: false, message: "BITRIX_CRM_WEBHOOK_TOKEN не задан" },
        { status: 500 },
      );
    }

    const form = await request.formData().catch(() => null);
    if (!form) {
      return new Response("Invalid form data", { status: 400 });
    }

    if (form.get("auth[application_token]") !== webhookToken) {
      return new Response("Unauthorized", { status: 401 });
    }

    const dealId = Number(form.get("data[FIELDS][ID]") ?? 0);
    if (!dealId) {
      return Response.json({ success: false, message: "No deal id" });
    }

    const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
    if (!api) {
      return Response.json(
        { success: false, message: "Bitrix24 не подключён" },
        { status: 500 },
      );
    }

    const result = await handleConsultationDealUpdate(
      api,
      createUpstashRedis(),
      dealId,
    );
    return Response.json({ success: true, result });
  } catch (err) {
    const message =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error("[consultation-reminder] deal-update error:", err);
    return Response.json(
      {
        success: false,
        message: err instanceof Error ? err.message : String(err),
        stack: message,
      },
      { status: 500 },
    );
  }
}

const app = new Hono();

app.get("/", (c) =>
  c.text("Bitrix24 Webhook\nWebhook endpoint: POST /api/bitrix-webhook"),
);

app.get("/api/bitrix-webhook", (c) => c.json({ status: "ok" }));
app.post("/api/bitrix-webhook", (c) => bitrixHandler(c.req.raw));

app.get("/api/waha-webhook", (c) => c.json({ status: "ok" }));
app.post("/api/waha-webhook", (c) => handleWahaWebhook(c.req.raw));

app.get("/api/consultation-reminder-deal-update", (c) => c.json({ status: "ok" }));
app.post("/api/consultation-reminder-deal-update", (c) =>
  handleConsultationReminderDealUpdate(c.req.raw),
);

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[bitrix-webhook] слушает на :${info.port}`);
});

// При rollout k8s шлёт SIGTERM до SIGKILL — дожидаемся завершения активных
// запросов вместо мгновенного обрыва соединений.
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
