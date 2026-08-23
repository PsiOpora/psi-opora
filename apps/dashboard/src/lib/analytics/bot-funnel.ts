import { FUNNEL_STEPS, type FunnelStep } from "@psi-opora/bot-core/funnel-steps";
import {
	getBotFunnelDropReasonsByDateRange,
	getBotFunnelUniqueStepCountsByDateRange,
} from "@psi-opora/db/queries";
import {
	type BotFunnelDropReasonRow,
	type BotFunnelEvent,
	REASON_LABELS,
	STEP_LABELS,
} from "./bot-funnel-shared";
import { formatDateParam } from "./date-range";
import type { DateRange } from "./types";

export * from "./bot-funnel-shared";

/** Суффикс тестовой кампании: `vk_ads1_test`, `some_source_test` и т.п. — не учитывается в отчёте. */
const TEST_CAMPAIGN_SUFFIX = "_test";

export async function fetchBotFunnelEvents(
	range: DateRange,
): Promise<BotFunnelEvent[]> {
	const rows = await getBotFunnelUniqueStepCountsByDateRange(
		formatDateParam(range.from),
		formatDateParam(range.to),
	);

	return rows
		.filter((row) => (FUNNEL_STEPS as readonly string[]).includes(row.step))
		.filter((row) => !row.campaign.endsWith(TEST_CAMPAIGN_SUFFIX))
		.map((row) => ({
			messenger: row.messenger,
			step: row.step as FunnelStep,
			flow: row.flow,
			source: row.source,
			campaign: row.campaign,
			count: row.uniqueUsers,
		}));
}

/** Причины, по которым пользователи не пошли дальше конкретного шага — для
 * блока "Причины отвала" (см. getBotFunnelDropReasonsByDateRange). */
export async function fetchBotFunnelDropReasons(
	range: DateRange,
): Promise<BotFunnelDropReasonRow[]> {
	const rows = await getBotFunnelDropReasonsByDateRange(
		formatDateParam(range.from),
		formatDateParam(range.to),
	);

	return rows
		.filter((row) => (FUNNEL_STEPS as readonly string[]).includes(row.step))
		.map((row) => ({
			key: `${row.messenger}|${row.flow}|${row.step}|${row.reason}`,
			messenger: row.messenger,
			flow: row.flow,
			step: row.step as FunnelStep,
			stepLabel: STEP_LABELS[row.step as FunnelStep],
			reason: row.reason,
			reasonLabel: REASON_LABELS[row.reason] ?? row.reason,
			count: row.uniqueUsers,
		}))
		.sort((a, b) => b.count - a.count);
}
