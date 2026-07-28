import type { BitrixApi } from "@psi-opora/bitrix-client";
import { createRedisClient } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { upsertTelegramPersonalAccountConnected } from "@psi-opora/db/queries";
import { encryptSecret } from "@psi-opora/tg-userbot";

/**
 * Промежуточное состояние логина Telegram-userbot живёт только в Redis — на
 * фронт уходит лишь `loginId`, сырые данные сессии/hash не покидают сервер.
 * В отличие от финальной сессии (шифруется перед записью в Postgres, см.
 * encryptSession), pendingSession здесь хранится как есть: это либо ещё не
 * авторизованная сессия (после sendCode), либо авторизованная лишь частично
 * (после signIn, но до подтверждения 2FA-пароля) — в обоих случаях запись
 * живёт не дольше PENDING_LOGIN_TTL_SECONDS и доступна только серверу
 * (Redis не читается с фронта), так что риск ниже, чем у постоянного
 * хранения в БД, но это осознанный компромисс, а не то же самое, что
 * шифрование финальной сессии.
 */
export interface PendingTelegramLogin {
  memberId: string;
  lineId: string;
  connectorId: string;
  phone: string;
  phoneCodeHash: string;
  pendingSession: string;
  awaiting: "code" | "password";
  /** api_id/api_hash приложения Telegram, введённые администратором на
   * первом шаге — используются для переподключения на всех следующих. */
  apiId: number;
  apiHash: string;
}

const PENDING_LOGIN_TTL_SECONDS = 10 * 60;

function pendingLoginKey(loginId: string): string {
  return `tg-userbot:pending-login:${loginId}`;
}

export async function savePendingTelegramLogin(
  loginId: string,
  data: PendingTelegramLogin,
): Promise<void> {
  const redis = createRedisClient();
  await redis.set(pendingLoginKey(loginId), data, {
    ex: PENDING_LOGIN_TTL_SECONDS,
  });
}

export async function getPendingTelegramLogin(
  loginId: string,
): Promise<PendingTelegramLogin | null> {
  const redis = createRedisClient();
  return (
    (await redis.get<PendingTelegramLogin>(pendingLoginKey(loginId))) ?? null
  );
}

export async function deletePendingTelegramLogin(
  loginId: string,
): Promise<void> {
  const redis = createRedisClient();
  await redis.del(pendingLoginKey(loginId));
}

/** Префикс для генерации ID новых слотов (см. generateConnectorId) — сам по
 * себе значением коннектора больше не является. */
export function connectorIdPrefix(): string {
  return env.TG_USERBOT_CONNECTOR_ID;
}

/**
 * Генерирует уникальный ID нового коннектора-слота — Bitrix требует ID из
 * строчных букв/цифр/`_` (без точки, см. imconnector.register), поэтому берём
 * hex-часть UUID. Каждый личный номер регистрируется как отдельный
 * коннектор — так несколько номеров можно активировать на одной линии
 * одновременно (imconnector.activate допускает много разных CONNECTOR на
 * одной LINE, но только один активный слот на пару CONNECTOR+LINE).
 */
export function generateConnectorId(): string {
  return `${connectorIdPrefix()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Сохраняет успешно полученную MTProto-сессию (шифрованно) и активирует
 * коннектор на выбранной линии — `imconnector.activate` требует контекста
 * OAuth-приложения (см. пометку в плане про WRONG_AUTH_TYPE у webhook-based
 * вызовов), поэтому вызывается через `context.getBitrixApi()` дашборда.
 * Ошибку активации не считаем фатальной для логина — сессия уже сохранена,
 * администратор может повторить активацию отдельно.
 */
export async function finalizeConnectedLogin(params: {
  memberId: string;
  lineId: string;
  connectorId: string;
  phone: string;
  apiId: number;
  apiHash: string;
  session: string;
  getBitrixApi: () => Promise<BitrixApi | null>;
}): Promise<{ activationError?: string }> {
  await upsertTelegramPersonalAccountConnected({
    memberId: params.memberId,
    openLineId: params.lineId,
    connectorId: params.connectorId,
    phone: params.phone,
    apiId: String(params.apiId),
    apiHashEncrypted: encryptSecret(params.apiHash),
    sessionEncrypted: encryptSecret(params.session),
  });

  try {
    const api = await params.getBitrixApi();
    if (!api) return { activationError: "Нет подключения к Битрикс24" };
    await api.call("imconnector.activate", {
      CONNECTOR: params.connectorId,
      LINE: Number(params.lineId),
      ACTIVE: "Y",
    });
    return {};
  } catch (err) {
    return { activationError: (err as Error).message };
  }
}
