import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import { CONSULTATION_STATE_TTL_SECONDS, consultationStateKey } from "./shared";

/**
 * Защита календаря Андрея Клюева от дублей. Раньше в одно и то же время
 * оказывались несколько записей об одном клиенте:
 *  - событие бесплатной консультации оставалось в календаре, когда сделку
 *    переводили на диагностику, а диагностика создавала рядом своё;
 *  - Андрей сам заносит запись в календарь (обычно с телефоном клиента),
 *    а автоматика добавляла ещё одну.
 */

export interface BitrixCalendarEvent {
	ID?: string | number;
	NAME?: string;
	DESCRIPTION?: string;
	DATE_FROM?: string;
	DATE_TO?: string;
	TZ_OFFSET_FROM?: string | number;
	TZ_OFFSET_TO?: string | number;
	DT_SKIP_TIME?: string;
	DELETED?: string;
	UF_CRM_CAL_EVENT?: string[] | null;
}

export interface CalendarEventMatch {
	id: number;
	source: "deal" | "phone";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PHONE_PATTERN = /\+?\d[\d\s()-]{8,}\d/g;

/** Последние 10 цифр номера — так +7…, 8… и 7… совпадают между собой. */
export function phoneKey(phone: string): string {
	const digits = phone.replace(/\D/g, "");
	return digits.length >= 10 ? digits.slice(-10) : "";
}

function textHasPhone(text: string, key: string): boolean {
	for (const match of text.match(PHONE_PATTERN) ?? []) {
		if (phoneKey(match) === key) return true;
	}
	return false;
}

const LOCAL_DATE_PATTERN =
	/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * "28.09.2026 18:00:00" в поясе события + TZ_OFFSET_* (сек) → UTC, мс.
 * DATE_FROM_TS_UTC использовать нельзя: для события в 18:00 МСК портал
 * отдаёт там 12:00Z, а у повторяющихся — начало/конец всей серии, тогда
 * как DATE_FROM/DATE_TO приходят для конкретного вхождения.
 */
function localToUtc(value: unknown, offsetSeconds: unknown): number | null {
	const m = LOCAL_DATE_PATTERN.exec(String(value ?? ""));
	const offset = Number(offsetSeconds ?? 0);
	if (!m || !Number.isFinite(offset)) return null;
	const [, dd, mm, yyyy, hh, min, ss] = m;
	const wallClock = Date.UTC(
		Number(yyyy),
		Number(mm) - 1,
		Number(dd),
		Number(hh),
		Number(min),
		Number(ss ?? 0),
	);
	return wallClock - offset * 1000;
}

function eventRange(event: BitrixCalendarEvent): [number, number] | null {
	const from = localToUtc(event.DATE_FROM, event.TZ_OFFSET_FROM);
	if (from === null) return null;
	const to = localToUtc(event.DATE_TO, event.TZ_OFFSET_TO);
	return [from, to !== null && to > from ? to : from];
}

/**
 * Ищет среди событий календаря уже существующую запись о той же встрече:
 * пересекается по времени и либо привязана к этой же сделке, либо содержит
 * телефон клиента в названии/описании (ручная запись Андрея). Привязка к
 * сделке надёжнее, поэтому она в приоритете.
 */
export function findDuplicateCalendarEvent(
	events: BitrixCalendarEvent[],
	params: { dealId: number; phone: string; from: Date; to: Date },
): CalendarEventMatch | null {
	const dealRef = `D_${params.dealId}`;
	const key = phoneKey(params.phone);
	const from = params.from.getTime();
	const to = params.to.getTime();
	let phoneMatch: CalendarEventMatch | null = null;

	for (const event of events) {
		const id = Number(event.ID ?? 0);
		if (!id || event.DELETED === "Y" || event.DT_SKIP_TIME === "Y") continue;
		const range = eventRange(event);
		if (!range || range[0] >= to || range[1] <= from) continue;

		if (event.UF_CRM_CAL_EVENT?.includes(dealRef)) {
			return { id, source: "deal" };
		}
		const text = `${event.NAME ?? ""}\n${event.DESCRIPTION ?? ""}`;
		if (!phoneMatch && key && textHasPhone(text, key)) {
			phoneMatch = { id, source: "phone" };
		}
	}
	return phoneMatch;
}

function toDateParam(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * calendar.event.add, но сначала проверяет, нет ли в календаре владельца
 * уже записи об этой встрече. Событие этой же сделки обновляется нашими
 * полями; ручная запись по телефону клиента не трогается — её текст пишет
 * Андрей. Ошибка поиска не мешает созданию: лучше дубль, чем пропавшая
 * запись.
 */
export async function addCalendarEventOnce(
	calendarApi: BitrixApi,
	fields: Record<string, unknown>,
	params: { dealId: number; phone: string },
): Promise<{ id: number; adopted?: CalendarEventMatch["source"] }> {
	const from = new Date(String(fields.from));
	const to = new Date(String(fields.to));

	try {
		const events = await calendarApi.call<BitrixCalendarEvent[]>(
			"calendar.event.get",
			{
				type: fields.type,
				ownerId: fields.ownerId,
				from: toDateParam(from.getTime() - DAY_MS),
				to: toDateParam(to.getTime() + DAY_MS),
			},
		);
		const match = findDuplicateCalendarEvent(events ?? [], {
			...params,
			from,
			to,
		});
		if (match) {
			if (match.source === "deal") {
				await calendarApi.call("calendar.event.update", {
					id: match.id,
					...fields,
				});
			}
			console.log(
				`[calendar-dedup] сделка ${params.dealId}: в календаре уже есть событие ${match.id} (${match.source}), новое не создаём`,
			);
			return { id: match.id, adopted: match.source };
		}
	} catch (error) {
		console.warn(
			`[calendar-dedup] сделка ${params.dealId}: не удалось проверить календарь на дубли: ${(error as Error).message}`,
		);
	}

	const id = Number(
		await calendarApi.call("calendar.event.add", {
			...fields,
			auto_detect_section: "Y",
		}),
	);
	return { id };
}

interface ConsultationCalendarState {
	calendarEventId?: number;
}

/**
 * Сделку перевели с бесплатной консультации на диагностику: вместо нового
 * события переносим и переименовываем событие консультации, если оно ещё
 * не прошло (прошедшая консультация — это история встреч, её не трогаем).
 * Событие отвязывается от состояния консультации, чтобы её обработчик
 * больше его не менял. Возвращает ID события или 0, если забрать нечего.
 */
export async function takeOverConsultationEvent(
	calendarApi: BitrixApi,
	redis: RedisClient,
	dealId: number,
	fields: Record<string, unknown>,
): Promise<number> {
	const key = consultationStateKey(dealId);
	const state = await redis.get<ConsultationCalendarState>(key);
	const eventId = Number(state?.calendarEventId ?? 0);
	if (!state || !eventId) return 0;

	try {
		const event = await calendarApi.call<BitrixCalendarEvent | null>(
			"calendar.event.getbyid",
			{ id: eventId },
		);
		const range = event && event.DELETED !== "Y" ? eventRange(event) : null;
		if (!range || range[0] < Date.now()) return 0;

		await calendarApi.call("calendar.event.update", { id: eventId, ...fields });
	} catch (error) {
		console.warn(
			`[calendar-dedup] сделка ${dealId}: не удалось перенести событие консультации ${eventId} на диагностику: ${(error as Error).message}`,
		);
		return 0;
	}

	await redis.set(
		key,
		{ ...state, calendarEventId: undefined },
		{ ex: CONSULTATION_STATE_TTL_SECONDS },
	);
	console.log(
		`[calendar-dedup] сделка ${dealId}: событие консультации ${eventId} перенесено на диагностику`,
	);
	return eventId;
}
