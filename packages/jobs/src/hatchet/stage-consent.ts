import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import {
	createRedisClient,
	processDealConsentOutbox,
} from "@psi-opora/bot-core";

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
		const result = await processDealConsentOutbox(createRedisClient());
		console.info("[stage-consent-outbox] завершено", result);
	},
});
