"use client";

import { useState } from "react";
import { GroupBarChart } from "@/components/dashboard/group-bar-chart";
import { GroupStatsCard } from "@/components/dashboard/group-stats-card";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { useBitrixData, useDashboardRange } from "@/hooks/use-bitrix-data";
import {
	fetchAllDealsReportRows,
	useDealsReport,
} from "@/hooks/use-deals-report";

const TABLE_PAGE_SIZE = 20;
const CHART_PAGE_SIZE = 8;

export default function SourcesPage() {
	return (
		<PageSuspense>
			<SourcesPageContent />
		</PageSuspense>
	);
}

function SourcesPageContent() {
	const range = useDashboardRange();
	const { data, isLoading, isError } = useBitrixData(["dealDomain"]);
	const [page, setPage] = useState(1);

	const chart = useDealsReport({
		dimension: "source",
		range,
		page: 1,
		pageSize: CHART_PAGE_SIZE,
		sort: "wonSum",
	});
	const table = useDealsReport({
		dimension: "source",
		range,
		page,
		pageSize: TABLE_PAGE_SIZE,
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

	if (chart.isError) {
		return (
			<p className="text-sm text-destructive">
				Не удалось загрузить данные графика. Попробуйте обновить страницу.
			</p>
		);
	}

	if (table.isError) {
		return (
			<p className="text-sm text-destructive">
				Не удалось загрузить данные таблицы. Попробуйте обновить страницу.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<GroupBarChart
				title="Источники CRM"
				description="Сумма выигранных сделок по источнику (SOURCE_ID)"
				data={chart.data?.rows ?? []}
			/>
			<GroupStatsCard
				title="По источникам"
				description="Справочник источников CRM (Приложения → CRM → Настройки → Источники)"
				columnLabel="Источник"
				csvName="crm-sources.csv"
				data={table.data?.rows ?? []}
				total={table.data?.total ?? 0}
				page={page}
				pageSize={TABLE_PAGE_SIZE}
				onPageChange={setPage}
				dimension="source"
				range={range}
				dealDomain={dealDomain}
				isLoading={table.isLoading}
				getAllRows={() => fetchAllDealsReportRows("source", range)}
			/>
		</div>
	);
}
