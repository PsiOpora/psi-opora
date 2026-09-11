import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import {
	createRedisClient,
	processDealConsentOutbox,
} from "@psi-opora/bot-core";

// Пятиминутный batch должен покрывать прежние 100 записей/мин и оставить
// запас для повторной обработки записей, не доставленных в прошлые запуски.
const OUTBOX_BATCH_LIMIT = 600;

/** Доставляет сохранённые ответы о согласии в поля сделок Bitrix24. */
export const stageConsentOutbox = CreateTaskWorkflow({
	name: "stage-consent-outbox",
	on: { cron: "*/5 * * * *" },
	retries: 0,
	executionTimeout: "5m",
	concurrency: {
		expression: "'stage-consent-outbox'",
		maxRuns: 1,
		limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
	},
	fn: async () => {
		const result = await processDealConsentOutbox(
			createRedisClient(),
			OUTBOX_BATCH_LIMIT,
		);
		console.info("[stage-consent-outbox] завершено", result);
	},
});
