"use client";

import type { DealGroupDimension } from "@psi-opora/db/queries";
import { useState } from "react";
import { GroupBarChart } from "@/components/dashboard/group-bar-chart";
import { GroupStatsCard } from "@/components/dashboard/group-stats-card";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { UtmLegendCard } from "@/components/dashboard/utm-legend-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBitrixData, useDashboardRange } from "@/hooks/use-bitrix-data";
import {
	fetchAllDealsReportRows,
	useDealsReport,
} from "@/hooks/use-deals-report";
import { utmHint } from "@/lib/analytics/utm-tags";

const DIMENSIONS: Array<{
	value: string;
	tab: string;
	dimension: DealGroupDimension;
	columnLabel: string;
	description: string;
	hint: string;
}> = [
	{
		value: "source",
		tab: "Source",
		dimension: "utmSource",
		columnLabel: "UTM source",
		description: "Разбивка сделок по utm_source за выбранный период",
		hint: utmHint("utm_source"),
	},
	{
		value: "medium",
		tab: "Medium",
		dimension: "utmMedium",
		columnLabel: "UTM medium",
		description: "Разбивка сделок по типу трафика (utm_medium)",
		hint: utmHint("utm_medium"),
	},
	{
		value: "campaign",
		tab: "Campaign",
		dimension: "utmCampaign",
		columnLabel: "UTM source / campaign",
		description: "Разбивка сделок по связке utm_source + utm_campaign",
		hint: `Комбинация источника и названия кампании — так проще сравнивать одинаковые кампании, запущенные в разных источниках. ${utmHint("utm_campaign")}`,
	},
	{
		value: "content",
		tab: "Content",
		dimension: "utmContent",
		columnLabel: "UTM content",
		description: "Разбивка сделок по объявлению/креативу (utm_content)",
		hint: utmHint("utm_content"),
	},
	{
		value: "term",
		tab: "Term",
		dimension: "utmTerm",
		columnLabel: "UTM term",
		description: "Разбивка сделок по ключевой фразе (utm_term)",
		hint: utmHint("utm_term"),
	},
];

const TABLE_PAGE_SIZE = 20;
const CHART_PAGE_SIZE = 8;

export default function UtmReportPage() {
	return (
		<PageSuspense>
			<UtmReportPageContent />
		</PageSuspense>
	);
}

function UtmReportPageContent() {
	const range = useDashboardRange();
	const { data, isLoading, isError } = useBitrixData(["dealDomain"]);
	const [activeTab, setActiveTab] = useState(DIMENSIONS[0]?.value ?? "source");
	const [tablePage, setTablePage] = useState(1);

	const active = DIMENSIONS.find((d) => d.value === activeTab) ?? DIMENSIONS[0];

	// Только активная вкладка реально ходит на сервер — переключение вкладок
	// раньше пересчитывало все 5 разрезов сразу на клиенте; теперь остальные
	// 4 не запрашиваются, пока пользователь их не откроет.
	const chartByDeals = useDealsReport({
		dimension: active?.dimension ?? "utmSource",
		range,
		page: 1,
		pageSize: CHART_PAGE_SIZE,
		sort: "deals",
	});
	const chartByOpportunity = useDealsReport({
		dimension: active?.dimension ?? "utmSource",
		range,
		page: 1,
		pageSize: CHART_PAGE_SIZE,
		sort: "opportunitySum",
	});
	const table = useDealsReport({
		dimension: active?.dimension ?? "utmSource",
		range,
		page: tablePage,
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
	if (!active) return null;

	if (chartByDeals.isError) {
		return (
			<p className="text-sm text-destructive">
				Не удалось загрузить данные графика сделок. Попробуйте обновить
				страницу.
			</p>
		);
	}

	if (chartByOpportunity.isError) {
		return (
			<p className="text-sm text-destructive">
				Не удалось загрузить данные графика суммы. Попробуйте обновить страницу.
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

	const dealDomain = data.dealDomain ?? null;

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-1">
				<h1 className="font-heading text-xl font-semibold">UTM-отчёт</h1>
				<p className="text-sm text-muted-foreground">
					Сравнивайте каналы по количеству сделок и по заполненной сумме
				</p>
			</div>
			<UtmLegendCard />
			<Tabs
				value={activeTab}
				onValueChange={(value) => {
					setActiveTab(value);
					setTablePage(1);
				}}
				className="flex flex-col gap-4"
			>
				<TabsList className="max-w-full justify-start overflow-x-auto">
					{DIMENSIONS.map((dim) => (
						<TabsTrigger key={dim.value} value={dim.value}>
							{dim.tab}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value={active.value} className="flex flex-col gap-4">
					<div className="grid items-start gap-4 xl:grid-cols-2">
						<GroupBarChart
							title="По количеству сделок"
							description="Все созданные сделки, независимо от заполнения суммы"
							hint={active.hint}
							data={chartByDeals.data?.rows ?? []}
							metric="deals"
						/>
						<GroupBarChart
							title="По указанной сумме"
							description="Сумма всех сделок, где заполнено поле «Сумма»"
							hint={active.hint}
							data={chartByOpportunity.data?.rows ?? []}
							metric="opportunitySum"
						/>
					</div>
					<GroupStatsCard
						title={`По ${active.columnLabel}`}
						description={`${active.description}. Основная сортировка — по количеству сделок.`}
						hint={active.hint}
						columnLabel={active.columnLabel}
						csvName={`utm-${active.value}.csv`}
						data={table.data?.rows ?? []}
						total={table.data?.total ?? 0}
						page={tablePage}
						pageSize={TABLE_PAGE_SIZE}
						onPageChange={setTablePage}
						dimension={active.dimension}
						range={range}
						dealDomain={dealDomain}
						showOpportunity
						isLoading={table.isLoading}
						getAllRows={() => fetchAllDealsReportRows(active.dimension, range)}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}
