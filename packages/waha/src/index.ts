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
 * строится из хэша пары, а не из конкатенации сырых значений.
 */
/** connectorId уже уникален на номер (в отличие от lineId, где на одной
 * линии теперь может быть несколько номеров) — включаем его в имя сессии,
 * иначе два номера на одной линии получили бы одну и ту же WAHA-сессию. */
export function waSessionName(memberId: string, connectorId: string): string {
	const hash = createHash("sha256")
		.update(`${memberId}:${connectorId}`)
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
	me?: { id?: string; pushName?: string } | null;
	config?: Record<string, unknown> & {
		webhooks?: Array<{
			url?: string;
			events?: string[];
			[key: string]: unknown;
		}>;
	};
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
									events: ["message", "message.ack", "presence.update"],
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
	const res = await wahaFetch<{ id?: string } | undefined>("/api/sendText", {
		method: "POST",
		body: { session, chatId, text },
	});
	return { id: res?.id };
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
	if (existing?.events?.includes("presence.update")) {
		presenceWebhookConfigured.add(session);
		return;
	}

	const webhook = {
		...existing,
		url: env.WAHA_WEBHOOK_URL,
		events: Array.from(
			new Set([
				...(existing?.events ?? ["message", "message.ack"]),
				"presence.update",
			]),
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
