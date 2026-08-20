"use client";

import { useMemo } from "react";
import { GroupBarChart } from "@/components/dashboard/group-bar-chart";
import { GroupStatsCard } from "@/components/dashboard/group-stats-card";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { UtmLegendCard } from "@/components/dashboard/utm-legend-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBitrixData } from "@/hooks/use-bitrix-data";
import {
	groupByUtmCampaign,
	groupByUtmContent,
	groupByUtmMedium,
	groupByUtmSource,
	groupByUtmTerm,
} from "@/lib/analytics/aggregate";
import { utmHint } from "@/lib/analytics/utm-tags";

export default function UtmReportPage() {
	return (
		<PageSuspense>
			<UtmReportPageContent />
		</PageSuspense>
	);
}

function UtmReportPageContent() {
	const { data, isLoading, isError } = useBitrixData(["deals", "dealDomain"]);
	const deals = data?.deals ?? [];
	const dealDomain = data?.dealDomain ?? null;

	// Пересчёт всех 5 разрезов — полный проход по сделкам на каждый; без
	// мемоизации это повторялось на любой ре-рендер страницы (например, при
	// фоновом refetch по фокусу окна), а не только при смене периода/данных.
	const dimensions = useMemo(
		() => [
			{
				value: "source",
				tab: "Source",
				columnLabel: "UTM source",
				description: "Разбивка сделок по utm_source за выбранный период",
				hint: utmHint("utm_source"),
				data: groupByUtmSource(deals),
			},
			{
				value: "medium",
				tab: "Medium",
				columnLabel: "UTM medium",
				description: "Разбивка сделок по типу трафика (utm_medium)",
				hint: utmHint("utm_medium"),
				data: groupByUtmMedium(deals),
			},
			{
				value: "campaign",
				tab: "Campaign",
				columnLabel: "UTM source / campaign",
				description: "Разбивка сделок по связке utm_source + utm_campaign",
				hint: `Комбинация источника и названия кампании — так проще сравнивать одинаковые кампании, запущенные в разных источниках. ${utmHint("utm_campaign")}`,
				data: groupByUtmCampaign(deals),
			},
			{
				value: "content",
				tab: "Content",
				columnLabel: "UTM content",
				description: "Разбивка сделок по объявлению/креативу (utm_content)",
				hint: utmHint("utm_content"),
				data: groupByUtmContent(deals),
			},
			{
				value: "term",
				tab: "Term",
				columnLabel: "UTM term",
				description: "Разбивка сделок по ключевой фразе (utm_term)",
				hint: utmHint("utm_term"),
				data: groupByUtmTerm(deals),
			},
		],
		[deals],
	);

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

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-1">
				<h1 className="font-heading text-xl font-semibold">UTM-отчёт</h1>
				<p className="text-sm text-muted-foreground">
					Сравнивайте каналы по количеству сделок и по заполненной сумме
				</p>
			</div>
			<UtmLegendCard />
			<Tabs defaultValue="source" className="flex flex-col gap-4">
				<TabsList className="max-w-full justify-start overflow-x-auto">
					{dimensions.map((dim) => (
						<TabsTrigger key={dim.value} value={dim.value}>
							{dim.tab}
						</TabsTrigger>
					))}
				</TabsList>
				{dimensions.map((dim) => (
					<TabsContent
						key={dim.value}
						value={dim.value}
						className="flex flex-col gap-4"
					>
						<div className="grid items-start gap-4 xl:grid-cols-2">
							<GroupBarChart
								title="По количеству сделок"
								description="Все созданные сделки, независимо от заполнения суммы"
								hint={dim.hint}
								data={dim.data}
								metric="deals"
							/>
							<GroupBarChart
								title="По указанной сумме"
								description="Сумма всех сделок, где заполнено поле «Сумма»"
								hint={dim.hint}
								data={dim.data}
								metric="opportunitySum"
							/>
						</div>
						<GroupStatsCard
							title={`По ${dim.columnLabel}`}
							description={`${dim.description}. Основная сортировка — по количеству сделок.`}
							hint={dim.hint}
							columnLabel={dim.columnLabel}
							csvName={`utm-${dim.value}.csv`}
							data={dim.data}
							dealDomain={dealDomain}
							showOpportunity
						/>
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
