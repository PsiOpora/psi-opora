import { MaxProtocolClient } from "./protocol/client";
import { OPCODE } from "./protocol/opcodes";

/**
 * Логин личного аккаунта MAX идёт в несколько шагов через отдельные
 * HTTP-запросы дашборда (Фаза 2, по образцу packages/tg-userbot/src/login.ts)
 * — без держания сокета между ними: каждый шаг открывает своё TLS-соединение
 * и восстанавливает нужный контекст (deviceId, токен от предыдущего шага) из
 * непрозрачной строки `pendingSession`, которую вызывающий код (Redis,
 * см. tg-userbot/outbox.ts и telegram-personal/helpers.ts) хранит между
 * шагами сам — этот модуль ничего не персистит.
 *
 * ВНИМАНИЕ: протокол MAX/OneMe нигде официально не задокументирован — форма
 * ответов на AUTH (opcode 18) и LOGIN (opcode 19), конкретно имена полей с
 * токеном сессии, взяты из открытых разборов (см. src/protocol/opcodes.ts) и
 * почти наверняка потребуют правки по итогам живой проверки с реальным
 * номером телефона (см. scripts/manual-login.ts).
 */

const APP_VERSION = "26.8.1";
const BUILD_NUMBER = 6606;

function userAgentPayload() {
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

async function sessionInit(
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

export interface ConfirmLoginCodeResult {
  status: "connected";
  /** Финальная сессия — вызывающий код шифрует её (encryptSecret) перед
   * записью в БД, как и session у telegram-personal. */
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

    // LOGIN (19) заявлен разбором как отдельный шаг, завершающий вход по
    // токену, полученному на AUTH — если сервер уже отдаёт финальную сессию
    // прямо в ответе на AUTH, этот запрос, возможно, окажется лишним; решится
    // на живой проверке (см. предупреждение в начале файла).
    const loginToken = readToken(authResponse) ?? pending.verifyToken;
    const loginResponse = await client.request(OPCODE.LOGIN, {
      token: loginToken,
    });

    const sessionToken = readToken(loginResponse) ?? loginToken;
    const session: PendingMaxLogin & { sessionToken: string } = {
      ...pending,
      sessionToken,
    };
    return { status: "connected", session: JSON.stringify(session) };
  } finally {
    client.close();
  }
}
