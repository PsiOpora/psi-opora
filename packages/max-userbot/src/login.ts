import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { MaxProtocolClient } from "./protocol/client";
import { OPCODE } from "./protocol/opcodes";

/**
 * Логин личного аккаунта MAX идёт в несколько шагов (код, затем облачный
 * пароль, если он включён) на одном TLS-соединении — см. MaxLoginFlow.
 * Держит это соединение always-on воркер (apps/max-userbot-worker), дашборд
 * передаёт ему шаги через Redis (src/login-broker.ts): каждый шаг — отдельный
 * HTTP-запрос, а соединение между ними жить в Next.js-процессе не может.
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

/**
 * Сборка Android-клиента MAX, которой мы представляемся. Версия, номер
 * сборки и дайджесты APK для `mode` (см. chatCacheFingerprint) — одно целое:
 * дайджесты DEX/SO меняются с каждой сборкой (у kolibri-net для 26.20.2 они
 * другие), и сервер, получив `mode` от одной сборки при `appVersion` другой,
 * отвечает на AUTH_REQUEST валидным token, но код не отправляет. Поэтому
 * версию нельзя поднимать отдельно от дайджестов — только вместе, из того же
 * источника. Значения — Komet (lib/core/storage/spoofing_service.dart::
 * hardcodedAppVersion/hardcodedBuildNumber и
 * lib/core/protocol/chat_cache_fingerprint.dart).
 */
export const MAX_CLIENT_BUILD = {
	appVersion: "26.23.2",
	buildNumber: 6779,
	signatureDigest:
		"1684414033eb263e2c615f8b7df5ed8793850a07656304997fbf07e9e21e1e93",
	dexDigest: "38cff46f392dc1734c308be011c2f0d8da152a390b41063dbb2c913e3032f4b3",
	soDigest: "634ecc42b246784d975f180b4fecf903df235cdf0476da47163a85630eb1a6a8",
} as const;

/** Экспортируется для переиспользования в relay.ts (Фаза 2) — одна и та же
 * user-agent форма должна уходить что на разовых подключениях логина, что
 * на постоянном соединении воркера.
 *
 * Набор полей, их порядок и формат значений повторяют SESSION_INIT Komet
 * (kolibri-net, src/session/manager.rs::build_handshake_payload): без
 * `carrierName`/`networkType`/`vendor`/`installSource`, `osVersion` вида
 * "Android 14", `screen` вида "<bucket> <dpi> <WxH>", двухбуквенный
 * `deviceLocale`, `arch`/`buildNumber` в конце. Устройство — пресет Komet
 * (lib/core/config/device_presets.dart) с русской локалью. */
export function userAgentPayload() {
	// Порядок ключей важен (см. src/protocol/frame.ts) — не менять местами.
	return {
		deviceType: "ANDROID",
		appVersion: MAX_CLIENT_BUILD.appVersion,
		osVersion: "Android 14",
		timezone: "Europe/Moscow",
		screen: "xxhdpi 450dpi 1440x3120",
		pushDeviceType: "GCM",
		locale: "ru",
		deviceName: "Samsung Galaxy S24 Ultra",
		deviceLocale: "ru",
		arch: "arm64-v8a",
		buildNumber: MAX_CLIENT_BUILD.buildNumber,
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
	return (randomBytes(4).readUInt32BE(0) % 0x7fffffff) + 1;
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

/** int64 от сервера приходит bigint'ом (→ строка, см. normalizeBigInts), но
 * msgpack кодирует целое минимальным форматом: небольшой `callsSeed` придёт
 * обычным number. Без этого `mode` в AUTH_REQUEST молча не отправлялся бы. */
const callsSeedSchema = z
	.union([z.number().int().safe().transform(String), z.string()])
	.pipe(z.string().regex(/^-?\d+$/))
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
	// Порядок ключей — как у kolibri-net (build_handshake_payload).
	const response = await client.request(OPCODE.SESSION_INIT, {
		mt_instanceid: instanceId,
		userAgent: userAgentPayload(),
		clientSessionId: generateClientSessionId(),
		deviceId,
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
 * Дайджесты привязаны к сборке APK — см. MAX_CLIENT_BUILD.
 */
function chatCacheFingerprint(callsSeed: string, deviceId: string): Uint8Array {
	const SIGNATURE_DIGEST = Buffer.from(MAX_CLIENT_BUILD.signatureDigest, "hex");
	const SO_DIGEST = Buffer.from(MAX_CLIENT_BUILD.soDigest, "hex");
	const DEX_DIGEST = Buffer.from(MAX_CLIENT_BUILD.dexDigest, "hex");

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

export interface MaxLoginCodeSent {
	status: "code_sent";
	/** Номер в том виде, в каком ушёл в MAX (E.164). */
	phone: string;
	codeLength: number;
}

export interface MaxLoginPasswordRequired {
	status: "password_required";
	/** Подсказка к паролю, заданная владельцем аккаунта. */
	hint?: string;
	/** Маскированный e-mail восстановления, как его отдаёт сервер. */
	email?: string;
}

export interface MaxLoginConnected {
	status: "connected";
	/** JSON-сериализованный MaxUserbotSession — секрет, в открытом виде не
	 * хранить и не логировать. */
	session: string;
}

/** `passwordChallenge` в ответе AUTH — признак включённого облачного пароля
 * (Komet: VerifyCodeResult.requiresPassword/challengeTrackId/challengeHint). */
const passwordChallengeSchema = z.object({
	trackId: z.string().min(1),
	hint: z.string().optional(),
	email: z.string().optional(),
});

/** Ответы AUTH/AUTH_LOGIN_CHECK_PASSWORD несут токен входа — в лог его не
 * пишем, это полноценный доступ к аккаунту. */
function describeResponse(payload: Record<string, unknown>): string {
	return JSON.stringify(payload, (key, value) => {
		if (value instanceof Uint8Array) return `<Uint8Array(${value.length})>`;
		if (key === "token" && typeof value === "string") return "<redacted>";
		return value;
	});
}

/** Keepalive, как у kolibri-net (session/manager.rs::maintain): PING с
 * `interactive` раз в 30 секунд, пока соединение живо. Без него сервер может
 * закрыть простаивающее соединение, пока человек ищет код. */
const LOGIN_PING_INTERVAL_MS = 30_000;

const CONNECTION_LOST_MESSAGE =
	"Соединение с MAX прервалось во время входа — запросите код заново";

type LoginStage = "awaiting_code" | "awaiting_password" | "done";

/**
 * Вход в личный аккаунт MAX на ОДНОМ соединении — как у Komet: и `token`
 * из AUTH_REQUEST, и `trackId` облачного пароля сервер привязывает к
 * соединению, на котором они выданы. Komet при обрыве связи на экране кода
 * запрашивает код заново (code_confirmation_screen.dart::recoverStaleSession),
 * а на экране пароля отправляет входить сначала (password_2fa_screen.dart).
 * Токен, предъявленный на новом соединении, сервер отвергает с
 * `service.unavailable` — поэтому объект держит сокет открытым между шагами;
 * вызывающий код (воркер, см. apps/max-userbot-worker/src/login.ts) хранит
 * его в памяти процесса и обязан вызвать close().
 */
export class MaxLoginFlow {
	private stage: LoginStage = "awaiting_code";
	private lost = false;
	private passwordTrackId: string | undefined;
	private readonly pingTimer: ReturnType<typeof setInterval>;

	private constructor(
		private readonly client: MaxProtocolClient,
		private readonly identity: {
			phone: string;
			deviceId: string;
			instanceId: string;
			verifyToken: string;
		},
		connectionState: { lost: boolean },
	) {
		this.lost = connectionState.lost;
		this.pingTimer = setInterval(() => {
			this.client.request(OPCODE.PING, { interactive: true }).catch(() => {});
		}, LOGIN_PING_INTERVAL_MS);
		this.pingTimer.unref?.();
	}

	/** SESSION_INIT + AUTH_REQUEST (START_AUTH) — MAX отправляет код. */
	static async start(
		phone: string,
	): Promise<{ flow: MaxLoginFlow; result: MaxLoginCodeSent }> {
		const normalizedPhone = normalizeMaxPhone(phone);
		const deviceId = generateDeviceId();
		const instanceId = generateInstanceId();
		// onClose может прийти и до, и после создания flow — общий флаг.
		const connectionState = { lost: false };
		let flow: MaxLoginFlow | undefined;
		const client = new MaxProtocolClient({
			onClose: (error) => {
				connectionState.lost = true;
				if (flow) flow.lost = true;
				console.error(
					`[max-personal-login] соединение входа закрыто: ${error.message}`,
				);
			},
		});
		try {
			await client.connect();
			const { callsSeed } = await sessionInit(client, deviceId, instanceId);

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
				`[max-personal-login] AUTH_REQUEST response: ${describeResponse(response)}`,
			);

			const verifyToken = readToken(response);
			if (!verifyToken) {
				throw new Error(
					`MAX не вернул токен верификации на AUTH_REQUEST: ${describeResponse(response)}`,
				);
			}
			if (readInteger(response.requestCountLeft) === 0) {
				throw new Error(
					"MAX исчерпал лимит отправки кодов для этого номера. Подождите и повторите позже",
				);
			}

			flow = new MaxLoginFlow(
				client,
				{ phone: normalizedPhone, deviceId, instanceId, verifyToken },
				connectionState,
			);
			return {
				flow,
				result: {
					status: "code_sent",
					phone: normalizedPhone,
					codeLength: readInteger(response.codeLength) ?? 6,
				},
			};
		} catch (error) {
			client.close();
			throw error;
		}
	}

	/** AUTH (CHECK_CODE) на том же соединении. */
	async submitCode(
		code: string,
	): Promise<MaxLoginConnected | MaxLoginPasswordRequired> {
		this.assertStage("awaiting_code");
		const response = await this.client.request(OPCODE.AUTH, {
			token: this.identity.verifyToken,
			verifyCode: code,
			authTokenType: "CHECK_CODE",
		});
		console.log(
			`[max-personal-login] AUTH (confirm code) response: ${describeResponse(response)}`,
		);

		// Облачный пароль: токена входа ещё нет (tokenAttrs пустой), сервер
		// ждёт пароль по trackId — как Password2FAScreen у Komet.
		const challenge = passwordChallengeSchema.safeParse(
			response.passwordChallenge,
		);
		if (challenge.success) {
			this.passwordTrackId = challenge.data.trackId;
			this.stage = "awaiting_password";
			return {
				status: "password_required",
				hint: challenge.data.hint,
				email: challenge.data.email,
			};
		}

		const sessionToken = readLoginToken(response);
		if (!sessionToken) {
			throw new Error(
				`MAX не вернул токен для повторного входа в ответе на AUTH: ${describeResponse(response)}`,
			);
		}
		return this.finish(sessionToken);
	}

	/**
	 * AUTH_LOGIN_CHECK_PASSWORD (opcode 115) `{ trackId, password }` на том же
	 * соединении; токен входа — в `tokenAttrs.LOGIN.token`, как и у AUTH без
	 * пароля (Komet: AccountModule.checkPassword). Неверный пароль не
	 * завершает вход — можно ввести ещё раз.
	 */
	async submitPassword(password: string): Promise<MaxLoginConnected> {
		this.assertStage("awaiting_password");
		const response = await this.client.request(
			OPCODE.AUTH_LOGIN_CHECK_PASSWORD,
			{ trackId: this.passwordTrackId, password },
		);
		console.log(
			`[max-personal-login] AUTH_LOGIN_CHECK_PASSWORD response: ${describeResponse(response)}`,
		);
		if (response.error != null) {
			throw new Error("Неверный облачный пароль MAX");
		}

		const sessionToken = readLoginToken(response);
		if (!sessionToken) {
			throw new Error(
				`MAX не вернул токен для повторного входа после проверки пароля: ${describeResponse(response)}`,
			);
		}
		return this.finish(sessionToken);
	}

	get phone(): string {
		return this.identity.phone;
	}

	/** Соединение закрылось — продолжить этот вход уже нельзя, только начать
	 * заново (новый код). */
	get connectionLost(): boolean {
		return this.lost;
	}

	close(): void {
		clearInterval(this.pingTimer);
		this.client.close();
	}

	private assertStage(expected: LoginStage): void {
		if (this.lost) throw new Error(CONNECTION_LOST_MESSAGE);
		if (this.stage !== expected) {
			throw new Error(
				expected === "awaiting_password"
					? "MAX не запрашивал облачный пароль для этого входа"
					: "Код уже подтверждён — этот вход завершён или ждёт пароль",
			);
		}
	}

	private finish(sessionToken: string): MaxLoginConnected {
		this.stage = "done";
		const session: MaxUserbotSession = {
			phone: this.identity.phone,
			deviceId: this.identity.deviceId,
			instanceId: this.identity.instanceId,
			sessionToken,
		};
		return { status: "connected", session: JSON.stringify(session) };
	}
}
