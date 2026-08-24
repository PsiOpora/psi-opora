import {
	createTelegramFetch,
	resolveMaxBotToken,
	resolveTelegramApiRoot,
	resolveTelegramBotToken,
} from "@psi-opora/bot-core";
import { logger } from "@psi-opora/config";
import { RUSSIAN_TRUSTED_ROOT_CA } from "./certs/russian-trusted-ca";
import { fetchWithCa } from "./fetch-with-ca";

export type Messenger = "telegram" | "max";

// Как и apps/tg-bot (packages/bot-core/src/bot.ts) — вычисляются один раз
// при загрузке модуля, чтобы ответы операторов из apps/clients/apps/dashboard
// тоже уходили через TG_API_PROXY_* (Vercel), когда он включён, а не мимо.
const telegramApiRoot = resolveTelegramApiRoot();
const telegramFetch = createTelegramFetch();

/** Inline-кнопка: text — подпись, payload — callback data. */
export interface MessengerButton {
	text: string;
	payload: string;
}

/**
 * Лимиты мессенджеров на отправку от бота:
 * - Telegram Bot API: ~30 сообщений/сек суммарно на бота при массовой
 *   рассылке (и не чаще 1 сообщения/сек в один и тот же чат); при
 *   превышении приходит 429 с parameters.retry_after.
 * - MAX Bot API: точный лимит не публикуется, при превышении — HTTP 429.
 *
 * Держим темп 10 сообщений/сек (пауза 100 мс между отправками) — втрое ниже
 * лимита Telegram, а на 429 дополнительно ждём указанное время и повторяем.
 * Каждому контакту уходит одно сообщение, так что лимит «1/сек в один чат»
 * не нарушается по построению.
 */
export const SEND_INTERVAL_MS = 100;

const RATE_LIMIT_ATTEMPTS = 3;

export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Сообщения отправляются с Markdown-разметкой (легаси-режим Telegram:
 * *жирный*, _курсив_, `код`, [ссылка](url); MAX — format "markdown").
 * Если мессенджер отклоняет разметку (400, например непарные символы),
 * сообщение повторно уходит обычным текстом — рассылка не падает.
 */
async function sendTelegram(
	userId: string,
	text: string,
	buttons?: MessengerButton[][],
): Promise<string | undefined> {
	const token = await resolveTelegramBotToken();
	if (!token) throw new Error("Токен Telegram-бота не задан в БД");

	const replyMarkup = buttons?.length
		? {
				inline_keyboard: buttons.map((row) =>
					row.map((b) => ({ text: b.text, callback_data: b.payload })),
				),
			}
		: undefined;

	let withMarkdown = true;
	for (let attempt = 1; attempt <= RATE_LIMIT_ATTEMPTS + 1; attempt++) {
		const res = await telegramFetch(
			`${telegramApiRoot}/bot${token}/sendMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: userId,
					text,
					...(replyMarkup ? { reply_markup: replyMarkup } : {}),
					...(withMarkdown ? { parse_mode: "Markdown" } : {}),
				}),
			},
		);
		const json = (await res.json()) as {
			ok: boolean;
			description?: string;
			parameters?: { retry_after?: number };
			result?: { message_id?: number };
		};
		if (json.ok) {
			logger.info("messenger.send.ok", {
				messenger: "telegram",
				userId,
				attempt,
			});
			return json.result?.message_id != null
				? String(json.result.message_id)
				: undefined;
		}
		if (
			res.status === 400 &&
			withMarkdown &&
			/parse entities/i.test(json.description ?? "")
		) {
			logger.warn("messenger.send.retry.markdown_fallback", {
				messenger: "telegram",
				userId,
				attempt,
				description: json.description,
			});
			withMarkdown = false;
			continue;
		}
		if (res.status === 429) {
			const waitSec = (json.parameters?.retry_after ?? 2) + 1;
			logger.warn("messenger.send.retry.rate_limited", {
				messenger: "telegram",
				userId,
				attempt,
				waitSec,
			});
			// Telegram сам говорит, сколько ждать; добавляем секунду сверху
			await sleep(waitSec * 1000);
			continue;
		}
		logger.error("messenger.send.failed", undefined, {
			messenger: "telegram",
			userId,
			attempt,
			status: res.status,
			description: json.description,
		});
		throw new Error(json.description ?? `Telegram HTTP ${res.status}`);
	}
	logger.error("messenger.send.failed", undefined, {
		messenger: "telegram",
		userId,
		reason: "rate_limit_exhausted",
		attempts: RATE_LIMIT_ATTEMPTS,
	});
	throw new Error(
		`Telegram: лимит запросов (429) не снялся после ${RATE_LIMIT_ATTEMPTS} попыток`,
	);
}

async function sendMax(
	userId: string,
	text: string,
	buttons?: MessengerButton[][],
): Promise<string | undefined> {
	const token = await resolveMaxBotToken();
	if (!token) throw new Error("Токен MAX-бота не задан в БД");

	const attachments = buttons?.length
		? [
				{
					type: "inline_keyboard",
					payload: {
						buttons: buttons.map((row) =>
							row.map((b) => ({
								type: "callback",
								text: b.text,
								payload: b.payload,
							})),
						),
					},
				},
			]
		: undefined;

	let withMarkdown = true;
	for (let attempt = 1; attempt <= RATE_LIMIT_ATTEMPTS + 1; attempt++) {
		const url = new URL("https://platform-api2.max.ru/messages");
		url.searchParams.set("user_id", userId);
		const res = await fetchWithCa(
			url,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: token },
				body: JSON.stringify({
					text,
					...(attachments ? { attachments } : {}),
					...(withMarkdown ? { format: "markdown" } : {}),
				}),
			},
			RUSSIAN_TRUSTED_ROOT_CA,
		);
		if (res.ok) {
			const json = (await res.json().catch(() => null)) as {
				message?: { body?: { mid?: string } };
				body?: { mid?: string };
			} | null;
			logger.info("messenger.send.ok", {
				messenger: "max",
				userId,
				attempt,
			});
			return json?.message?.body?.mid ?? json?.body?.mid;
		}
		if (res.status === 400 && withMarkdown) {
			logger.warn("messenger.send.retry.markdown_fallback", {
				messenger: "max",
				userId,
				attempt,
			});
			withMarkdown = false;
			continue;
		}
		if (res.status === 429) {
			const retryAfter = Number(res.headers.get("retry-after"));
			const waitSec =
				Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter + 1 : 3;
			logger.warn("messenger.send.retry.rate_limited", {
				messenger: "max",
				userId,
				attempt,
				waitSec,
			});
			await sleep(waitSec * 1000);
			continue;
		}
		const json = (await res.json().catch(() => null)) as {
			message?: string;
		} | null;
		logger.error("messenger.send.failed", undefined, {
			messenger: "max",
			userId,
			attempt,
			status: res.status,
			description: json?.message,
		});
		throw new Error(json?.message ?? `MAX HTTP ${res.status}`);
	}
	logger.error("messenger.send.failed", undefined, {
		messenger: "max",
		userId,
		reason: "rate_limit_exhausted",
		attempts: RATE_LIMIT_ATTEMPTS,
	});
	throw new Error(
		`MAX: лимит запросов (429) не снялся после ${RATE_LIMIT_ATTEMPTS} попыток`,
	);
}

/** Отправка одного сообщения пользователю мессенджера с обработкой 429. */
export async function sendMessengerMessage(
	messenger: Messenger,
	userId: string,
	text: string,
	buttons?: MessengerButton[][],
): Promise<string | undefined> {
	if (messenger === "telegram") return sendTelegram(userId, text, buttons);
	return sendMax(userId, text, buttons);
}

async function editTelegramMessage(
	userId: string,
	externalId: string,
	text: string,
): Promise<void> {
	const token = await resolveTelegramBotToken();
	if (!token) throw new Error("Токен Telegram-бота не задан в БД");

	let withMarkdown = true;
	for (let attempt = 1; attempt <= 2; attempt++) {
		const res = await telegramFetch(
			`${telegramApiRoot}/bot${token}/editMessageText`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: userId,
					message_id: Number(externalId),
					text,
					...(withMarkdown ? { parse_mode: "Markdown" } : {}),
				}),
			},
		);
		const json = (await res.json()) as {
			ok: boolean;
			description?: string;
		};
		if (json.ok) return;
		// Внешнее редактирование могло пройти, а локальная запись — нет. При
		// повторе Telegram сообщает "not modified"; считаем это успехом, чтобы
		// API смог синхронизировать локальный текст.
		if (/message is not modified/i.test(json.description ?? "")) return;
		if (
			res.status === 400 &&
			withMarkdown &&
			/parse entities/i.test(json.description ?? "")
		) {
			withMarkdown = false;
			continue;
		}
		throw new Error(json.description ?? `Telegram HTTP ${res.status}`);
	}
}

async function editMaxMessage(externalId: string, text: string): Promise<void> {
	const token = await resolveMaxBotToken();
	if (!token) throw new Error("Токен MAX-бота не задан в БД");

	let withMarkdown = true;
	for (let attempt = 1; attempt <= 2; attempt++) {
		const url = new URL("https://platform-api2.max.ru/messages");
		url.searchParams.set("message_id", externalId);
		const res = await fetchWithCa(
			url,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json", Authorization: token },
				body: JSON.stringify({
					text,
					...(withMarkdown ? { format: "markdown" } : {}),
				}),
			},
			RUSSIAN_TRUSTED_ROOT_CA,
		);
		const json = (await res.json().catch(() => null)) as {
			success?: boolean;
			message?: string;
		} | null;
		if (res.ok && json?.success !== false) return;
		if (res.status === 400 && withMarkdown) {
			withMarkdown = false;
			continue;
		}
		throw new Error(json?.message ?? `MAX HTTP ${res.status}`);
	}
}

/** Редактирует ранее отправленное ботом текстовое сообщение. */
export async function editMessengerMessage(
	messenger: Messenger,
	userId: string,
	externalId: string,
	text: string,
): Promise<void> {
	if (messenger === "telegram") {
		await editTelegramMessage(userId, externalId, text);
	} else {
		await editMaxMessage(externalId, text);
	}
}

async function deleteTelegramMessage(
	userId: string,
	externalId: string,
): Promise<void> {
	const token = await resolveTelegramBotToken();
	if (!token) throw new Error("Токен Telegram-бота не задан в БД");

	const res = await telegramFetch(
		`${telegramApiRoot}/bot${token}/deleteMessage`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: userId,
				message_id: Number(externalId),
			}),
		},
	);
	const json = (await res.json()) as {
		ok: boolean;
		description?: string;
	};
	if (!json.ok) {
		throw new Error(json.description ?? `Telegram HTTP ${res.status}`);
	}
}

async function deleteMaxMessage(externalId: string): Promise<void> {
	const token = await resolveMaxBotToken();
	if (!token) throw new Error("Токен MAX-бота не задан в БД");

	const url = new URL("https://platform-api2.max.ru/messages");
	url.searchParams.set("message_id", externalId);
	const res = await fetchWithCa(
		url,
		{
			method: "DELETE",
			headers: { Authorization: token },
		},
		RUSSIAN_TRUSTED_ROOT_CA,
	);
	const json = (await res.json().catch(() => null)) as {
		success?: boolean;
		message?: string;
	} | null;
	if (!res.ok || json?.success === false) {
		throw new Error(json?.message ?? `MAX HTTP ${res.status}`);
	}
}

/** Удаляет ранее отправленное ботом сообщение у клиента. */
export async function deleteMessengerMessage(
	messenger: Messenger,
	userId: string,
	externalId: string,
): Promise<void> {
	if (messenger === "telegram") {
		await deleteTelegramMessage(userId, externalId);
	} else {
		await deleteMaxMessage(externalId);
	}
}

async function setTelegramWebhook(): Promise<void> {
	const token = await resolveTelegramBotToken();
	const webhookUrl = process.env.TG_WEBHOOK_URL;
	if (!token) throw new Error("Токен Telegram-бота не задан в БД");
	if (!webhookUrl) throw new Error("TG_WEBHOOK_URL не задан");

	const url = `${webhookUrl.replace(/\/$/, "")}`;
	const res = await telegramFetch(`${telegramApiRoot}/bot${token}/setWebhook`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url, drop_pending_updates: true }),
	});
	const json = (await res.json()) as { ok: boolean; description?: string };
	if (!json.ok) {
		throw new Error(json.description ?? `Telegram HTTP ${res.status}`);
	}
}

async function setMaxWebhook(): Promise<void> {
	const token = await resolveMaxBotToken();
	const webhookUrl = process.env.MAX_WEBHOOK_URL;
	if (!token) throw new Error("Токен MAX-бота не задан в БД");
	if (!webhookUrl) throw new Error("MAX_WEBHOOK_URL не задан");

	const url = `${webhookUrl.replace(/\/$/, "")}`;
	const res = await fetchWithCa(
		new URL("https://platform-api2.max.ru/subscriptions"),
		{
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: token },
			body: JSON.stringify({ url }),
		},
		RUSSIAN_TRUSTED_ROOT_CA,
	);
	if (!res.ok) {
		const json = (await res.json().catch(() => null)) as {
			message?: string;
		} | null;
		throw new Error(json?.message ?? `MAX HTTP ${res.status}`);
	}
}

/**
 * Настраивает вебхук бота на наш деплой (`{WEBHOOK_URL}`) —
 * вызывается автоматически при активации канала в Контакт-центре
 * (packages/api/src/routers/bot-connector), заменяет ручной запуск
 * apps/tg-bot|max-bot/scripts/set-webhook.ts.
 */
export async function setMessengerWebhook(messenger: Messenger): Promise<void> {
	if (messenger === "telegram") await setTelegramWebhook();
	else await setMaxWebhook();
}

async function fetchTelegramUsername(): Promise<string> {
	const token = await resolveTelegramBotToken();
	if (!token) throw new Error("Токен Telegram-бота не задан в БД");

	const res = await telegramFetch(`${telegramApiRoot}/bot${token}/getMe`);
	const json = (await res.json().catch(() => null)) as {
		ok?: boolean;
		description?: string;
		result?: { username?: string };
	} | null;
	if (!json?.ok) {
		throw new Error(json?.description ?? `Telegram HTTP ${res.status}`);
	}
	const username = json.result?.username?.trim();
	if (!username) throw new Error("Telegram не вернул username бота");
	return username;
}

async function fetchMaxUsername(): Promise<string> {
	const token = await resolveMaxBotToken();
	if (!token) throw new Error("Токен MAX-бота не задан в БД");

	const res = await fetchWithCa(
		new URL("https://platform-api2.max.ru/me"),
		{ headers: { Authorization: token } },
		RUSSIAN_TRUSTED_ROOT_CA,
	);
	const json = (await res.json().catch(() => null)) as {
		username?: string;
		message?: string;
	} | null;
	if (!res.ok) {
		throw new Error(json?.message ?? `MAX HTTP ${res.status}`);
	}
	const username = json?.username?.trim();
	if (!username) throw new Error("MAX не вернул username бота");
	return username;
}

/**
 * Username бота из самого мессенджера (Telegram getMe / MAX GET /me) по
 * токену из bot_connectors. Нужен дашборду, чтобы собрать ссылку-диплинк
 * `?start=<кодовое слово>` для кампаний: в схеме БД отдельного поля под
 * username нет, значение кэшируется в bot_texts (TG_BOT_USERNAME_KEY /
 * MAX_BOT_USERNAME_KEY) и может быть поправлено вручную.
 */
export async function resolveMessengerBotUsername(
	messenger: Messenger,
): Promise<string> {
	return messenger === "telegram"
		? fetchTelegramUsername()
		: fetchMaxUsername();
}
