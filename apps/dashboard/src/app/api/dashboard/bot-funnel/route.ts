import { NextResponse } from "next/server";
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

export const dynamic = "force-dynamic";

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
	const includeTest = url.searchParams.get("includeTest") === "1";
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
			fetchBotFunnelTrend(range),
			fetchBotFunnelEvents(prevRange, { includeTest }),
			fetchBotFunnelDropReasons(prevRange),
		]);
	const bySource = await fetchBotFunnelSourceEnriched(range, events);

	return NextResponse.json({
		events,
		flows: funnelStepStatsByFlow(events),
		byMessenger: funnelByMessenger(events),
		bySource,
		bySourceByMessenger: funnelBySourceCampaignByMessenger(events),
		dropReasons,
		trend,
		previous: {
			flows: funnelStepStatsByFlow(previousEvents),
			dropReasons: previousDropReasons,
		},
	});
}
