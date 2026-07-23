/**
 * REST-клиент WAHA (https://waha.devlike.pro) — self-hosted шлюз к личным
 * номерам WhatsApp (движок NOWEB = Baileys). Аналог packages/tg-userbot для
 * WhatsApp, но без собственного always-on процесса: постоянное соединение
 * держит контейнер WAHA (docker-compose, сервис `waha`), а мы ходим в него
 * обычным HTTP — поэтому и oRPC-роутеры дашборда, и serverless
 * apps/bitrix-webhook могут работать с номером синхронно, без Redis-outbox.
 *
 * Сессия WAHA = один подключённый номер. Имя сессии детерминировано
 * (waSessionName) — по нему же входящий вебхук WAHA находит аккаунт в БД.
 */
import { env } from "@psi-opora/config";

export class WahaError extends Error {}

function wahaUrl(path: string): string {
  const base = env.WAHA_URL;
  if (!base)
    throw new WahaError("WAHA_URL не задан — контейнер WAHA не настроен");
  return `${base.replace(/\/+$/, "")}${path}`;
}

async function wahaFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(wahaUrl(path), {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(env.WAHA_API_KEY ? { "X-Api-Key": env.WAHA_API_KEY } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new WahaError(
      `WAHA ${init?.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  // Некоторые эндпоинты (logout/delete) отвечают пустым телом.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Детерминированное имя сессии WAHA для линии портала — без промежуточного
 * состояния в Redis: виджет логина и вебхук входящих находят друг друга по
 * одному и тому же имени. Символы за пределами [a-zA-Z0-9_] заменяются,
 * чтобы имя было безопасно и в URL, и в файловом сторадже WAHA.
 */
export function waSessionName(memberId: string, lineId: string): string {
  return `wa_${memberId}_${lineId}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

export type WahaSessionStatus =
  | "STOPPED"
  | "STARTING"
  | "SCAN_QR_CODE"
  | "WORKING"
  | "FAILED"
  | (string & {});

export interface WahaSession {
  name: string;
  status: WahaSessionStatus;
  me?: { id?: string; pushName?: string } | null;
}

/**
 * Создаёт (или пересоздаёт) сессию и сразу стартует её. Вебхук входящих
 * сообщений конфигурируется здесь же, per-session — глобальные env-вебхуки
 * WAHA не используем, чтобы URL/секрет жили в одном месте с нашим кодом.
 */
export async function wahaCreateSession(
  session: string,
  webhook?: { url: string; hmacKey?: string },
): Promise<WahaSession> {
  // Идемпотентность повторного входа: если сессия уже есть (прошлая
  // незавершённая попытка или переподключение номера) — сносим целиком,
  // чтобы получить чистый логин, а не FAILED-состояние старой авторизации.
  await wahaDeleteSession(session).catch(() => {});
  return wahaFetch<WahaSession>("/api/sessions", {
    method: "POST",
    body: {
      name: session,
      start: true,
      config: {
        ...(webhook
          ? {
              webhooks: [
                {
                  url: webhook.url,
                  events: ["message"],
                  ...(webhook.hmacKey
                    ? { hmac: { key: webhook.hmacKey } }
                    : {}),
                  retries: { policy: "constant", delaySeconds: 2, attempts: 5 },
                },
              ],
            }
          : {}),
        // Статусы («сторис») в линию не тащим; группы пропускает сам
        // вебхук-обработчик — здесь фильтр не у всех движков одинаков.
        ignore: { status: true },
      },
    },
  });
}

export async function wahaGetSession(
  session: string,
): Promise<WahaSession | null> {
  try {
    return await wahaFetch<WahaSession>(`/api/sessions/${session}`);
  } catch (err) {
    if (err instanceof WahaError && err.message.includes("→ 404")) return null;
    throw err;
  }
}

/**
 * Pairing code для входа без QR: администратор вводит его на телефоне
 * (WhatsApp → Связанные устройства → Привязка по номеру телефона).
 * Телефон — только цифры с кодом страны, без «+» и разделителей.
 */
export async function wahaRequestPairingCode(
  session: string,
  phone: string,
): Promise<string> {
  const { code } = await wahaFetch<{ code: string }>(
    `/api/${session}/auth/request-code`,
    { method: "POST", body: { phoneNumber: phone.replace(/\D/g, "") } },
  );
  return code;
}

/** Разлогин + полное удаление сессии (конфигурация и данные авторизации). */
export async function wahaDeleteSession(session: string): Promise<void> {
  await wahaFetch<void>(`/api/sessions/${session}`, { method: "DELETE" });
}

/**
 * Отправка текста в чат WhatsApp. `chatId` — jid из вебхука WAHA
 * (например "79991234567@c.us") — тот же идентификатор, что мы передаём
 * в imconnector.send.messages как chat.id, поэтому ответ оператора из
 * Bitrix возвращается сюда без преобразований.
 */
export async function wahaSendText(
  session: string,
  chatId: string,
  text: string,
): Promise<void> {
  await wahaFetch<unknown>("/api/sendText", {
    method: "POST",
    body: { session, chatId, text },
  });
}

/** "79991234567@c.us" → "+79991234567"; для не-личных jid (группы) — null. */
export function phoneFromJid(jid: string): string | null {
  const match = /^(\d{5,15})@c\.us$/.exec(jid);
  return match ? `+${match[1]}` : null;
}

/** "+7 999 123-45-67" → "79991234567@c.us" — первое сообщение по номеру из CRM. */
export function jidFromPhone(phone: string): string {
  return `${phone.replace(/\D/g, "")}@c.us`;
}
