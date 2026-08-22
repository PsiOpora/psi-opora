"use client";

import { GroupStatsCard } from "@/components/dashboard/group-stats-card";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { useBitrixData, useDashboardRange } from "@/hooks/use-bitrix-data";
import {
	fetchAllDealsReportRows,
	useDealsReport,
} from "@/hooks/use-deals-report";
import { useDealsSummary } from "@/hooks/use-deals-summary";

const TOP_LIMIT = 5;

export default function OverviewPage() {
	return (
		<PageSuspense>
			<OverviewPageContent />
		</PageSuspense>
	);
}

function OverviewPageContent() {
	const range = useDashboardRange();
	const { data, isLoading, isError } = useBitrixData(["dealDomain"]);
	const {
		data: summaryData,
		isLoading: summaryLoading,
		isError: summaryError,
	} = useDealsSummary({ range, previous: true });
	const topUtm = useDealsReport({
		dimension: "utmSource",
		range,
		page: 1,
		pageSize: TOP_LIMIT,
		sort: "deals",
	});
	const topSources = useDealsReport({
		dimension: "source",
		range,
		page: 1,
		pageSize: TOP_LIMIT,
		sort: "deals",
	});

	if (isLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (isError) {
		return (
			<p className="text-sm text-destructive">
				Не удалось загрузить данные. Попробуйте обновить страницу.
			</p>
		);
	}
	if (!data?.connected) return <NotConnected />;

	const dealDomain = data.dealDomain ?? null;

	return (
		<div className="flex flex-col gap-4">
			{summaryLoading ? (
				<p className="text-sm text-muted-foreground">Загрузка сводки…</p>
			) : summaryError ? (
				<p className="text-sm text-destructive">
					Не удалось загрузить сводку. Попробуйте обновить страницу.
				</p>
			) : summaryData ? (
				<>
					<KpiCards
						summary={summaryData.summary}
						previous={summaryData.previousSummary}
					/>
					<TrendChart data={summaryData.trend} />
				</>
			) : null}
			<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
				<GroupStatsCard
					title="Топ UTM-источников"
					description={`Топ-${TOP_LIMIT} по количеству сделок — полный разрез на странице «UTM-отчёт»`}
					columnLabel="UTM source"
					csvName="top-utm-sources.csv"
					data={topUtm.data?.rows ?? []}
					total={topUtm.data?.rows.length ?? 0}
					page={1}
					pageSize={TOP_LIMIT}
					onPageChange={() => {}}
					showPagination={false}
					dimension="utmSource"
					range={range}
					dealDomain={dealDomain}
					isLoading={topUtm.isLoading}
					getAllRows={() => fetchAllDealsReportRows("utmSource", range)}
				/>
				<GroupStatsCard
					title="Топ источников CRM"
					description={`Топ-${TOP_LIMIT} по количеству сделок — полный список на странице «Источники»`}
					columnLabel="Источник"
					csvName="top-crm-sources.csv"
					data={topSources.data?.rows ?? []}
					total={topSources.data?.rows.length ?? 0}
					page={1}
					pageSize={TOP_LIMIT}
					onPageChange={() => {}}
					showPagination={false}
					dimension="source"
					range={range}
					dealDomain={dealDomain}
					isLoading={topSources.isLoading}
					getAllRows={() => fetchAllDealsReportRows("source", range)}
				/>
			</div>
		</div>
	);
}
