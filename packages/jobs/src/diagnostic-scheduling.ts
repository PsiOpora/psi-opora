import {
	type BitrixApi,
	resolveCalendarBitrixApi,
} from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import {
	appendReminderSentComment,
	botDeliveryLabel,
	DEAL_CATEGORY_ID,
	extractClientContactId,
	normalizeConsultationDt,
	sendReminderBotMessage,
} from "./reminders/shared";
import type { Messenger } from "./messenger";

export const DIAGNOSTIC_DT_FIELD = "UF_CRM_1779871551489";
export const PAYMENT_PENDING_STAGE_ID = "UC_PV8XUM";
export const PAID_DIAGNOSTIC_STAGE_ID = "UC_DI3Y04";
export const DIAGNOSTIC_STAGE_IDS = [
	PAYMENT_PENDING_STAGE_ID,
	PAID_DIAGNOSTIC_STAGE_ID,
] as const;

export const DIAGNOSTIC_JOIN_URL = "https://psi-opora.ktalk.ru/smd1srvdssx9";
export const DIAGNOSTIC_PAYMENT_URL =
	"https://psi-opora.ru/product/diagnostics/";
export const DIAGNOSTIC_DISCOUNT_COUPON = "dia5000";

const DIAGNOSTIC_DURATION_MS = 90 * 60 * 1000;
const STATE_TTL_SECONDS = 366 * 24 * 60 * 60;
const LOCK_TTL_MS = 60_000;
const DIAGNOSTIC_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
	timeZone: "Europe/Moscow",
	dateStyle: "long",
	timeStyle: "short",
});

interface DiagnosticScheduleState {
	calendarEventId: number;
	diagnosticAt: string;
	lastChatStageId?: string;
	lastEmailStageId?: string;
	updatedAt: string;
}

interface ContactEmail {
	VALUE?: string;
}

interface ContactPhone {
	VALUE?: string;
}

interface ContactIm {
	VALUE?: string;
	VALUE_TYPE?: string;
}

interface DiagnosticContact {
	ID?: string | number;
	NAME?: string;
	LAST_NAME?: string;
	EMAIL?: ContactEmail[];
	PHONE?: ContactPhone[];
	IM?: ContactIm[];
}

export interface DiagnosticDealUpdateResult {
	action: "created" | "updated" | "unchanged" | "skip";
	reason?: string;
	calendarEventId?: number;
	chat: "sent" | "already_sent" | "skipped" | "error";
	email: "sent" | "already_sent" | "skipped" | "error";
	chatReason?: string;
	emailReason?: string;
}

function stateKey(dealId: number): string {
	return `diagnostic-schedule:deal:${dealId}`;
}

function lockKey(dealId: number): string {
	return `diagnostic-schedule:lock:${dealId}`;
}

// ID 1 — Андрей Клюев в Bitrix24. Владелец события по умолчанию, чтобы
// диагностика всегда попадала именно в его календарь.
function diagnosticOwnerUserId(): number {
	const configured = Number(process.env.BITRIX_DIAGNOSTIC_USER_ID ?? 1);
	return Number.isInteger(configured) && configured > 0 ? configured : 1;
}

export function findContactEmail(contact: DiagnosticContact | false): string {
	if (!contact) return "";
	for (const item of contact.EMAIL ?? []) {
		const email = String(item.VALUE ?? "").trim();
		if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
	}
	return "";
}

function contactName(contact: DiagnosticContact | false): string {
	if (!contact) return "";
	return [contact.NAME, contact.LAST_NAME]
		.map((value) => String(value ?? "").trim())
		.filter(Boolean)
		.join(" ");
}

function contactPhone(contact: DiagnosticContact | false): string {
	if (!contact) return "";
	return String(contact.PHONE?.[0]?.VALUE ?? "").trim();
}

function formatDiagnosticDate(iso: string): string {
	return DIAGNOSTIC_DATE_FORMATTER.format(new Date(iso));
}

function eventName(deal: Record<string, unknown>, clientName: string): string {
	const suffix = clientName || String(deal.TITLE ?? "").trim();
	return suffix ? `Диагностика — ${suffix}` : "Диагностика";
}

function eventDescription(params: {
	dealId: number;
	clientName: string;
	email: string;
	phone: string;
}): string {
	return [
		params.clientName ? `Клиент: ${params.clientName}` : "",
		params.phone ? `Телефон: ${params.phone}` : "",
		params.email ? `Email: ${params.email}` : "",
		`Сделка Bitrix24: D_${params.dealId}`,
		`Подключение: ${DIAGNOSTIC_JOIN_URL}`,
	]
		.filter(Boolean)
		.join("\n");
}

function calendarFields(params: {
	dealId: number;
	contactId: number;
	diagnosticAt: string;
	name: string;
	description: string;
}): Record<string, unknown> {
	const startsAt = new Date(params.diagnosticAt);
	const endsAt = new Date(startsAt.getTime() + DIAGNOSTIC_DURATION_MS);
	return {
		type: "user",
		ownerId: diagnosticOwnerUserId(),
		name: params.name,
		description: params.description,
		from: startsAt.toISOString(),
		to: endsAt.toISOString(),
		skip_time: "N",
		timezone_from: "Europe/Moscow",
		timezone_to: "Europe/Moscow",
		accessibility: "busy",
		importance: "high",
		private_event: "N",
		is_meeting: "N",
		location: DIAGNOSTIC_JOIN_URL,
		remind: [{ type: "min", count: 15 }],
		crm_fields: [
			`D_${params.dealId}`,
			...(params.contactId > 0 ? [`C_${params.contactId}`] : []),
		],
	};
}

function firstUrl(value: unknown): string {
	const text = Array.isArray(value)
		? value.map(String).join(" ")
		: String(value ?? "");
	return text.match(/https?:\/\/[^\s<>"']+/)?.[0] ?? "";
}

export function resolvePaymentUrl(
	deal: Record<string, unknown>,
	dealFields: Record<string, unknown> = {},
): string {
	const configured = process.env.DIAGNOSTIC_PAYMENT_URL?.trim();
	if (configured) return configured;

	for (const [fieldId, definition] of Object.entries(dealFields)) {
		const labels = definition as {
			formLabel?: string;
			listLabel?: string;
			title?: string;
		};
		const label = [labels.formLabel, labels.listLabel, labels.title]
			.filter(Boolean)
			.join(" ");
		if (!/(ссылк.*оплат|оплат.*ссылк)/i.test(label)) continue;
		const url = firstUrl(deal[fieldId]);
		if (url) return url;
	}
	return DIAGNOSTIC_PAYMENT_URL;
}

export function buildImmediateDiagnosticMessage(params: {
	clientName: string;
	diagnosticAt: string;
	stageId: string;
	paymentUrl?: string;
}): string {
	const greeting = params.clientName
		? `${params.clientName}, здравствуйте!`
		: "Здравствуйте!";
	const when = formatDiagnosticDate(params.diagnosticAt);

	if (params.stageId === PAYMENT_PENDING_STAGE_ID) {
		return [
			greeting,
			`Мы запланировали вашу диагностическую консультацию с психологом Андреем Клюевым на ${when} (по московскому времени).`,
			`Для новых клиентов в течение первой недели действует скидка 50% на диагностическую консультацию. ❤️\n\nПри оплате используйте купон ${DIAGNOSTIC_DISCOUNT_COUPON} — по нему стоимость консультации составит 5 000 ₽ вместо 10 000 ₽.`,
			`Ссылка на оплату:\n${params.paymentUrl ?? ""}`,
			`Ссылка для подключения к онлайн-диагностике:\n${DIAGNOSTIC_JOIN_URL}`,
			"Подключиться можно с телефона или компьютера. Пожалуйста, заранее выберите спокойное место, где вас никто не будет отвлекать.",
		].join("\n\n");
	}

	return [
		greeting,
		`Оплата получена. Ваша диагностическая консультация с психологом Андреем Клюевым состоится ${when} (по московскому времени).`,
		`Ссылка для подключения к онлайн-диагностике:\n${DIAGNOSTIC_JOIN_URL}`,
		"Подключиться можно с телефона или компьютера. Пожалуйста, заранее выберите спокойное место, где вас никто не будет отвлекать.",
	].join("\n\n");
}

async function sendBot(params: {
	deal: Record<string, unknown>;
	contact: DiagnosticContact | false;
	message: string;
}): Promise<{
	status: "sent" | "skipped" | "error";
	reason?: string;
	messenger?: Messenger;
}> {
	return sendReminderBotMessage(params.deal, params.contact, params.message);
}

async function releaseLock(
	redis: RedisClient,
	key: string,
	token: string,
): Promise<void> {
	await redis.eval(
		"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
		[key],
		[token],
	);
}

export async function handleDiagnosticDealUpdate(
	api: BitrixApi,
	redis: RedisClient,
	dealId: number,
): Promise<DiagnosticDealUpdateResult> {
	const token = crypto.randomUUID();
	const key = lockKey(dealId);
	const acquired = await redis.set(key, token, { px: LOCK_TTL_MS, nx: true });
	if (!acquired) {
		return {
			action: "skip",
			reason: "locked",
			chat: "skipped",
			email: "skipped",
		};
	}

	try {
		const deal = await api.call<Record<string, unknown> | false>(
			"crm.deal.get",
			{ id: dealId },
		);
		if (!deal) {
			return {
				action: "skip",
				reason: "deal_not_found",
				chat: "skipped",
				email: "skipped",
			};
		}
		if (Number(deal.CATEGORY_ID ?? -1) !== DEAL_CATEGORY_ID) {
			return {
				action: "skip",
				reason: "category_mismatch",
				chat: "skipped",
				email: "skipped",
			};
		}

		const stageId = String(deal.STAGE_ID ?? "");
		if (!DIAGNOSTIC_STAGE_IDS.includes(stageId as never)) {
			return {
				action: "skip",
				reason: "stage_mismatch",
				chat: "skipped",
				email: "skipped",
			};
		}

		const diagnosticAt = normalizeConsultationDt(deal[DIAGNOSTIC_DT_FIELD]);
		if (!diagnosticAt) {
			return {
				action: "skip",
				reason: "diagnostic_dt_empty_or_invalid",
				chat: "skipped",
				email: "skipped",
			};
		}

		const contactId = extractClientContactId(deal);
		const contact =
			contactId > 0
				? await api.call<DiagnosticContact | false>("crm.contact.get", {
						id: contactId,
					})
				: false;
		const clientName = contactName(contact);
		const email = findContactEmail(contact);
		const description = eventDescription({
			dealId,
			clientName,
			email,
			phone: contactPhone(contact),
		});
		const fields = calendarFields({
			dealId,
			contactId,
			diagnosticAt,
			name: eventName(deal, clientName),
			description,
		});

		const previous =
			(await redis.get<DiagnosticScheduleState>(stateKey(dealId))) ?? undefined;
		let calendarEventId = previous?.calendarEventId ?? 0;
		let action: DiagnosticDealUpdateResult["action"] = "unchanged";

		// calendar.event.add/update в чужой календарь (ownerId != вызывающий)
		// проверяет права именно вызывающего OAuth-пользователя — если он их
		// не имеет (сменились права/уволен), Bitrix24 отдаёт "Доступ запрещен"
		// независимо от прав ownerId. Админский вебхук от этого не зависит,
		// поэтому используем его здесь, если настроен, а не переданный `api`.
		const calendarApi = resolveCalendarBitrixApi() ?? api;

		// Ошибка календаря (например, "Доступ запрещен" из-за прав на чужой
		// календарь в Bitrix24) не должна останавливать всю обработку — иначе
		// сообщение клиенту об оплате/подключении к диагностике вообще не
		// уйдёт, а каждый повторный ONCRMDEALUPDATE будет заново падать здесь.
		try {
			if (!calendarEventId) {
				calendarEventId = Number(
					await calendarApi.call("calendar.event.add", {
						...fields,
						auto_detect_section: "Y",
					}),
				);
				if (!calendarEventId) throw new Error("Bitrix24 не вернул ID события");
				action = "created";
			} else if (previous?.diagnosticAt !== diagnosticAt) {
				try {
					await calendarApi.call("calendar.event.update", {
						id: calendarEventId,
						...fields,
					});
					action = "updated";
				} catch (error) {
					console.warn(
						`[diagnostic-schedule] событие ${calendarEventId} не обновлено, создаём заново: ${(error as Error).message}`,
					);
					calendarEventId = Number(
						await calendarApi.call("calendar.event.add", {
							...fields,
							auto_detect_section: "Y",
						}),
					);
					if (!calendarEventId) throw error;
					action = "created";
				}
			}
		} catch (error) {
			console.error(
				`[diagnostic-schedule] не удалось синхронизировать событие календаря для сделки ${dealId}: ${(error as Error).message}`,
			);
			calendarEventId = previous?.calendarEventId ?? 0;
		}

		let state: DiagnosticScheduleState = {
			calendarEventId,
			diagnosticAt,
			lastChatStageId: previous?.lastChatStageId,
			lastEmailStageId: previous?.lastEmailStageId,
			updatedAt: new Date().toISOString(),
		};
		await redis.set(stateKey(dealId), state, { ex: STATE_TTL_SECONDS });

		let paymentUrl = "";
		if (stageId === PAYMENT_PENDING_STAGE_ID) {
			const dealFields =
				await api.call<Record<string, unknown>>("crm.deal.fields");
			paymentUrl = resolvePaymentUrl(deal, dealFields);
		}
		const message = buildImmediateDiagnosticMessage({
			clientName,
			diagnosticAt,
			stageId,
			paymentUrl,
		});

		let chat: DiagnosticDealUpdateResult["chat"] = "already_sent";
		let chatReason: string | undefined;
		let botMessenger: Messenger | undefined;
		const chatDeliveryNeeded = state.lastChatStageId !== stageId;
		if (chatDeliveryNeeded) {
			if (stageId === PAYMENT_PENDING_STAGE_ID && !paymentUrl) {
				chat = "error";
				chatReason = "payment_url_not_configured";
			} else {
				const result = await sendBot({ deal, contact, message });
				chat = result.status;
				chatReason = result.reason;
				botMessenger = result.messenger;
			}
			// Ошибка фиксируется как завершённая попытка для этой стадии. Иначе
			// timeline-комментарий сам вызывает OnCrmDealUpdate и создаёт цикл.
			state = { ...state, lastChatStageId: stageId };
			await redis.set(stateKey(dealId), state, { ex: STATE_TTL_SECONDS });
		}

		let emailStatus: DiagnosticDealUpdateResult["email"] = "already_sent";
		let emailReason: string | undefined;
		const emailDeliveryNeeded = state.lastEmailStageId !== stageId;
		if (emailDeliveryNeeded) {
			if (!email) {
				emailStatus = "skipped";
				emailReason = "contact_email_empty";
				state = { ...state, lastEmailStageId: stageId };
				await redis.set(stateKey(dealId), state, {
					ex: STATE_TTL_SECONDS,
				});
			} else if (stageId === PAYMENT_PENDING_STAGE_ID && !paymentUrl) {
				emailStatus = "error";
				emailReason = "payment_url_not_configured";
			} else {
				try {
					const { sendDiagnosticEmail } = await import("./diagnostic-email");
					await sendDiagnosticEmail({
						to: email,
						subject:
							stageId === PAYMENT_PENDING_STAGE_ID
								? "Диагностическая консультация: оплата и подключение"
								: "Диагностическая консультация: ссылка для подключения",
						text: message,
					});
					emailStatus = "sent";
				} catch (error) {
					emailStatus = "error";
					emailReason = (error as Error).message;
				}
			}
			// Не повторяем неуспешную отправку на каждом техническом обновлении
			// сделки. Новая попытка будет при следующей целевой стадии.
			state = { ...state, lastEmailStageId: stageId };
			await redis.set(stateKey(dealId), state, {
				ex: STATE_TTL_SECONDS,
			});
		}

		const delivery = [
			chat === "sent" && botMessenger ? botDeliveryLabel(botMessenger) : "",
			emailStatus === "sent" ? `email ${email}` : "",
		]
			.filter(Boolean)
			.join(" и ");
		const deliveryProblems = [
			chatDeliveryNeeded && chat !== "sent" ? `бот: ${chatReason ?? chat}` : "",
			emailDeliveryNeeded && emailStatus !== "sent"
				? `email: ${emailReason ?? emailStatus}`
				: "",
		]
			.filter(Boolean)
			.join("; ");
		if (action !== "unchanged" || chatDeliveryNeeded || emailDeliveryNeeded) {
			await appendReminderSentComment(
				api,
				dealId,
				[
					`📅 Диагностика записана в календарь Андрея Клюева на ${formatDiagnosticDate(diagnosticAt)}, длительность 1,5 часа.`,
					delivery ? `Клиенту отправлено: ${delivery}.` : "",
					deliveryProblems
						? `Не отправлено по отдельным каналам: ${deliveryProblems}.`
						: "",
					`Событие #${calendarEventId} — ${new Date().toISOString()}`,
				]
					.filter(Boolean)
					.join("\n"),
			);
		}

		return {
			action,
			calendarEventId,
			chat,
			email: emailStatus,
			chatReason,
			emailReason,
		};
	} finally {
		await releaseLock(redis, key, token);
	}
}
