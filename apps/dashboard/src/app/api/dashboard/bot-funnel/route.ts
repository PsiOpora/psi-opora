import { NextResponse } from "next/server";
import {
	fetchBotFunnelDropReasons,
	fetchBotFunnelEvents,
	funnelByMessenger,
	funnelBySourceCampaign,
	funnelStepStatsByFlow,
} from "@/lib/analytics/bot-funnel";

export const dynamic = "force-dynamic";

/**
 * Считаем производные метрики (шаги/по мессенджеру/по источнику) здесь, а не
 * в клиентском компоненте — funnelStepStatsByFlow и т.п. живут в одном файле
 * с fetchBotFunnelEvents, который тянет @psi-opora/db/queries (pg → net/tls),
 * несовместимые с клиентским бандлом.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const toParam = url.searchParams.get("to");
	const fromParam = url.searchParams.get("from");
	const to = toParam ? new Date(toParam) : new Date();
	const from = fromParam
		? new Date(fromParam)
		: new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

	const events = await fetchBotFunnelEvents({ from, to });
	const dropReasons = await fetchBotFunnelDropReasons({ from, to });
	return NextResponse.json({
		events,
		flows: funnelStepStatsByFlow(events),
		byMessenger: funnelByMessenger(events),
		bySource: funnelBySourceCampaign(events),
		dropReasons,
	});
}
