import type { BitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { jidFromPhone, wahaSendText } from "@psi-opora/waha";
import { sendMessengerMessage, type Messenger } from "../messenger";

/**
 * Общие константы и хелперы для напоминаний о консультации и диагностике
 * (см. consultation-reminders.ts и diagnostic-reminders.ts). Портал
 * psi-opora.bitrix24.ru: воронка и стадии сделки, на которых отслеживаем
 * даты встреч (см. старый Bitrix-модуль
 * calls_consultation_reminders/config/app_config.php).
 */
export const DEAL_CATEGORY_ID = 0;
export const DEAL_STAGE_IDS = ["UC_WWIO8W"];
export const MESSENGER_FIELD = "UF_CRM_1779643796551";

// Значения поля сделки "Мессенджер" → наш бот, через которого отправляем
// сообщение напрямую. Открытые линии Bitrix24 для доставки не используются.
export const MESSENGER_BOT_MAP: Record<string, Messenger> = {
	"326": "max",
	"328": "telegram",
};

/** Нормализует дату из поля сделки к ISO-строке; Bitrix отдаёт datetime уже со смещением. */
export function normalizeConsultationDt(raw: unknown): string | null {
	const value = String(raw ?? "").trim();
	if (!value) return null;
	const ts = new Date(value).getTime();
	return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

export function toTimestamp(iso: string): number {
	const ts = new Date(iso).getTime();
	return Number.isFinite(ts) ? ts : 0;
}

/** Время встречи по Москве для подстановки в шаблон напоминания, напр. "11:00". */
export function formatConsultationTime(iso: string): string {
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(iso));
}

export function renderReminderMessage(
	template: string,
	vars: { name: string; time: string },
): string {
	return template
		.replaceAll("{name}", vars.name)
		.replaceAll("{time}", vars.time);
}

/** Дата и время по Москве для комментария в таймлайне сделки, напр. "23.07.2026, 14:05". */
export function formatMoscowDateTime(date: Date = new Date()): string {
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
		dateStyle: "short",
		timeStyle: "short",
	}).format(date);
}

/**
 * Отмечает в таймлайне сделки, что напоминание реально ушло клиенту —
 * иначе по одной сделке не видно, сработал ли крон, до какого канала
 * достучался и когда. Ошибки не пробрасываются: отсутствие комментария
 * не должно считаться сбоем отправки самого напоминания.
 */
export async function appendReminderSentComment(
	api: BitrixApi,
	dealId: number,
	comment: string,
): Promise<void> {
	try {
		await api.call("crm.timeline.comment.add", {
			fields: {
				ENTITY_ID: dealId,
				ENTITY_TYPE: "deal",
				COMMENT: comment,
			},
		});
	} catch (err) {
		console.error(
			`[reminder] не удалось добавить комментарий к сделке ${dealId}: ${(err as Error).message}`,
		);
	}
}

export function extractClientContactId(deal: Record<string, unknown>): number {
	const contactId = Number(deal.CONTACT_ID ?? 0);
	if (contactId > 0) return contactId;

	const ids = deal.CONTACT_IDS;
	if (Array.isArray(ids) && ids.length > 0) {
		const first = Number(ids[0] ?? 0);
		return first > 0 ? first : 0;
	}
	return 0;
}

interface ContactIm {
	VALUE?: string;
	VALUE_TYPE?: string;
}

export interface DirectBotTarget {
	messenger: Messenger;
	userId: string;
}

export type BotDeliveryResult =
	| { status: "sent"; messenger: Messenger | "whatsapp-personal"; userId: string }
	| { status: "skipped" | "error"; reason: string };

function messengerFromImType(raw: unknown): Messenger | null {
	const type = String(raw ?? "")
		.trim()
		.toLowerCase();
	if (type.includes("telegram")) return "telegram";
	if (type === "max" || type.endsWith("|max") || type.includes("max.ru")) {
		return "max";
	}
	return null;
}

/**
 * Находит ID пользователя нашего бота в IM-поле контакта. Сначала учитывает
 * выбранный в сделке мессенджер, затем использует любой валидный Telegram/MAX
 * ID контакта. VALUE должен быть числовым ID пользователя, а не ID чата
 * Открытой линии.
 */
export function resolveDirectBotTarget(
	deal: Record<string, unknown>,
	contact: { IM?: ContactIm[] } | false,
): DirectBotTarget | null {
	const preferred = MESSENGER_BOT_MAP[String(deal[MESSENGER_FIELD] ?? "")];
	const targets = (contact ? (contact.IM ?? []) : [])
		.map((entry): DirectBotTarget | null => {
			const messenger = messengerFromImType(entry.VALUE_TYPE);
			const userId = String(entry.VALUE ?? "").trim();
			return messenger && /^\d+$/.test(userId) ? { messenger, userId } : null;
		})
		.filter((target): target is DirectBotTarget => target !== null);

	return (
		targets.find((target) => target.messenger === preferred) ??
		targets[0] ??
		null
	);
}

export function botDeliveryLabel(
	messenger: Messenger | "whatsapp-personal",
): string {
	if (messenger === "whatsapp-personal") return "WhatsApp";
	return messenger === "telegram" ? "Telegram-бот" : "MAX-бот";
}

/**
 * Пишет автосообщение в журнал bot_messages, чтобы напоминание было видно в
 * истории диалога (вкладка CRM и инбокс «Клиенты») рядом с ответом клиента, а
 * не только комментарием в таймлайне сделки. Неудачная отправка тоже
 * записывается — со статусом "failed", который инбокс показывает как
 * «не доставлено»; иначе провал выглядел бы как «сообщения не было».
 *
 * Ленивый импорт queries: клиент БД подключается на верхнем уровне модуля
 * (top-level await + проверка POSTGRES_URL), статический импорт ронял бы
 * индексацию Hatchet-задач при деплое, где БД недоступна (как в
 * hatchet/broadcast.ts). Ошибка записи не должна отменять сам факт отправки.
 */
async function logReminderMessage(params: {
	target: { messenger: Messenger | "whatsapp-personal"; userId: string };
	text: string;
	status: "sent" | "failed";
	externalId?: string;
	connectorId?: string;
}): Promise<void> {
	const text = params.text.trim();
	if (!text) return;
	try {
		const { insertBotMessage, listBotMessages } = await import(
			"@psi-opora/db/queries"
		);
		// Крон повторяет попытку каждые 5 минут, пока встреча в окне напоминания,
		// поэтому у заблокировавшего бота клиента одна и та же неудача набежала бы
		// десятком записей «не доставлено». Достаточно одной отметки на текст.
		if (params.status === "failed") {
			const recent = await listBotMessages(
				params.target.messenger,
				params.target.userId,
				10,
			);
			const alreadyMarked = recent.some(
				(row) =>
					row.direction === "out" &&
					row.status === "failed" &&
					row.text === text,
			);
			if (alreadyMarked) return;
		}
		await insertBotMessage({
			messenger: params.target.messenger,
			userId: params.target.userId,
			direction: "out",
			source: "reminder",
			text,
			status: params.status,
			externalId: params.externalId,
			connectorId: params.connectorId,
		});
	} catch (err) {
		console.error(
			`[reminder] не удалось записать сообщение в журнал (${params.target.messenger} ${params.target.userId}): ${(err as Error).message}`,
		);
	}
}

/** Отправляет уведомление напрямую через нашего Telegram/MAX-бота. */
export async function sendReminderBotMessage(
	deal: Record<string, unknown>,
	contact: { IM?: ContactIm[] } | false,
	message: string,
): Promise<BotDeliveryResult> {
	const target = resolveDirectBotTarget(deal, contact);
	if (!target) {
		return { status: "skipped", reason: "bot_target_not_found" };
	}

	try {
		const externalId = await sendMessengerMessage(
			target.messenger,
			target.userId,
			message,
		);
		await logReminderMessage({
			target,
			text: message,
			status: "sent",
			externalId,
		});
		return { status: "sent", ...target };
	} catch (error) {
		await logReminderMessage({ target, text: message, status: "failed" });
		return {
			status: "error",
			reason: `bot_send_failed: ${(error as Error).message}`,
		};
	}
}

interface ContactPhone {
	VALUE?: string;
}

export function extractContactPhone(
	contact: { PHONE?: ContactPhone[] } | false,
): string | null {
	if (!contact) return null;
	const value = String(contact.PHONE?.[0]?.VALUE ?? "").trim();
	return value || null;
}

interface WhatsappTarget {
	sessionName: string;
	connectorId: string;
	jid: string;
}

/**
 * Резолвит канал WhatsApp Personal (WAHA) по телефону контакта — единственный
 * устойчивый идентификатор для WhatsApp (в отличие от Telegram/MAX здесь нет
 * IM-записи, см. resolveDirectBotTarget). Берёт первый подключённый номер
 * портала, как и CRM-виджет (resolveContact в
 * packages/api/src/routers/widget-message/helpers.ts) — несколько
 * одновременно подключённых номеров на практике не встречаются.
 */
async function resolveWhatsappTarget(
	contact: { PHONE?: ContactPhone[] } | false,
): Promise<WhatsappTarget | null> {
	const phone = extractContactPhone(contact);
	if (!phone || !env.BITRIX_MEMBER_ID) return null;

	const { listWhatsappPersonalAccounts } = await import("@psi-opora/db/queries");
	const account = (
		await listWhatsappPersonalAccounts(env.BITRIX_MEMBER_ID)
	).find((a) => a.status === "connected");
	if (!account) return null;

	return {
		sessionName: account.sessionName,
		connectorId: account.connectorId,
		jid: jidFromPhone(phone),
	};
}

/**
 * Отправляет уведомление через личный номер WhatsApp (WAHA) — канал для
 * клиентов без Telegram/MAX-бота (см. sendReminderBotMessage), но с
 * телефоном в CRM и подключённым к порталу номером WhatsApp.
 */
export async function sendReminderWhatsappMessage(
	contact: { PHONE?: ContactPhone[] } | false,
	message: string,
): Promise<BotDeliveryResult> {
	const target = await resolveWhatsappTarget(contact);
	if (!target) {
		return { status: "skipped", reason: "whatsapp_target_not_found" };
	}

	try {
		const { id } = await wahaSendText(target.sessionName, target.jid, message);
		await logReminderMessage({
			target: { messenger: "whatsapp-personal", userId: target.jid },
			text: message,
			status: "sent",
			externalId: id,
			connectorId: target.connectorId,
		});
		return { status: "sent", messenger: "whatsapp-personal", userId: target.jid };
	} catch (error) {
		await logReminderMessage({
			target: { messenger: "whatsapp-personal", userId: target.jid },
			text: message,
			status: "failed",
			connectorId: target.connectorId,
		});
		return {
			status: "error",
			reason: `whatsapp_send_failed: ${(error as Error).message}`,
		};
	}
}
