"use client";

import { InfoIcon } from "lucide-react";
import { useMemo, useState } from "react";
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
import { useBitrixData, useDashboardRange } from "@/hooks/use-bitrix-data";
import { funnelByStage, groupDealsByCategory } from "@/lib/analytics/aggregate";
import { formatDateParam } from "@/lib/analytics/date-range";
import { formatNumber } from "@/lib/format";

type FunnelMode = "created" | "active";

export default function FunnelPage() {
	return (
		<PageSuspense>
			<FunnelPageContent />
		</PageSuspense>
	);
}

function FunnelPageContent() {
	const reportFilter = useDashboardRange();
	const [mode, setMode] = useState<FunnelMode>("created");
	const { data, isLoading, isError } = useBitrixData([
		"deals",
		"openDeals",
		"stageNames",
		"categoryNames",
	]);

	const deals = (mode === "created" ? data?.deals : data?.openDeals) ?? [];
	const stageNames = data?.stageNames ?? new Map();
	const categoryNames = data?.categoryNames ?? new Map();
	const byCategory = useMemo(
		() =>
			[...groupDealsByCategory(deals).entries()].sort(
				([, a], [, b]) => b.length - a.length,
			),
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

	const firstCategory = byCategory[0];

	const modeDescription =
		mode === "created"
			? `Сделки, созданные с ${formatDateParam(reportFilter.from)} по ${formatDateParam(reportFilter.to)} (поле DATE_CREATE), сгруппированные по их сегодняшней стадии — включая уже выигранные и проигранные.`
			: "Снэпшот сделок, которые прямо сейчас не закрыты — без фильтра по дате создания. Это ближе всего к тому, что вы видите в канбане воронки в Bitrix24 по умолчанию.";

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-1">
				<h1 className="font-heading text-xl font-semibold">Воронка продаж</h1>
				<p className="text-sm text-muted-foreground">
					Числа здесь могут не совпадать с тем, что вы видите в самой CRM —
					режим ниже определяет, какая выборка сделок используется.
				</p>
			</div>

			<Tabs
				value={mode}
				onValueChange={(value) => setMode(value as FunnelMode)}
			>
				<TabsList>
					<TabsTrigger value="created">Создано за период</TabsTrigger>
					<TabsTrigger value="active">Активно сейчас</TabsTrigger>
				</TabsList>
			</Tabs>

			<div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
				<InfoIcon className="mt-0.5 size-4 shrink-0" />
				<p>{modeDescription}</p>
			</div>

			{!firstCategory ? (
				<Card>
					<CardHeader>
						<CardTitle>Воронка продаж</CardTitle>
						<CardDescription>
							{mode === "created"
								? "Нет сделок за выбранный период"
								: "Нет сделок, которые сейчас в работе"}
						</CardDescription>
					</CardHeader>
				</Card>
			) : (
				<Tabs key={mode} defaultValue={firstCategory[0]}>
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
								mode={mode}
							/>
						</TabsContent>
					))}
				</Tabs>
			)}
		</div>
	);
}
