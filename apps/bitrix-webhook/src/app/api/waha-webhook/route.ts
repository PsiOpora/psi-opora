import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import {
  getWhatsappPersonalAccountBySession,
  insertBotMessage,
  updateBotMessageStatus,
  upsertBotUser,
} from "@psi-opora/db/queries";
import { phoneFromJid, wahaAckToStatus } from "@psi-opora/waha";

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

export async function POST(request: Request): Promise<Response> {
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
  // fromMe: и собственные сообщения оператора (мы сами их отправили через
  // sendText — Bitrix уже показал их в чате), и сообщения владельца номера
  // с телефона — их дублировать в линию нечем идентифицировать, пропускаем.
  if (!session || !chatId || !text || payload?.fromMe) {
    return Response.json({ ok: true });
  }
  // Группы и статусы в Открытую линию не тащим: чат линии — диалог 1:1.
  if (!chatId.endsWith("@c.us")) return Response.json({ ok: true });

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
      text,
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
            text,
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

export async function GET() {
  return Response.json({ status: "ok" });
}
