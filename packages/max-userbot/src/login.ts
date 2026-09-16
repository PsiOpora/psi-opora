import { createHash, randomBytes, randomUUID } from "node:crypto";
import { env } from "@psi-opora/config";
import { z } from "zod";
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

/** Экспортируется для переиспользования в relay.ts (Фаза 2) — одна и та же
 * user-agent форма должна уходить что на разовых подключениях логина, что
 * на постоянном соединении воркера. */
export function userAgentPayload() {
	// Порядок ключей важен (см. src/protocol/frame.ts) — не менять местами.
	return {
		deviceType: "ANDROID",
		pushDeviceType: "GCM",
		appVersion: env.MAX_USERBOT_APP_VERSION,
		arch: "arm64-v8a",
		buildNumber: env.MAX_USERBOT_BUILD_NUMBER,
		osVersion: "34",
		locale: "ru",
		deviceLocale: "ru_RU",
		deviceName: "samsung SM-G998B",
		screen: "1080x1920",
		timezone: "Europe/Moscow",
		carrierName: "MTS",
		networkType: "wifi",
		vendor: "samsung",
		installSource: "com.android.vending",
	};
}

/** Протокол принимает телефон только в E.164. Разрешаем привычное российское
 * написание через 8 и визуальные разделители, но в MAX всегда отправляем +7. */
export function normalizeMaxPhone(value: string): string {
	const compact = value.trim().replace(/[\s()-]/g, "");
	if (/^8\d{10}$/.test(compact)) return `+7${compact.slice(1)}`;
	if (/^7\d{10}$/.test(compact)) return `+${compact}`;
	if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
	throw new Error(
		"Введите номер MAX в международном формате, например +79991234567",
	);
}

/** Формат deviceId у Komet — 8 случайных байт в hex (16 символов), а не UUID
 * (см. lib/core/storage/device_identity.dart::deviceId). Сервер, судя по
 * всему, отличает такие deviceId от «чужеродных», поэтому воспроизводим
 * тот же формат побайтово. */
function generateDeviceId(): string {
	return randomBytes(8).toString("hex");
}

/** `clientSessionId` у Komet — случайное 31-битное целое на процесс
 * (lib/core/storage/device_identity.dart::clientSessionId,
 * `Random.nextInt(0x7FFFFFFF) + 1`), а не unix-время: `Date.now()` в
 * SESSION_INIT (как было раньше в этом модуле) на три порядка больше
 * реального диапазона int32 и выглядит как явный признак скрипта, а не
 * настоящего Android-клиента. */
function generateClientSessionId(): number {
	return randomBytes(4).readUInt32BE(0) % 0x7fffffff + 1;
}

/** `mt_instanceid` — обязательное поле SESSION_INIT (см. PronikFire/Max-API-Guide),
 * отсутствующее в открытых разборах, по которым собирался opcodes.ts, но
 * присутствующее в реальном хендшейке Komet (SharedPreferences-ключ
 * `mt_instance_id`, lib/core/storage/device_identity.dart::instanceId).
 * Формат — обычный UUIDv4, как у Komet (lib/core/utils/ids.dart::uuidV4). */
function generateInstanceId(): string {
	return randomUUID();
}

function readInteger(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isSafeInteger(value)) return value;
	if (typeof value === "string" && /^\d+$/.test(value)) {
		const parsed = Number(value);
		if (Number.isSafeInteger(parsed)) return parsed;
	}
	return undefined;
}

export interface SessionInitResult {
	/** `callsSeed` из ответа SESSION_INIT — используется для вычисления
	 * ChatCacheFingerprint (поле `mode` в AUTH_REQUEST), как у Komet.
	 * Приходит как 64-битное целое; decodePayload (frame.ts) декодирует int64
	 * через useBigInt64 и normalizeBigInts переводит bigint в десятичную
	 * строку (чтобы не терять точность вне Number.MAX_SAFE_INTEGER) — поэтому
	 * здесь ждём string, а не number, иначе поле никогда не распознаётся. */
	callsSeed: string | undefined;
}

const callsSeedSchema = z
	.string()
	.regex(/^-?\d+$/)
	.refine(
		(value) => {
			try {
				const seed = BigInt(value);
				return seed >= -(1n << 63n) && seed <= (1n << 63n) - 1n;
			} catch {
				return false;
			}
		},
		{ message: "callsSeed must be a signed int64" },
	);

/** Экспортируется для переиспользования в relay.ts (Фаза 2). `instanceId` —
 * `mt_instanceid` (см. generateInstanceId) — обязателен, как у Komet. */
export async function sessionInit(
	client: MaxProtocolClient,
	deviceId: string,
	instanceId: string,
): Promise<SessionInitResult> {
	const response = await client.request(OPCODE.SESSION_INIT, {
		userAgent: userAgentPayload(),
		deviceId,
		clientSessionId: generateClientSessionId(),
		mt_instanceid: instanceId,
	});
	console.log(
		`[max-personal-login] SESSION_INIT response: ${JSON.stringify(response)}`,
	);
	// `isVpn` — сервер сам детектит VPN/датацентр-IP уже на SESSION_INIT (см.
	// PronikFire/Max-API-Guide). Если true, сервер почти наверняка тихо
	// глотает реальную отправку кода на AUTH_REQUEST дальше (возвращает
	// валидный token, но SMS/push не уходит) — это внешний по отношению к
	// протоколу антифрод-сигнал, byte-perfect payload его не обойдёт.
	if (response.isVpn === true) {
		console.warn(
			"[max-personal-login] MAX пометил соединение как isVpn=true — сервер, " +
				"скорее всего, не отправит реальный код на AUTH_REQUEST, даже если " +
				"тот ответит без ошибки. Нужен исходящий IP не из диапазонов " +
				"дата-центра/VPN (см. src/protocol/client.ts — сейчас соединение " +
				"идёт напрямую с сервера, без прокси).",
		);
	}
	const callsSeed = callsSeedSchema.safeParse(response.callsSeed).data;
	return { callsSeed };
}

/**
 * Вычисляет ChatCacheFingerprint — антиспам/верификационная метрика,
 * которую Komet отправляет в поле `mode` в AUTH_REQUEST и в поле
 * `chatCacheFingerprint` в LOGIN (opcode 19).
 *
 * Алгоритм — три SHA-256 хэша, конкатенированных побайтово:
 *   sha256(signatureDigest + seed_int64_big_endian + deviceId_utf8)
 *   sha256(dexDigest       + seed_int64_big_endian + deviceId_utf8)
 *   sha256(soDigest        + seed_int64_big_endian + deviceId_utf8)
 *
 * Дайджесты — публичные константы из исходников Komet (chat_cache_fingerprint.dart).
 */
function chatCacheFingerprint(callsSeed: string, deviceId: string): Uint8Array {
	const SIGNATURE_DIGEST = Buffer.from(
		"1684414033eb263e2c615f8b7df5ed8793850a07656304997fbf07e9e21e1e93",
		"hex",
	);
	const SO_DIGEST = Buffer.from(
		"634ecc42b246784d975f180b4fecf903df235cdf0476da47163a85630eb1a6a8",
		"hex",
	);
	const DEX_DIGEST = Buffer.from(
		"38cff46f392dc1734c308be011c2f0d8da152a390b41063dbb2c913e3032f4b3",
		"hex",
	);

	const seed = Buffer.allocUnsafe(8);
	// callsSeed — 64-битное целое от сервера (в строке, см. SessionInitResult),
	// пишем в int64 big-endian как Dart
	seed.writeBigInt64BE(BigInt(callsSeed), 0);
	const device = Buffer.from(deviceId, "utf8");

	function sha256part(a: Buffer): Buffer {
		return createHash("sha256").update(a).update(seed).update(device).digest();
	}

	return Buffer.concat([
		sha256part(SIGNATURE_DIGEST),
		sha256part(DEX_DIGEST),
		sha256part(SO_DIGEST),
	]);
}
async function connectAndInit(
	deviceId: string,
	instanceId: string,
): Promise<{ client: MaxProtocolClient; callsSeed: string | undefined }> {
	const client = new MaxProtocolClient();
	await client.connect();
	const { callsSeed } = await sessionInit(client, deviceId, instanceId);
	return { client, callsSeed };
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
	/** `mt_instanceid` — см. generateInstanceId. Должен остаться тем же между
	 * SESSION_INIT в sendLoginCode и SESSION_INIT в confirmLoginCode (два
	 * разных TLS-соединения одного и того же логина), иначе сервер снова
	 * увидит «новое» устройство. */
	instanceId: string;
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
	phone: string;
}

export async function sendLoginCode(
	phone: string,
): Promise<SendLoginCodeResult> {
	const normalizedPhone = normalizeMaxPhone(phone);
	const deviceId = generateDeviceId();
	const instanceId = generateInstanceId();
	const { client, callsSeed } = await connectAndInit(deviceId, instanceId);
	try {
		const authRequestPayload: Record<string, unknown> = {
			phone: normalizedPhone,
			type: "START_AUTH",
			language: "ru",
		};
		// Поле `mode` (ChatCacheFingerprint) — антиспам-метрика сервера,
		// отправляется если callsSeed пришёл в ответе SESSION_INIT, как у Komet.
		if (callsSeed !== undefined) {
			authRequestPayload.mode = chatCacheFingerprint(callsSeed, deviceId);
		}

		const response = await client.request(
			OPCODE.AUTH_REQUEST,
			authRequestPayload,
		);
		console.log(
			`[max-personal-login] AUTH_REQUEST response: ${JSON.stringify(response, (_k, v) => (v instanceof Uint8Array ? `<Uint8Array(${v.length})>` : v))}`,
		);

		const verifyToken = readToken(response);
		if (!verifyToken) {
			throw new Error(
				`MAX не вернул токен верификации на AUTH_REQUEST: ${JSON.stringify(response)}`,
			);
		}
		const codeLength = readInteger(response.codeLength) ?? 6;
		const requestCountLeft = readInteger(response.requestCountLeft);
		if (requestCountLeft === 0) {
			throw new Error(
				"MAX исчерпал лимит отправки кодов для этого номера. Подождите и повторите позже",
			);
		}

		const pending: PendingMaxLogin = {
			phone: normalizedPhone,
			deviceId,
			instanceId,
			verifyToken,
		};
		return {
			pendingSession: JSON.stringify(pending),
			codeLength,
			phone: normalizedPhone,
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
	/** `mt_instanceid` — должен переживать реконнекты (relay.ts), как у
	 * Komet, иначе сервер видит «новое» устройство при каждом входе. */
	instanceId: string;
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
	const { client } = await connectAndInit(pending.deviceId, pending.instanceId);
	try {
		const authResponse = await client.request(OPCODE.AUTH, {
			token: pending.verifyToken,
			verifyCode: params.code,
			authTokenType: "CHECK_CODE",
		});
		console.log(
			`[max-personal-login] AUTH (confirm code) response: ${JSON.stringify(authResponse, (_k, v) => (v instanceof Uint8Array ? `<Uint8Array(${v.length})>` : v))}`,
		);

		const sessionToken = readLoginToken(authResponse);
		if (!sessionToken) {
			throw new Error(
				`MAX не вернул токен для повторного входа в ответе на AUTH: ${JSON.stringify(authResponse)}`,
			);
		}

		const session: MaxUserbotSession = {
			phone: pending.phone,
			deviceId: pending.deviceId,
			instanceId: pending.instanceId,
			sessionToken,
		};
		return { status: "connected", session: JSON.stringify(session) };
	} finally {
		client.close();
	}
}
