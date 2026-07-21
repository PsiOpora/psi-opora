import type { BitrixApi } from "@psi-opora/bitrix-client";
import { createUpstashRedis } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { upsertTelegramPersonalAccountConnected } from "@psi-opora/db/queries";
import { encryptSession } from "@psi-opora/tg-userbot";

/** Промежуточное состояние логина Telegram-userbot живёт только в Redis — на
 * фронт уходит лишь `loginId`, сырые данные сессии/hash не покидают сервер. */
export interface PendingTelegramLogin {
  memberId: string;
  lineId: string;
  phone: string;
  phoneCodeHash: string;
  pendingSession: string;
  awaiting: "code" | "password";
}

const PENDING_LOGIN_TTL_SECONDS = 10 * 60;

function pendingLoginKey(loginId: string): string {
  return `tg-userbot:pending-login:${loginId}`;
}

export async function savePendingTelegramLogin(
  loginId: string,
  data: PendingTelegramLogin,
): Promise<void> {
  const redis = createUpstashRedis();
  await redis.set(pendingLoginKey(loginId), data, {
    ex: PENDING_LOGIN_TTL_SECONDS,
  });
}

export async function getPendingTelegramLogin(
  loginId: string,
): Promise<PendingTelegramLogin | null> {
  const redis = createUpstashRedis();
  return (await redis.get<PendingTelegramLogin>(pendingLoginKey(loginId))) ?? null;
}

export async function deletePendingTelegramLogin(loginId: string): Promise<void> {
  const redis = createUpstashRedis();
  await redis.del(pendingLoginKey(loginId));
}

export function connectorId(): string {
  return env.TG_USERBOT_CONNECTOR_ID;
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
  phone: string;
  session: string;
  getBitrixApi: () => Promise<BitrixApi | null>;
}): Promise<{ activationError?: string }> {
  await upsertTelegramPersonalAccountConnected({
    memberId: params.memberId,
    openLineId: params.lineId,
    connectorId: connectorId(),
    phone: params.phone,
    sessionEncrypted: encryptSession(params.session),
  });

  try {
    const api = await params.getBitrixApi();
    if (!api) return { activationError: "Нет подключения к Битрикс24" };
    await api.call("imconnector.activate", {
      CONNECTOR: connectorId(),
      LINE: Number(params.lineId),
      ACTIVE: "1",
    });
    return {};
  } catch (err) {
    return { activationError: (err as Error).message };
  }
}
