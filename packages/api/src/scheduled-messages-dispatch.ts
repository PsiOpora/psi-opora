import { resolveBitrixApiForRequest } from "@psi-opora/bitrix-client";
import {
	claimDueScheduledMessages,
	failOverdueScheduledMessages,
	failStaleSendingScheduledMessages,
	finishScheduledMessage,
	type ScheduledMessage,
} from "@psi-opora/db/queries";
import { sendClientMessage } from "./routers/messages/send";
import { sendWidgetMessage } from "./routers/widget-message/send";
import { inboxMessengerSchema } from "./schemas/messages";

/** Сколько ждать запоздавшее сообщение (воркер не работал): дальше отправлять
 * уже неуместно — «напишу завтра в 10:00» к вечеру теряет смысл. */
export const SCHEDULED_MAX_OVERDUE_MS = 6 * 60 * 60 * 1000;
/** Дольше этого сообщение не может быть «в отправке» — воркер упал. Больше
 * таймаута задачи Hatchet, чтобы не принять работающий запуск за упавший. */
const STALE_SENDING_MS = 15 * 60 * 1000;
const CLAIM_BATCH_SIZE = 5;
/** Бюджет одного запуска: за ним оставшиеся сообщения заберёт следующий
 * запуск крона (каждую минуту), а не растянет этот сверх таймаута задачи. */
const RUN_BUDGET_MS = 4 * 60 * 1000;

export interface DispatchScheduledMessagesResult {
	sent: number;
	failed: number;
	expired: number;
	stale: number;
}

/** Внешние эффекты диспетчера — подменяются в тестах. */
export interface DispatchDeps {
	claimDue: typeof claimDueScheduledMessages;
	failStale: typeof failStaleSendingScheduledMessages;
	failOverdue: typeof failOverdueScheduledMessages;
	finish: typeof finishScheduledMessage;
	sendClient: typeof sendClientMessage;
	sendWidget: typeof sendWidgetMessage;
}

const defaultDeps: DispatchDeps = {
	claimDue: claimDueScheduledMessages,
	failStale: failStaleSendingScheduledMessages,
	failOverdue: failOverdueScheduledMessages,
	finish: finishScheduledMessage,
	sendClient: sendClientMessage,
	sendWidget: sendWidgetMessage,
};

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Один шаг отправки: null — успех, строка — причина неудачи. */
async function sendOne(
	message: ScheduledMessage,
	deps: DispatchDeps,
): Promise<string | null> {
	// Токены портала берём заново: сессии оператора у воркера нет.
	const getBitrixApi = () => resolveBitrixApiForRequest(message.memberId);

	if (message.kind === "widget") {
		if (!message.entity || !message.entityId) {
			return "В сообщении не указана сделка или контакт";
		}
		if (message.entity !== "deal" && message.entity !== "contact") {
			return "Неизвестный тип сущности CRM";
		}
		const result = await deps.sendWidget(
			{
				entity: message.entity,
				entityId: message.entityId,
				// Тип мессенджера в БД — строка; неверное значение отсеет
				// проверка канала внутри sendWidgetMessage.
				messenger: message.messenger as Parameters<
					typeof sendWidgetMessage
				>[0]["messenger"],
				lineId: message.lineId ?? undefined,
				connectorId: message.connectorId ?? undefined,
				text: message.text,
			},
			{ memberId: message.memberId, getBitrixApi },
		);
		return result.error ?? null;
	}

	const messenger = inboxMessengerSchema.safeParse(message.messenger);
	if (!messenger.success || !message.userId) {
		return "В сообщении не указан получатель";
	}
	if (!message.operatorId) return "Не сохранён автор сообщения";
	const result = await deps.sendClient(
		{
			messenger: messenger.data,
			userId: message.userId,
			lineId: message.lineId ?? undefined,
			connectorId: message.connectorId ?? undefined,
			text: message.text,
			attachment: message.attachment ?? undefined,
			operatorId: message.operatorId ?? undefined,
			operatorName: message.operatorName ?? undefined,
		},
		{
			memberId: message.memberId,
			operatorId: message.operatorId,
			getBitrixApi,
		},
	);
	return result.ok ? null : result.error;
}

/**
 * Отправляет созревшие отложенные сообщения. Вызывается кроном Hatchet раз в
 * минуту (packages/jobs hatchet/scheduled-messages.ts).
 *
 * Сообщение переводится в sending атомарно (см. claimDueScheduledMessages),
 * поэтому параллельные запуски не пошлют его дважды. Сбой не повторяем
 * автоматически: ошибка мессенджера чаще всего постоянна (клиент заблокировал
 * бота), а повтор после неоднозначного сбоя рискует дублем — оператор увидит
 * причину в списке и решит сам.
 */
export async function dispatchDueScheduledMessages(
	now: Date = new Date(),
	deps: DispatchDeps = defaultDeps,
): Promise<DispatchScheduledMessagesResult> {
	const result: DispatchScheduledMessagesResult = {
		sent: 0,
		failed: 0,
		expired: 0,
		stale: 0,
	};

	result.stale = await deps.failStale(
		new Date(now.getTime() - STALE_SENDING_MS),
		"Отправка прервалась (перезапуск воркера) — проверьте историю диалога: сообщение могло уйти клиенту",
	);
	result.expired = await deps.failOverdue(
		new Date(now.getTime() - SCHEDULED_MAX_OVERDUE_MS),
		"Не отправлено вовремя: время отправки прошло, а сервис в этот момент не работал. Отправьте сообщение заново",
	);

	const deadline = Date.now() + RUN_BUDGET_MS;
	while (Date.now() < deadline) {
		const batch = await deps.claimDue(new Date(), CLAIM_BATCH_SIZE);
		if (batch.length === 0) break;

		for (const message of batch) {
			let error: string | null;
			try {
				error = await sendOne(message, deps);
			} catch (err) {
				console.error(
					`[scheduled-messages] ошибка отправки ${message.id}: ${describeError(err)}`,
				);
				error = `Ошибка при отправке: ${describeError(err)}`;
			}
			if (error === null) {
				await deps.finish(message.id, { status: "sent" });
				result.sent++;
			} else {
				await deps.finish(message.id, {
					status: "failed",
					error,
				});
				result.failed++;
			}
		}
	}
	return result;
}
