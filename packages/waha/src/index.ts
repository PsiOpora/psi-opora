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
import { createHash } from "node:crypto";
import { env } from "@psi-opora/config";

export class WahaError extends Error {}

const WAHA_REQUEST_TIMEOUT_MS = 15_000;

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
	const method = init?.method ?? "GET";
	try {
		const res = await fetch(wahaUrl(path), {
			method,
			headers: {
				"Content-Type": "application/json",
				// WAHA отдаёт бинарник (например PNG для /auth/qr) вместо JSON,
				// если Accept не равен ровно "application/json" (см.
				// BufferResponseInterceptor в самой WAHA) — без этого QR-эндпоинт
				// молча возвращает не то тело, и его не распарсить как JSON.
				Accept: "application/json",
				...(env.WAHA_API_KEY ? { "X-Api-Key": env.WAHA_API_KEY } : {}),
			},
			...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
			signal: AbortSignal.timeout(WAHA_REQUEST_TIMEOUT_MS),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new WahaError(
				`WAHA ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`,
			);
		}
		// Некоторые эндпоинты (logout/delete) отвечают пустым телом.
		const text = await res.text();
		return (text ? JSON.parse(text) : undefined) as T;
	} catch (err) {
		if (err instanceof WahaError) throw err;
		if (err instanceof Error && err.name === "TimeoutError") {
			throw new WahaError(
				`WAHA ${method} ${path} не ответила за ${WAHA_REQUEST_TIMEOUT_MS / 1000} с`,
			);
		}
		throw new WahaError(
			`WAHA ${method} ${path}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * Детерминированное имя сессии WAHA для линии портала — без промежуточного
 * состояния в Redis: виджет логина и вебхук входящих находят друг друга по
 * одному и тому же имени. WAHA ограничивает имя сессии 54 символами, а
 * memberId (Bitrix) и connectorId вместе могут быть длиннее — поэтому имя
 * строится из хэша тройки, а не из конкатенации сырых значений.
 */
/** connectorId на практике не всегда уникален на номер (встречаются слоты
 * со статическим connectorId без случайного суффикса) — openLineId в хэше
 * обязателен, иначе два номера на разных линиях с одинаковым connectorId
 * получат одну и ту же WAHA-сессию и упрутся в unique(session_name) в БД. */
export function waSessionName(
	memberId: string,
	openLineId: string,
	connectorId: string,
): string {
	const hash = createHash("sha256")
		.update(`${memberId}:${openLineId}:${connectorId}`)
		.digest("hex")
		.slice(0, 40);
	return `wa_${hash}`;
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
	me?: {
		id?: string;
		pushName?: string;
		reachoutTimelock?: WahaReachoutTimelock | null;
	} | null;
	config?: Record<string, unknown> & {
		webhooks?: Array<{
			url?: string;
			events?: string[];
			[key: string]: unknown;
		}>;
	};
}

export interface WahaReachoutTimelock {
	enforcementType?: string;
	isActive?: boolean;
	/** Unix timestamp в секундах. */
	timeEnforcementEnds?: number;
}

export type WahaAccountHealth = "connected" | "limited" | "error";

export interface WahaSessionHealth {
	status: WahaAccountHealth;
	error: string | null;
}

/**
 * Приводит техническое состояние WAHA к состоянию, которое можно безопасно
 * показывать оператору и использовать перед отправкой. Reachout Timelock
 * WhatsApp блокирует обращения к новым контактам; сознательно блокируем на
 * это время всю исходящую отправку, чтобы не усугублять антиспам-ограничение.
 */
export function wahaSessionHealth(
	session: Pick<WahaSession, "status" | "me"> | null,
	nowSeconds = Math.floor(Date.now() / 1000),
): WahaSessionHealth {
	if (!session) {
		return { status: "error", error: "Сессия WAHA не найдена" };
	}
	if (session.status !== "WORKING") {
		return {
			status: "error",
			error: `Сессия WhatsApp отключена (WAHA: ${session.status}) — переподключите номер`,
		};
	}

	const lock = session.me?.reachoutTimelock;
	const lockEnds = lock?.timeEnforcementEnds ?? 0;
	if (lock?.isActive && lockEnds > nowSeconds) {
		return {
			status: "limited",
			error: `WhatsApp временно ограничил исходящие сообщения до ${new Date(lockEnds * 1000).toISOString()}`,
		};
	}
	return { status: "connected", error: null };
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
									events: [
										"message",
										"message.ack",
										"presence.update",
										"session.status",
									],
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

/**
 * QR-код для входа без pairing code — WAHA генерирует его автоматически
 * параллельно с pairing code, пока сессия не в статусе WORKING, так что оба
 * способа можно предлагать одновременно. `data` — base64 PNG.
 */
export async function wahaGetQrCode(
	session: string,
): Promise<{ mimetype: string; data: string } | null> {
	try {
		return await wahaFetch<{ mimetype: string; data: string }>(
			`/api/${session}/auth/qr`,
		);
	} catch {
		// QR мог ещё не сгенерироваться или сессия уже перешла в другой режим —
		// не фатально, виджет просто останется на pairing code.
		return null;
	}
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
 *
 * Возвращаем `id` отправленного сообщения из ответа WAHA — по нему потом
 * сопоставляется вебхук `message.ack` (см. wahaAckToStatus) со строкой в
 * bot_messages. Если конкретная версия WAHA не вернёт id в этой форме —
 * статус просто не продвинется дальше "sent", без ошибки.
 */
export async function wahaSendText(
	session: string,
	chatId: string,
	text: string,
): Promise<{ id?: string }> {
	const before = wahaSessionHealth(await wahaGetSession(session));
	if (before.status !== "connected") {
		throw new WahaError(before.error ?? "Сессия WhatsApp не готова к отправке");
	}
	await wahaSimulateTyping(session, chatId, text.length).catch(() => {});
	const res = await wahaFetch<{ id?: string } | undefined>("/api/sendText", {
		method: "POST",
		body: { session, chatId, text },
	});

	// WAHA отвечает 201, когда приняла команду, но WhatsApp может сразу после
	// этого отозвать связанное устройство (401 device_removed). Короткая
	// проверка не является повторной отправкой и защищает UI от ложного «ушло».
	await new Promise((resolve) => setTimeout(resolve, 3_000));
	const after = wahaSessionHealth(await wahaGetSession(session));
	if (after.status !== "connected") {
		throw new WahaError(
			after.error ?? "WhatsApp отключил сессию сразу после отправки",
		);
	}
	return { id: res?.id };
}

/**
 * Отправка фото/файла/голосового в чат WhatsApp. Байты передаются как base64
 * в теле запроса (`file.data`) — в отличие от wahaSendText, здесь нет публичного
 * URL, по которому WAHA могла бы сама скачать вложение (оно только что
 * загружено оператором в наше S3, см. packages/api/message-attachment-storage),
 * а сетевая доступность нашего бакета из контейнера WAHA не гарантирована.
 */
export async function wahaSendFile(
	session: string,
	chatId: string,
	attachment: {
		bytes: Uint8Array;
		fileName: string;
		mimeType: string;
		kind: "image" | "file" | "voice";
	},
	caption?: string,
): Promise<{ id?: string }> {
	const before = wahaSessionHealth(await wahaGetSession(session));
	if (before.status !== "connected") {
		throw new WahaError(before.error ?? "Сессия WhatsApp не готова к отправке");
	}
	const mediaType = attachment.mimeType.split(";", 1)[0]?.trim().toLowerCase();
	const sendAsVoice =
		attachment.kind === "voice" &&
		(mediaType === "audio/ogg" || mediaType === "audio/opus");
	const endpoint =
		attachment.kind === "image"
			? "/api/sendImage"
			: sendAsVoice
				? "/api/sendVoice"
				: "/api/sendFile";
	const data = Buffer.from(attachment.bytes).toString("base64");
	const res = await wahaFetch<{ id?: string } | undefined>(endpoint, {
		method: "POST",
		body: {
			session,
			chatId,
			file: {
				mimetype: attachment.mimeType,
				filename: attachment.fileName,
				data,
			},
			...(caption ? { caption } : {}),
		},
	});

	// Та же короткая проверка сессии после отправки, что и в wahaSendText —
	// WAHA может принять команду (201), а WhatsApp сразу после этого отозвать
	// связанное устройство.
	await new Promise((resolve) => setTimeout(resolve, 3_000));
	const after = wahaSessionHealth(await wahaGetSession(session));
	if (after.status !== "connected") {
		throw new WahaError(
			after.error ?? "WhatsApp отключил сессию сразу после отправки",
		);
	}
	return { id: res?.id };
}

/** Имитирует обычный ответ оператора: коротко показывает набор текста. */
export async function wahaSimulateTyping(
	session: string,
	chatId: string,
	textLength: number,
): Promise<void> {
	await wahaFetch<void>("/api/startTyping", {
		method: "POST",
		body: { session, chatId },
	});
	// Ограниченный джиттер: снижает «машинный» паттерн, но не подвешивает UI.
	const baseDelay = Math.min(2_500, Math.max(700, textLength * 20));
	const jitter = Math.floor(Math.random() * 500);
	await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
	await wahaFetch<void>("/api/stopTyping", {
		method: "POST",
		body: { session, chatId },
	});
}

/** Удаляет сообщение из WhatsApp-диалога для обеих сторон. */
export async function wahaDeleteMessage(
	session: string,
	chatId: string,
	messageId: string,
): Promise<void> {
	await wahaFetch<void>(
		`/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
		{ method: "DELETE" },
	);
}

export interface WahaPresence {
	participant: string;
	lastKnownPresence:
		| "online"
		| "offline"
		| "typing"
		| "recording"
		| "paused"
		| (string & {});
	/** Unix timestamp в секундах; null, если WhatsApp не раскрыл точное время. */
	lastSeen: number | null;
}

export interface WahaChatPresence {
	id: string;
	presences: WahaPresence[];
}

const presenceWebhookConfigured = new Set<string>();

/**
 * Довключает presence.update в уже существующую WAHA-сессию. Это позволяет
 * обновить старые подключения без удаления сессии и повторного pairing.
 */
async function wahaEnsurePresenceWebhook(session: string): Promise<void> {
	if (presenceWebhookConfigured.has(session) || !env.WAHA_WEBHOOK_URL) return;

	const current = await wahaGetSession(session);
	if (!current) return;
	const currentConfig = current.config ?? {};
	const webhooks = [...(currentConfig.webhooks ?? [])];
	const index = webhooks.findIndex(
		(webhook) => webhook.url === env.WAHA_WEBHOOK_URL,
	);
	const existing = index >= 0 ? webhooks[index] : undefined;
	const requiredEvents = [
		"message",
		"message.ack",
		"presence.update",
		"session.status",
	];
	if (requiredEvents.every((event) => existing?.events?.includes(event))) {
		presenceWebhookConfigured.add(session);
		return;
	}

	const webhook = {
		...existing,
		url: env.WAHA_WEBHOOK_URL,
		events: Array.from(
			new Set([...(existing?.events ?? []), ...requiredEvents]),
		),
		...(env.WAHA_WEBHOOK_SECRET
			? { hmac: { key: env.WAHA_WEBHOOK_SECRET } }
			: {}),
		retries: { policy: "constant", delaySeconds: 2, attempts: 5 },
	};
	if (index >= 0) webhooks[index] = webhook;
	else webhooks.push(webhook);

	await wahaFetch<WahaSession>(`/api/sessions/${encodeURIComponent(session)}`, {
		method: "PUT",
		body: {
			name: session,
			config: { ...currentConfig, webhooks },
		},
	});
	presenceWebhookConfigured.add(session);
}

/** Запрашивает текущий presence и одновременно подписывает WAHA на
 * последующие presence.update для этого диалога. */
export async function wahaGetChatPresence(
	session: string,
	chatId: string,
): Promise<WahaChatPresence> {
	await wahaEnsurePresenceWebhook(session);
	return wahaFetch<WahaChatPresence>(
		`/api/${encodeURIComponent(session)}/presence/${encodeURIComponent(chatId)}`,
	);
}

/** sent | delivered | read | failed — см. packages/db BotMessageEntry.status. */
export type MessageDeliveryStatus = "sent" | "delivered" | "read" | "failed";

/**
 * Маппинг ack-события WAHA (`message.ack`) на наш статус доставки.
 * WAHA присылает и числовой `ack`, и строковый `ackName` — ориентируемся
 * в первую очередь на имя (устойчивее к версии WAHA), с числом как fallback.
 * Значения ack в NOWEB-движке WAHA: -1 ERROR, 0 PENDING, 1 SERVER (принято
 * сервером WhatsApp), 2 DEVICE (доставлено устройству), 3 READ, 4 PLAYED.
 * Неизвестные/промежуточные значения — `null`, статус не меняем.
 */
export function wahaAckToStatus(payload: {
	ack?: number;
	ackName?: string;
}): MessageDeliveryStatus | null {
	const name = payload.ackName?.toUpperCase();
	if (name === "ERROR" || payload.ack === -1) return "failed";
	if (name === "DEVICE" || payload.ack === 2) return "delivered";
	if (name === "READ" || name === "PLAYED" || (payload.ack ?? 0) >= 3) {
		return "read";
	}
	return null;
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

/** Номер текущей WAHA-сессии совпадает с номером, который ввёл оператор. */
export function wahaSessionPhoneMatches(
	session: Pick<WahaSession, "me">,
	phone: string,
): boolean {
	const expected = phone.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7");
	const actual = session.me?.id?.replace(/@c\.us$/, "").replace(/\D/g, "");
	return Boolean(actual && actual === expected);
}
