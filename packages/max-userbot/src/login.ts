import { MaxProtocolClient } from "./protocol/client";
import { OPCODE } from "./protocol/opcodes";

/**
 * Логин личного аккаунта MAX идёт в несколько шагов через отдельные
 * HTTP-запросы дашборда (по образцу packages/tg-userbot/src/login.ts) — без
 * держания сокета между ними: каждый шаг открывает своё TLS-соединение и
 * восстанавливает нужный контекст (deviceId, токен от предыдущего шага) из
 * непрозрачной строки `pendingSession`, которую вызывающий код (Redis,
 * см. tg-userbot/outbox.ts и telegram-personal/helpers.ts) хранит между
 * шагами сам — этот модуль ничего не персистит.
 *
 * ВНИМАНИЕ: протокол MAX/OneMe нигде официально не задокументирован — форма
 * ответа на AUTH (opcode 18) взята из открытых разборов (см.
 * src/protocol/opcodes.ts) и почти наверняка потребует правки по итогам
 * живой проверки с реальным номером телефона (см. scripts/manual-login.ts).
 *
 * Итоговый LOGIN (opcode 19) сюда сознательно не входит: по рабочим
 * клиентам Grovvik/vkmax-nodejs (`signIn`/`loginByToken`) и nsdkinx/vkmax
 * (`sign_in`/`login_by_token`) один успешный AUTH уже переводит текущее
 * соединение в залогиненное состояние; LOGIN (19) нужен только на *новом*
 * соединении, когда сессия восстанавливается по ранее сохранённому токену —
 * этим занимается relay.ts (Фаза 2, воркер личного номера), а не логин-флоу.
 */

const APP_VERSION = "26.8.1";
const BUILD_NUMBER = 6606;

/** Экспортируется для переиспользования в relay.ts (Фаза 2) — одна и та же
 * user-agent форма должна уходить что на разовых подключениях логина, что
 * на постоянном соединении воркера. */
export function userAgentPayload() {
  // Порядок ключей важен (см. src/protocol/frame.ts) — не менять местами.
  return {
    deviceType: "ANDROID",
    pushDeviceType: "GCM",
    appVersion: APP_VERSION,
    arch: "arm64-v8a",
    buildNumber: BUILD_NUMBER,
    osVersion: "34",
    locale: "ru",
    deviceLocale: "ru_RU",
    deviceName: "psi-opora max-userbot",
    screen: "1080x1920",
    timezone: "Europe/Moscow",
  };
}

/** Экспортируется для переиспользования в relay.ts (Фаза 2). */
export async function sessionInit(
  client: MaxProtocolClient,
  deviceId: string,
): Promise<void> {
  await client.request(OPCODE.SESSION_INIT, {
    userAgent: userAgentPayload(),
    deviceId,
    clientSessionId: Date.now(),
  });
}

async function connectAndInit(deviceId: string): Promise<MaxProtocolClient> {
  const client = new MaxProtocolClient();
  await client.connect();
  await sessionInit(client, deviceId);
  return client;
}

/** Читает строковое поле из ответа сервера, перебирая несколько возможных
 * имён — форма ответа эмпирическая, см. предупреждение выше. */
function readToken(payload: Record<string, unknown>): string | undefined {
  for (const key of ["token", "authToken", "sessionToken"]) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Токен для реконнекта (предъявляется в LOGIN, opcode 19, на новом
 * соединении) — по обоим рабочим клиентам (Grovvik/vkmax-nodejs,
 * nsdkinx/vkmax) он лежит в ответе AUTH по пути
 * `tokenAttrs.LOGIN.token`, а не в верхнеуровневом `token` (тот — токен
 * верификации SMS-кода, годный только для самого AUTH). Если сервер когда-
 * нибудь начнёт отдавать его иначе, откатываемся на readToken() как раньше.
 */
function readLoginToken(payload: Record<string, unknown>): string | undefined {
  const tokenAttrs = payload.tokenAttrs as Record<string, unknown> | undefined;
  const loginAttr = tokenAttrs?.LOGIN as Record<string, unknown> | undefined;
  const nested = loginAttr?.token;
  if (typeof nested === "string" && nested.length > 0) return nested;
  return readToken(payload);
}

export interface PendingMaxLogin {
  phone: string;
  deviceId: string;
  /** Токен верификации, полученный от AUTH_REQUEST — предъявляется вместе с
   * SMS-кодом на шаге AUTH. */
  verifyToken: string;
}

export interface SendLoginCodeResult {
  /** Непрозрачная строка для вызывающего кода — сериализованный
   * PendingMaxLogin, ничего не шифруем на этом уровне (см. crypto.ts —
   * шифруется только финальная сессия перед записью в БД, как и у
   * telegram-personal). */
  pendingSession: string;
  codeLength: number;
}

export async function sendLoginCode(phone: string): Promise<SendLoginCodeResult> {
  const deviceId = crypto.randomUUID();
  const client = await connectAndInit(deviceId);
  try {
    const response = await client.request(OPCODE.AUTH_REQUEST, {
      phone,
      type: "START_AUTH",
    });

    const verifyToken = readToken(response);
    if (!verifyToken) {
      throw new Error(
        `MAX не вернул токен верификации на AUTH_REQUEST: ${JSON.stringify(response)}`,
      );
    }
    const codeLength = typeof response.codeLength === "number" ? response.codeLength : 6;

    const pending: PendingMaxLogin = { phone, deviceId, verifyToken };
    return {
      pendingSession: JSON.stringify(pending),
      codeLength,
    };
  } finally {
    client.close();
  }
}

/**
 * Персистентная сессия личного номера MAX — то, что нужно relay.ts (Фаза 2)
 * для реконнекта через LOGIN (opcode 19) на новом соединении. Сериализуется
 * в JSON и шифруется (encryptSecret) перед записью в БД, как и session у
 * telegram-personal.
 */
export interface MaxUserbotSession {
  phone: string;
  deviceId: string;
  /** `tokenAttrs.LOGIN.token` из ответа AUTH — см. readLoginToken(). */
  sessionToken: string;
}

export interface ConfirmLoginCodeResult {
  status: "connected";
  /** JSON-сериализованный MaxUserbotSession. */
  session: string;
}

export async function confirmLoginCode(params: {
  pendingSession: string;
  code: string;
}): Promise<ConfirmLoginCodeResult> {
  const pending: PendingMaxLogin = JSON.parse(params.pendingSession);
  const client = await connectAndInit(pending.deviceId);
  try {
    const authResponse = await client.request(OPCODE.AUTH, {
      token: pending.verifyToken,
      verifyCode: params.code,
      authTokenType: "CHECK_CODE",
    });

    const sessionToken = readLoginToken(authResponse);
    if (!sessionToken) {
      throw new Error(
        `MAX не вернул токен для повторного входа в ответе на AUTH: ${JSON.stringify(authResponse)}`,
      );
    }

    const session: MaxUserbotSession = {
      phone: pending.phone,
      deviceId: pending.deviceId,
      sessionToken,
    };
    return { status: "connected", session: JSON.stringify(session) };
  } finally {
    client.close();
  }
}
