"use client";

import { FunnelStages } from "@/components/dashboard/funnel-stages";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	useBitrixData,
	useDashboardRange,
} from "@/hooks/use-bitrix-data";
import { funnelByStage, groupDealsByCategory } from "@/lib/analytics/aggregate";
import { formatNumber } from "@/lib/format";

export default function FunnelPage() {
	return (
		<PageSuspense>
			<FunnelPageContent />
		</PageSuspense>
	);
}

function FunnelPageContent() {
	const reportFilter = useDashboardRange();
	const { data, isLoading, isError } = useBitrixData([
		"deals",
		"stageNames",
		"categoryNames",
		"dealDomain",
	]);

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

	const deals = data.deals ?? [];
	const stageNames = data.stageNames ?? new Map();
	const categoryNames = data.categoryNames ?? new Map();
	const dealDomain = data.dealDomain ?? null;
	const byCategory = [...groupDealsByCategory(deals).entries()].sort(
		([, a], [, b]) => b.length - a.length,
	);
	const firstCategory = byCategory[0];

	if (!firstCategory) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Воронка продаж</CardTitle>
					<CardDescription>Нет сделок за выбранный период</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-1">
				<h1 className="font-heading text-xl font-semibold">Воронка продаж</h1>
				<p className="text-sm text-muted-foreground">
					Текущее состояние сделок, созданных за выбранный период
				</p>
			</div>

			<Tabs defaultValue={firstCategory[0]}>
				<TabsList className="max-w-full justify-start overflow-x-auto">
					{byCategory.map(([categoryId, categoryDeals]) => (
						<TabsTrigger key={categoryId} value={categoryId}>
							{categoryNames.get(categoryId) ?? `Воронка ${categoryId}`}
							<Badge variant="secondary">
								{formatNumber(categoryDeals.length)}
							</Badge>
						</TabsTrigger>
					))}
				</TabsList>

				{byCategory.map(([categoryId, categoryDeals]) => (
					<TabsContent key={categoryId} value={categoryId}>
						<FunnelStages
							stages={funnelByStage(categoryDeals, stageNames)}
							categoryId={categoryId}
							dealDomain={dealDomain}
							reportFilter={reportFilter}
						/>
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
