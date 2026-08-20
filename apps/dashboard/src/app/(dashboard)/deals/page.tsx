"use client";

import { AlertCircleIcon, HandshakeIcon } from "lucide-react";
import { DealsTable } from "@/components/dashboard/deals-table";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useBitrixData } from "@/hooks/use-bitrix-data";
import { formatNumber } from "@/lib/format";

function dealsLabel(count: number): string {
	const mod100 = count % 100;
	const mod10 = count % 10;
	if (mod100 >= 11 && mod100 <= 14) return "сделок";
	if (mod10 === 1) return "сделка";
	if (mod10 >= 2 && mod10 <= 4) return "сделки";
	return "сделок";
}

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
	const { data, isLoading, isError, isFetching, refetch } = useBitrixData([
		"deals",
	]);
	const { data: enrichmentData } = useBitrixData([
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

	if (!data?.connected) return <NotConnected />;

	const deals = data.deals ?? [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Сделки</CardTitle>
				<CardDescription>
					{formatNumber(deals.length)} {dealsLabel(deals.length)} за выбранный
					период
				</CardDescription>
			</CardHeader>
			<CardContent>
				{deals.length === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<HandshakeIcon />
							</EmptyMedia>
							<EmptyTitle>За выбранный период сделок нет</EmptyTitle>
							<EmptyDescription>
								Измените период в верхней панели, чтобы увидеть больше данных.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<DealsTable
						deals={deals}
						sourceNames={enrichmentData?.sourceNames}
						categoryNames={enrichmentData?.categoryNames}
						stageNames={enrichmentData?.stageNames}
						dealDomain={enrichmentData?.dealDomain}
					/>
				)}
			</CardContent>
		</Card>
	);
}
