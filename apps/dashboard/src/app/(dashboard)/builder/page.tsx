"use client";

import { useBitrixData } from "@/hooks/use-bitrix-data";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { ReportBuilder } from "@/components/dashboard/report-builder";

export default function BuilderPage() {
	return (
		<PageSuspense>
			<BuilderPageContent />
		</PageSuspense>
	);
}

function BuilderPageContent() {
	const { data, isLoading, isError } = useBitrixData([
		"deals",
		"sourceNames",
		"categoryNames",
		"stageNames",
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
	const sourceNames = data.sourceNames ?? new Map<string, string>();
	const categoryNames = data.categoryNames ?? new Map<string, string>();
	const stageNames = data.stageNames ?? new Map();

	return (
		<ReportBuilder
			deals={deals}
			dictionaries={{
				sources: Object.fromEntries(sourceNames),
				categories: Object.fromEntries(categoryNames),
				stages: Object.fromEntries(
					[...stageNames].map(([id, stage]) => [id, stage.name]),
				),
			}}
		/>
	);
}
