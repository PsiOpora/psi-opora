"use client";

import { useQuery } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { FunnelChart } from "@/components/dashboard/funnel-chart";
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
import {
	type StageReachCount,
	stageReachFunnel,
} from "@/lib/analytics/deal-stage-history";
import type { StageInfo } from "@/lib/analytics/deals";
import type { DateRange } from "@/lib/analytics/types";
import { formatNumber } from "@/lib/format";

type FunnelMode = "created" | "active" | "reached";

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
	// openDeals (crm.deal.list с CLOSED=N) не ограничен диапазоном дат — на
	// CRM с историей это может быть заметно больше, чем deals за период.
	// Подгружаем его только когда реально открыта вкладка «Активно сейчас»,
	// а не на каждый заход на страницу воронки.
	const { data, isLoading, isError } = useBitrixData([
		"deals",
		"stageNames",
		"categoryNames",
		...(mode === "active" ? (["openDeals"] as const) : []),
	]);

	const deals = (mode === "active" ? data?.openDeals : data?.deals) ?? [];
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
			: mode === "active"
				? "Снэпшот сделок, которые прямо сейчас не закрыты — без фильтра по дате создания. Это ближе всего к тому, что вы видите в канбане воронки в Bitrix24 по умолчанию."
				: `Уникальные сделки, побывавшие на каждом этапе хотя бы раз с ${formatDateParam(reportFilter.from)} по ${formatDateParam(reportFilter.to)} — в отличие от других режимов, здесь считается сам факт прохождения этапа, а не текущее положение сделки.`;

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
					<TabsTrigger value="reached">Достигли этапа</TabsTrigger>
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
							{mode === "active"
								? "Нет сделок, которые сейчас в работе"
								: "Нет сделок за выбранный период"}
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
							{mode === "reached" ? (
								<StageReachPanel
									categoryId={categoryId}
									stageNames={stageNames}
									reportFilter={reportFilter}
								/>
							) : (
								<FunnelStages
									stages={funnelByStage(categoryDeals, stageNames)}
									mode={mode}
									categoryId={categoryId}
									reportFilter={reportFilter}
								/>
							)}
						</TabsContent>
					))}
				</Tabs>
			)}
		</div>
	);
}

/**
 * Историческая воронка для одной категории (packages/db, таблица
 * deal_stage_history) — отдельный запрос от useBitrixData, т.к. источник
 * данных не live Bitrix, а локальный Postgres.
 */
function StageReachPanel({
	categoryId,
	stageNames,
	reportFilter,
}: {
	categoryId: string;
	stageNames: Map<string, StageInfo>;
	reportFilter: DateRange;
}) {
	const { data, isLoading, isError } = useQuery({
		queryKey: [
			"deal-stage-history",
			categoryId,
			formatDateParam(reportFilter.from),
			formatDateParam(reportFilter.to),
		],
		queryFn: async () => {
			const params = new URLSearchParams({
				category: categoryId,
				from: formatDateParam(reportFilter.from),
				to: formatDateParam(reportFilter.to),
			});
			const res = await fetch(`/api/dashboard/deal-stage-history?${params}`);
			if (!res.ok) throw new Error("Не удалось загрузить историю стадий");
			return (await res.json()) as { rows: StageReachCount[] };
		},
	});

	if (isLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (isError || !data) {
		return (
			<p className="text-sm text-destructive">
				Не удалось загрузить данные. Попробуйте обновить страницу.
			</p>
		);
	}

	const steps = stageReachFunnel(data.rows, stageNames);
	if (steps.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				Нет данных об истории стадий за выбранный период.
			</p>
		);
	}
	return <FunnelChart steps={steps} />;
}
