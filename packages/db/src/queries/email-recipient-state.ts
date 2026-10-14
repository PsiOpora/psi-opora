/**
 * Чистая логика статуса получателя email-рассылки — без обращения к БД,
 * чтобы её можно было покрыть тестами. Используется в email-events.ts.
 */

export type EmailEventType =
	| "sent"
	| "delivered"
	| "opened"
	| "clicked"
	| "soft_bounced"
	| "bounced"
	| "complained"
	| "unsubscribed"
	| "failed";

export const EMAIL_EVENT_TYPES: readonly EmailEventType[] = [
	"sent",
	"delivered",
	"opened",
	"clicked",
	"soft_bounced",
	"bounced",
	"complained",
	"unsubscribed",
	"failed",
];

/** События, после которых адрес попадает в глобальный стоп-лист. */
export const SUPPRESSING_EVENTS: Partial<
	Record<EmailEventType, "bounced" | "complained" | "unsubscribed">
> = {
	bounced: "bounced",
	complained: "complained",
	unsubscribed: "unsubscribed",
};

export interface RecipientTrackingState {
	status: string;
	error: string | null;
	sentAt: Date | null;
	deliveredAt: Date | null;
	openedAt: Date | null;
	clickedAt: Date | null;
	bouncedAt: Date | null;
	complainedAt: Date | null;
	unsubscribedAt: Date | null;
	openCount: number;
	clickCount: number;
	lastEventAt: Date | null;
}

/**
 * Итоговый статус по отметкам времени. Негативные исходы важнее прогресса
 * доставки: отписавшийся после открытия получатель показывается как
 * «отписался», а не «открыл». Если отметок нет — статус остаётся прежним
 * (pending/imported/sent/error).
 */
export function deriveRecipientStatus(state: RecipientTrackingState): string {
	if (state.complainedAt) return "complained";
	if (state.unsubscribedAt) return "unsubscribed";
	if (state.bouncedAt) return "bounced";
	if (state.clickedAt) return "clicked";
	if (state.openedAt) return "opened";
	if (state.deliveredAt) return "delivered";
	if (
		state.sentAt &&
		(state.status === "pending" || state.status === "imported")
	)
		return "sent";
	return state.status;
}

function earliest(current: Date | null, at: Date): Date {
	return current && current <= at ? current : at;
}

/**
 * Применяет событие к состоянию получателя. События приходят не по порядку
 * (вебхуки ретраятся, порядок не гарантирован), поэтому отметки времени
 * хранят самое раннее наблюдение, а статус выводится из отметок, а не из
 * последнего пришедшего события.
 */
export function applyEmailEvent(
	state: RecipientTrackingState,
	event: { type: EmailEventType; occurredAt: Date; details?: string | null },
): RecipientTrackingState {
	const at = event.occurredAt;
	const next: RecipientTrackingState = { ...state };
	next.lastEventAt =
		state.lastEventAt && state.lastEventAt > at ? state.lastEventAt : at;

	switch (event.type) {
		case "sent":
			next.sentAt = earliest(state.sentAt, at);
			break;
		case "delivered":
			next.deliveredAt = earliest(state.deliveredAt, at);
			break;
		case "opened":
			// Открытие доказывает доставку, даже если вебхук delivered потерялся.
			next.openedAt = earliest(state.openedAt, at);
			next.deliveredAt = earliest(state.deliveredAt, at);
			next.openCount = state.openCount + 1;
			break;
		case "clicked":
			// Клик без зафиксированного открытия — картинки отключены у
			// получателя; считаем письмо открытым, как это делают ESP.
			next.clickedAt = earliest(state.clickedAt, at);
			next.openedAt = earliest(state.openedAt, at);
			next.deliveredAt = earliest(state.deliveredAt, at);
			next.clickCount = state.clickCount + 1;
			if (state.openCount === 0) next.openCount = 1;
			break;
		case "bounced":
			next.bouncedAt = earliest(state.bouncedAt, at);
			next.error = event.details ?? state.error;
			break;
		case "complained":
			next.complainedAt = earliest(state.complainedAt, at);
			break;
		case "unsubscribed":
			next.unsubscribedAt = earliest(state.unsubscribedAt, at);
			break;
		case "soft_bounced":
			// Временный отказ — провайдер повторит попытку сам; статус не меняем,
			// событие остаётся в журнале.
			break;
		case "failed":
			if (!state.deliveredAt) {
				next.status = "error";
				next.error = event.details ?? state.error ?? "Ошибка отправки";
			}
			break;
	}

	next.status = deriveRecipientStatus(next);
	return next;
}
