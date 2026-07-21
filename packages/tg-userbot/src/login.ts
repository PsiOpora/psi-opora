import { MemoryStorage, SentCode, tl } from "@mtcute/core";
import { TelegramClient } from "@mtcute/node";
import { env } from "@psi-opora/config";

function getApiCredentials(): { apiId: number; apiHash: string } {
  const apiId = env.TG_USERBOT_API_ID;
  const apiHash = env.TG_USERBOT_API_HASH;
  if (!apiId || !apiHash) {
    throw new Error(
      "TG_USERBOT_API_ID/TG_USERBOT_API_HASH не заданы (получить на my.telegram.org/apps)",
    );
  }
  return { apiId, apiHash };
}

/**
 * Логин личного аккаунта Telegram (mtcute) идёт в несколько шагов через
 * отдельные HTTP-запросы дашборда (без держания сокета между ними) —
 * каждый шаг создаёт свежий клиент и восстанавливает состояние через
 * exportSession()/importSession() неавторизованной сессии, а не держит
 * один и тот же процесс/соединение живым между шагами.
 */
function createClient(): TelegramClient {
  const { apiId, apiHash } = getApiCredentials();
  return new TelegramClient({ apiId, apiHash, storage: new MemoryStorage() });
}

export interface SendLoginCodeResult {
  pendingSession: string;
  phoneCodeHash: string;
}

export async function sendLoginCode(phone: string): Promise<SendLoginCodeResult> {
  const tg = createClient();
  try {
    const sentCode = await tg.sendCode({ phone });
    if (!(sentCode instanceof SentCode)) {
      // sendCode вернул User — аккаунт уже авторизован в этой (свежей)
      // сессии, такого быть не должно для MemoryStorage с нуля.
      throw new Error("Telegram сообщил, что аккаунт уже авторизован");
    }
    const pendingSession = await tg.exportSession();
    return { pendingSession, phoneCodeHash: sentCode.phoneCodeHash };
  } finally {
    await tg.destroy();
  }
}

export type ConfirmLoginResult =
  | { status: "connected"; session: string }
  | { status: "password_required"; pendingSession: string };

export async function confirmLoginCode(params: {
  pendingSession: string;
  phone: string;
  phoneCodeHash: string;
  code: string;
}): Promise<ConfirmLoginResult> {
  const tg = createClient();
  try {
    await tg.importSession(params.pendingSession);
    try {
      await tg.signIn({
        phone: params.phone,
        phoneCodeHash: params.phoneCodeHash,
        phoneCode: params.code,
      });
      return { status: "connected", session: await tg.exportSession() };
    } catch (err) {
      if (tl.RpcError.is(err, "SESSION_PASSWORD_NEEDED")) {
        return {
          status: "password_required",
          pendingSession: await tg.exportSession(),
        };
      }
      throw err;
    }
  } finally {
    await tg.destroy();
  }
}

export async function confirmLoginPassword(params: {
  pendingSession: string;
  password: string;
}): Promise<{ status: "connected"; session: string }> {
  const tg = createClient();
  try {
    await tg.importSession(params.pendingSession);
    await tg.checkPassword(params.password);
    return { status: "connected", session: await tg.exportSession() };
  } finally {
    await tg.destroy();
  }
}
