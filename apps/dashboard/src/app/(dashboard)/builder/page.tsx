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
	const { data, isLoading, isError } = useBitrixData([]);

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

	return <ReportBuilder />;
}
