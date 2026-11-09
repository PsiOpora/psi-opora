import {
	type BitrixApi,
	resolveCalendarBitrixApi,
} from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import { z } from "zod";
import type { Messenger } from "./messenger";
import {
	addCalendarEventOnce,
	type CalendarEventMatch,
	takeOverConsultationEvent,
} from "./reminders/calendar-events";
import {
	appendReminderSentComment,
	botDeliveryLabel,
	DEAL_CATEGORY_ID,
	extractClientContactId,
	normalizeConsultationDt,
	sendReminderBotMessage,
	sendReminderWhatsappMessage,
} from "./reminders/shared";

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
/**
 * Сообщение клиенту на стадии «ждем оплату» уходит не сразу, а через минуту
 * после перехода сделки в эту стадию — если стадия за это время не сменилась.
 * Так менеджер успевает исправить ошибочный перенос, пока клиент ничего не получил.
 */
export const PAYMENT_MESSAGE_GRACE_MS = 60_000;
const calendarEventIdSchema = z
	.union([z.number(), z.string()])
	.pipe(z.coerce.number<string | number>().int().positive());
const DIAGNOSTIC_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
	timeZone: "Europe/Moscow",
	dateStyle: "long",
	timeStyle: "short",
});

interface DiagnosticScheduleState {
	calendarEventId: number;
	calendarEventAdopted?: CalendarEventMatch["source"];
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

export interface DiagnosticDealUpdateOptions {
	/**
	 * Ставит повторную обработку сделки через `delaySeconds`. Без неё отправка
	 * сообщения на стадии оплаты не откладывается (иначе оно бы потерялось).
	 */
	scheduleRecheck?: (dealId: number, delaySeconds: number) => Promise<void>;
	now?: () => number;
	/**
	 * Обработать сделку, даже если блокировка занята. Только для повторной
	 * проверки, исчерпавшей попытки: отправка всё равно защищена состоянием в
	 * Redis (lastChatStageId), а блокировка, занятая дольше минуты, — зависшая.
	 */
	skipLock?: boolean;
}

function stateKey(dealId: number): string {
	return `diagnostic-schedule:deal:${dealId}`;
}

function recheckKey(dealId: number, deadlineMs: number): string {
	return `diagnostic-schedule:recheck:${dealId}:${deadlineMs}`;
}

/**
 * Момент (мс), раньше которого сообщение на стадии оплаты слать нельзя.
 * Отсчёт идёт от MOVED_TIME (момент смены стадии в Bitrix24), а не от прихода
 * события — иначе запоздавшее событие добавило бы к задержке ещё минуту.
 * Без валидного MOVED_TIME не откладываем (возвращаем 0): лучше отправить
 * сразу, чем потерять сообщение.
 */
function paymentGraceDeadlineMs(
	deal: Record<string, unknown>,
	nowMs: number,
): number {
	const movedAt =
		typeof deal.MOVED_TIME === "string"
			? Date.parse(deal.MOVED_TIME)
			: Number.NaN;
	if (!Number.isFinite(movedAt)) {
		console.warn(
			`[diagnostic-schedule] у сделки ${String(deal.ID)} нет корректного MOVED_TIME — отправляем без задержки`,
		);
		return 0;
	}
	// min — защита от расхождения часов с Bitrix24 (MOVED_TIME «в будущем»):
	// ждём не дольше одной минуты от текущего момента.
	return Math.min(movedAt, nowMs) + PAYMENT_MESSAGE_GRACE_MS;
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
			"После заполнения всех данных в форме обязательно нажмите кнопку «Применить» — тогда купон активируется, и вы увидите сумму со скидкой 50%: 5 000 ₽ вместо 10 000 ₽ за диагностическую консультацию.",
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
	messenger?: Messenger | "whatsapp-personal";
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
	options: DiagnosticDealUpdateOptions = {},
): Promise<DiagnosticDealUpdateResult> {
	const token = crypto.randomUUID();
	const key = lockKey(dealId);
	const acquired = await redis.set(key, token, { px: LOCK_TTL_MS, nx: true });
	if (!acquired && !options.skipLock) {
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
		const phone = contactPhone(contact);
		const description = eventDescription({
			dealId,
			clientName,
			email,
			phone,
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
		let calendarEventAdopted = previous?.calendarEventAdopted;
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
				calendarEventId = await takeOverConsultationEvent(
					calendarApi,
					redis,
					dealId,
					fields,
				);
				if (calendarEventId) {
					calendarEventAdopted = undefined;
					action = "updated";
				} else {
					({ id: calendarEventId, adopted: calendarEventAdopted } =
						await addCalendarEventOnce(calendarApi, fields, { dealId, phone }));
					if (!calendarEventId) {
						throw new Error("Bitrix24 не вернул ID события");
					}
					action = "created";
				}
			} else if (
				previous?.diagnosticAt !== diagnosticAt &&
				calendarEventAdopted === "phone"
			) {
				// Ручную запись не переносим: ищем совпадение на новом времени.
				({ id: calendarEventId, adopted: calendarEventAdopted } =
					await addCalendarEventOnce(calendarApi, fields, { dealId, phone }));
				if (!calendarEventId) throw new Error("Bitrix24 не вернул ID события");
				action = "created";
			} else if (previous?.diagnosticAt !== diagnosticAt) {
				try {
					const updated = await calendarApi.call<unknown>(
						"calendar.event.update",
						{ id: calendarEventId, ...fields },
					);
					// Событие могли удалить в календаре — тогда update не возвращает ID.
					calendarEventId = calendarEventIdSchema.parse(updated);
					action = "updated";
				} catch (error) {
					console.warn(
						`[diagnostic-schedule] событие ${calendarEventId} не обновлено, создаём заново: ${(error as Error).message}`,
					);
					({ id: calendarEventId, adopted: calendarEventAdopted } =
						await addCalendarEventOnce(calendarApi, fields, { dealId, phone }));
					if (!calendarEventId) throw error;
					action = "created";
				}
			}
		} catch (error) {
			console.error(
				`[diagnostic-schedule] не удалось синхронизировать событие календаря для сделки ${dealId}: ${(error as Error).message}`,
			);
			calendarEventId = previous?.calendarEventId ?? 0;
			calendarEventAdopted = previous?.calendarEventAdopted;
		}

		let state: DiagnosticScheduleState = {
			calendarEventId,
			calendarEventAdopted,
			diagnosticAt,
			lastChatStageId: previous?.lastChatStageId,
			lastEmailStageId: previous?.lastEmailStageId,
			updatedAt: new Date().toISOString(),
		};
		await redis.set(stateKey(dealId), state, { ex: STATE_TTL_SECONDS });

		// Отложенная отправка: если сделка только что перешла на «ждем оплату»,
		// клиенту пока ничего не шлём, а ставим повторную обработку на момент
		// окончания минуты. Она заново прочитает сделку — и если менеджер за это
		// время вернул стадию, сообщение не уйдёт (stage_mismatch выше).
		let deliveryDeferred = false;
		if (
			options.scheduleRecheck &&
			stageId === PAYMENT_PENDING_STAGE_ID &&
			(state.lastChatStageId !== stageId || state.lastEmailStageId !== stageId)
		) {
			const nowMs = (options.now ?? Date.now)();
			const deadlineMs = paymentGraceDeadlineMs(deal, nowMs);
			const remainingMs = deadlineMs - nowMs;
			if (deadlineMs > 0 && remainingMs > 0) {
				deliveryDeferred = true;
				// События по одной сделке приходят пачкой (в т.ч. от нашего же
				// комментария в таймлайне) — одного перезапуска на срок достаточно.
				const reserved = await redis.set(recheckKey(dealId, deadlineMs), true, {
					px: remainingMs + 5 * 60_000,
					nx: true,
				});
				if (reserved) {
					try {
						await options.scheduleRecheck(
							dealId,
							Math.ceil(remainingMs / 1000) + 1,
						);
					} catch (error) {
						// Не смогли поставить перезапуск — не теряем сообщение, шлём сразу.
						console.error(
							`[diagnostic-schedule] не удалось отложить отправку для сделки ${dealId}: ${(error as Error).message}`,
						);
						await redis.del(recheckKey(dealId, deadlineMs));
						deliveryDeferred = false;
					}
				}
			}
		}

		let paymentUrl = "";
		if (stageId === PAYMENT_PENDING_STAGE_ID && !deliveryDeferred) {
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

		let chat: DiagnosticDealUpdateResult["chat"] = deliveryDeferred
			? "skipped"
			: "already_sent";
		let chatReason: string | undefined = deliveryDeferred
			? "grace_period"
			: undefined;
		let botMessenger: Messenger | "whatsapp-personal" | undefined;
		const chatDeliveryNeeded =
			!deliveryDeferred && state.lastChatStageId !== stageId;
		if (chatDeliveryNeeded) {
			if (stageId === PAYMENT_PENDING_STAGE_ID && !paymentUrl) {
				chat = "error";
				chatReason = "payment_url_not_configured";
			} else {
				const result = await sendBot({ deal, contact, message });
				chat = result.status;
				chatReason = result.reason;
				botMessenger = result.messenger;

				// Клиент без Telegram/MAX (например, писал только в WhatsApp) —
				// пробуем личный номер WhatsApp (WAHA) по телефону контакта.
				if (chat !== "sent") {
					const whatsappResult = await sendReminderWhatsappMessage(
						contact,
						message,
					);
					if (whatsappResult.status === "sent") {
						chat = "sent";
						chatReason = undefined;
						botMessenger = whatsappResult.messenger;
					} else {
						chatReason = `${chatReason}; whatsapp: ${whatsappResult.reason}`;
					}
				}
			}
			// Ошибка фиксируется как завершённая попытка для этой стадии. Иначе
			// timeline-комментарий сам вызывает OnCrmDealUpdate и создаёт цикл.
			state = { ...state, lastChatStageId: stageId };
			await redis.set(stateKey(dealId), state, { ex: STATE_TTL_SECONDS });
		}

		let emailStatus: DiagnosticDealUpdateResult["email"] = deliveryDeferred
			? "skipped"
			: "already_sent";
		let emailReason: string | undefined = deliveryDeferred
			? "grace_period"
			: undefined;
		const emailDeliveryNeeded =
			!deliveryDeferred && state.lastEmailStageId !== stageId;
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
