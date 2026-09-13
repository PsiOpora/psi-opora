import { NextResponse } from "next/server";
import { z } from "zod";
import {
	fetchBotFunnelDropReasons,
	fetchBotFunnelEvents,
	fetchBotFunnelSourceEnriched,
	fetchBotFunnelTrend,
	funnelByMessenger,
	funnelBySourceCampaignByMessenger,
	funnelStepStatsByFlow,
} from "@/lib/analytics/bot-funnel";
import { previousRange } from "@/lib/analytics/date-range";
import { zodBadRequest } from "@/lib/api/validation";

export const dynamic = "force-dynamic";

const includeTestSchema = z
	.enum(["0", "1"])
	.optional()
	.transform((value) => value === "1");

/**
 * Считаем производные метрики (шаги/по мессенджеру/по источнику) здесь, а не
 * в клиентском компоненте — funnelStepStatsByFlow и т.п. живут в одном файле
 * с fetchBotFunnelEvents, который тянет @psi-opora/db/queries (pg → net/tls),
 * несовместимые с клиентским бандлом.
 *
 * Период сравнения (previous) считается по flows и dropReasons — дёшево (те
 * же fetchBotFunnelEvents/fetchBotFunnelDropReasons) и достаточно для дельт
 * на KPI-карточках и итоговой конверсии воронки; таблицу источников за
 * предыдущий период не тянем — там нет UI для построчных дельт.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const toParam = url.searchParams.get("to");
	const fromParam = url.searchParams.get("from");
	let includeTest: boolean;
	try {
		includeTest = includeTestSchema.parse(
			url.searchParams.get("includeTest") ?? undefined,
		);
	} catch (error) {
		const response = zodBadRequest(error);
		if (response) return response;
		throw error;
	}
	const to = toParam ? new Date(toParam) : new Date();
	const from = fromParam
		? new Date(fromParam)
		: new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
	const range = { from, to };
	const prevRange = previousRange(range);

	const [events, dropReasons, trend, previousEvents, previousDropReasons] =
		await Promise.all([
			fetchBotFunnelEvents(range, { includeTest }),
			fetchBotFunnelDropReasons(range),
			fetchBotFunnelTrend(range, { includeTest }),
			fetchBotFunnelEvents(prevRange, { includeTest }),
			fetchBotFunnelDropReasons(prevRange),
		]);
	const bySource = await fetchBotFunnelSourceEnriched(range, events);
	const enrichmentBySource = new Map(bySource.map((row) => [row.key, row]));
	const bySourceByMessenger = funnelBySourceCampaignByMessenger(events).map(
		({ messenger, rows }) => ({
			messenger,
			rows: rows.map((row) => {
				const enrichment = enrichmentBySource.get(row.key);
				const spend = enrichment?.spend;
				const wonSum = enrichment?.wonSum;
				return {
					...row,
					wonDeals: enrichment?.wonDeals,
					opportunitySum: enrichment?.opportunitySum,
					wonSum,
					spend,
					cpl:
						spend !== undefined && row.starts > 0
							? spend / row.starts
							: undefined,
					cac:
						spend !== undefined && row.deals > 0
							? spend / row.deals
							: undefined,
					roas:
						spend !== undefined && spend > 0 && wonSum !== undefined
							? wonSum / spend
							: undefined,
				};
			}),
		}),
	);

	return NextResponse.json({
		events,
		flows: funnelStepStatsByFlow(events),
		byMessenger: funnelByMessenger(events),
		bySource,
		bySourceByMessenger,
		dropReasons,
		trend,
		previous: {
			flows: funnelStepStatsByFlow(previousEvents),
			byMessenger: funnelByMessenger(previousEvents),
			dropReasons: previousDropReasons,
		},
	});
}
