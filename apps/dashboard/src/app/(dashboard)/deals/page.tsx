"use client";

import { AlertCircleIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { DealsTable } from "@/components/dashboard/deals-table";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBitrixData } from "@/hooks/use-bitrix-data";

function DealsPageSkeleton() {
	return (
		<Card>
			<CardHeader>
				<Skeleton className="h-5 w-24" />
				<Skeleton className="h-4 w-52" />
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex gap-2">
					<Skeleton className="h-8 flex-1" />
					<Skeleton className="h-8 w-36" />
					<Skeleton className="h-8 w-40" />
				</div>
				<Skeleton className="h-80 w-full" />
			</CardContent>
		</Card>
	);
}

export default function DealsPage() {
	return (
		<PageSuspense>
			<DealsPageContent />
		</PageSuspense>
	);
}

function DealsPageContent() {
	const searchParams = useSearchParams();
	// Справочники (имена источников/стадий/воронок, домен портала) по-прежнему
	// живьём из Bitrix24 — дешёвые нефильтруемые запросы. Сами сделки теперь
	// тянет DealsTable из локального зеркала (/api/dashboard/deals), а не эта
	// страница — см. lib/analytics/deals.ts и packages/db/src/queries/deals.ts.
	const {
		data: enrichmentData,
		isLoading,
		isError,
		isFetching,
		refetch,
	} = useBitrixData([
		"sourceNames",
		"categoryNames",
		"stageNames",
		"dealDomain",
	]);

	if (isLoading) return <DealsPageSkeleton />;

	if (isError) {
		return (
			<Alert variant="destructive">
				<AlertCircleIcon />
				<AlertTitle>Не удалось загрузить сделки</AlertTitle>
				<AlertDescription>
					Проверьте подключение к Bitrix24 и попробуйте ещё раз.
				</AlertDescription>
				<Button
					variant="outline"
					size="sm"
					className="mt-2 w-fit"
					disabled={isFetching}
					onClick={() => void refetch()}
				>
					{isFetching ? "Повторная загрузка…" : "Попробовать снова"}
				</Button>
			</Alert>
		);
	}

	if (!enrichmentData?.connected) return <NotConnected />;

	const rawStatus = searchParams.get("status");
	const initialStatus =
		rawStatus === "won" || rawStatus === "lost" || rawStatus === "in_progress"
			? rawStatus
			: undefined;

	// Validate category, stage, and source against loaded dictionaries
	const rawCategory = searchParams.get("category");
	const initialCategory =
		rawCategory && enrichmentData.categoryNames?.has(rawCategory)
			? rawCategory
			: undefined;

	const rawStage = searchParams.get("stage");
	const initialStage =
		rawStage && enrichmentData.stageNames?.has(rawStage) ? rawStage : undefined;

	const rawSource = searchParams.get("source");
	const initialSource =
		rawSource && enrichmentData.sourceNames?.has(rawSource)
			? rawSource
			: undefined;

	// Ссылка из исторической воронки (funnel/page.tsx, режим "Достигли этапа") —
	// отдельный от initialStage/initialCategory фильтр по истории стадий.
	const rawReachedStage = searchParams.get("reachedStage");
	const rawReachedCategory = searchParams.get("reachedCategory");
	const reachedStageInfo =
		rawReachedStage && enrichmentData.stageNames?.get(rawReachedStage);
	const initialReachedStage =
		rawReachedStage &&
		rawReachedCategory &&
		reachedStageInfo &&
		enrichmentData.categoryNames?.has(rawReachedCategory)
			? {
					stageId: rawReachedStage,
					categoryId: rawReachedCategory,
					stageLabel: reachedStageInfo.name,
				}
			: undefined;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Сделки</CardTitle>
			</CardHeader>
			<CardContent>
				<DealsTable
					key={searchParams.toString()}
					sourceNames={enrichmentData.sourceNames}
					categoryNames={enrichmentData.categoryNames}
					stageNames={enrichmentData.stageNames}
					dealDomain={enrichmentData.dealDomain}
					initialStatus={initialStatus}
					initialCategory={initialCategory}
					initialStage={initialStage}
					initialSource={initialSource}
					reachedStage={initialReachedStage}
				/>
			</CardContent>
		</Card>
	);
}
