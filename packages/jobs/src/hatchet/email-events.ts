import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk/v1";
import type { EmailEventType } from "@psi-opora/db/queries";

/**
 * IncomingEmailEvent в JSON-виде: payload Hatchet-задачи должен быть
 * JSON-значением, поэтому дата — ISO-строкой, а сырой payload провайдера
 * не передаётся (нужное из него уже лежит в details).
 */
export type SerializedEmailEvent = {
	provider: "rusender" | "unisender" | "internal";
	externalId: string;
	type: EmailEventType;
	occurredAt: string;
	email: string | null;
	details: string | null;
	match:
		| { recipientId: string }
		| { providerMessageId: string }
		| { unisenderCampaignId: string; email: string };
};

export type IngestEmailEventsPayload = {
	events: SerializedEmailEvent[];
};

/**
 * Применяет события доставки писем (вебхуки Rusender/Unisender) к статусам
 * получателей рассылок. Вебхук-обработчик только проверяет подлинность и
 * ставит события в очередь: Unisender ждёт ответа не дольше 3 секунд, а
 * Rusender шлёт пачки до 500 событий. Повтор задачи безопасен — события
 * дедуплицируются по (provider, externalId).
 */
export const ingestEmailEvents = CreateTaskWorkflow({
	name: "email-events-ingest",
	retries: 3,
	executionTimeout: "10m",
	scheduleTimeout: "24h",
	fn: async (payload: IngestEmailEventsPayload) => {
		// Ленивый импорт — см. комментарий в email-campaign.ts.
		const { recordEmailEvents } = await import("@psi-opora/db/queries");
		return recordEmailEvents(
			payload.events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) })),
		);
	},
});
