"use client";

import { useQuery } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useState } from "react";
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
import { useDealsReport } from "@/hooks/use-deals-report";
import { formatDateParam } from "@/lib/analytics/date-range";
import {
	type StageReachCount,
	stageReachFunnel,
} from "@/lib/analytics/deal-stage-history";
import type { StageInfo } from "@/lib/analytics/deals";
import type { DateRange, DealStatus, FunnelStage } from "@/lib/analytics/types";
import { formatNumber } from "@/lib/format";

type FunnelMode = "created" | "active" | "reached";

const CATEGORY_PAGE_SIZE = 50;
const STAGE_PAGE_SIZE = 50;

/** Совпадает с priority WON→LOSE в normalizeDeal (packages/jobs/src/deals-sync.ts,
 * ранее lib/analytics/deals.ts) — терминальные стадии Bitrix24 всегда содержат
 * WON/LOSE в коде стадии. */
function stageStatusOf(stageId: string): DealStatus {
	if (stageId.includes("WON")) return "won";
	if (stageId.includes("LOSE")) return "lost";
	return "in_progress";
}

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
	const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
	// stageNames нужны только за порядком стадий в воронке (SORT из Bitrix
	// pipeline) — сами подписи groupDealsBy уже резолвит на сервере.
	const { data, isLoading, isError } = useBitrixData(["stageNames"]);
	const stageNames = data?.stageNames ?? new Map<string, StageInfo>();

	// "Активно сейчас" — снэпшот без фильтра по дате создания (как раньше
	// fetchOpenDeals), поэтому range не передаём вовсе — не 30-дневный дефолт.
	const range = mode === "active" ? undefined : reportFilter;
	const status = mode === "active" ? ("in_progress" as const) : undefined;

	const byCategory = useDealsReport({
		dimension: "category",
		range,
		status,
		page: 1,
		pageSize: CATEGORY_PAGE_SIZE,
		sort: "deals",
	});
	const categories = byCategory.data?.rows ?? [];
	const selectedCategoryId = activeCategoryId ?? categories[0]?.key ?? null;

	const stageReport = useDealsReport({
		dimension: "stage",
		range,
		status,
		categoryId: selectedCategoryId ?? undefined,
		page: 1,
		pageSize: STAGE_PAGE_SIZE,
		sort: "deals",
		enabled: selectedCategoryId !== null && mode !== "reached",
	});

	if (isLoading || byCategory.isLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (isError || byCategory.isError) {
		return (
			<p className="text-sm text-destructive">
				Не удалось загрузить данные. Попробуйте обновить страницу.
			</p>
		);
	}
	if (!data?.connected) return <NotConnected />;

	const selectedCategory = categories.find((c) => c.key === selectedCategoryId);
	const categoryTotal = selectedCategory?.deals ?? 0;
	const stages: FunnelStage[] = (stageReport.data?.rows ?? [])
		.map((row) => ({
			stageId: row.key,
			label: row.label,
			deals: row.deals,
			opportunitySum: row.opportunitySum,
			share: categoryTotal > 0 ? row.deals / categoryTotal : 0,
			status: stageStatusOf(row.key),
		}))
		.sort(
			(a, b) =>
				(stageNames.get(a.stageId)?.sort ?? Number.MAX_SAFE_INTEGER) -
				(stageNames.get(b.stageId)?.sort ?? Number.MAX_SAFE_INTEGER),
		);

	// Check for stageReport errors (when enabled) - mode "reached" has separate handling
	if (mode !== "reached" && stageReport.isError) {
		return (
			<p className="text-sm text-destructive">
				Не удалось загрузить данные стадий. Попробуйте обновить страницу.
			</p>
		);
	}

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

			{categories.length === 0 ? (
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
				<Tabs
					value={selectedCategoryId ?? undefined}
					onValueChange={setActiveCategoryId}
				>
					<TabsList className="max-w-full justify-start overflow-x-auto">
						{categories.map((category) => (
							<TabsTrigger key={category.key} value={category.key}>
								{category.label}
								<Badge variant="secondary">
									{formatNumber(category.deals)}
								</Badge>
							</TabsTrigger>
						))}
					</TabsList>

					{selectedCategoryId && (
						<TabsContent value={selectedCategoryId}>
							{mode === "reached" ? (
								<StageReachPanel
									categoryId={selectedCategoryId}
									stageNames={stageNames}
									reportFilter={reportFilter}
								/>
							) : (
								<FunnelStages
									stages={stages}
									mode={mode}
									categoryId={selectedCategoryId}
									reportFilter={reportFilter}
								/>
							)}
						</TabsContent>
					)}
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
	return (
		<FunnelChart
			steps={steps}
			title="Уникальные сделки по этапам"
			showConversion={false}
			hint="Как считается: для каждого этапа — количество уникальных сделок, у которых хотя бы раз был переход на этот этап с датой входа внутри выбранного периода (источник: история стадий Bitrix24, crm.stagehistory.list). Если сделка заходила на этап несколько раз, она всё равно считается один раз. Этапы посчитаны независимо друг от друга — это не последовательная воронка: сделка может быть учтена на позднем этапе, даже если на ранний этап она зашла до начала периода, поэтому конверсия и «потери» между этапами здесь не считаются."
		/>
	);
}
