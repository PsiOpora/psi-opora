"use client";

import { useQuery } from "@tanstack/react-query";
import { ExportCsvButton } from "@/components/dashboard/export-csv-button";
import { FunnelChart } from "@/components/dashboard/funnel-chart";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDashboardRange } from "@/hooks/use-bitrix-data";
import type {
	BotFunnelSourceRow,
	BotFunnelStepStats,
} from "@/lib/analytics/bot-funnel";
import { formatNumber, formatPercent } from "@/lib/format";

interface BotFunnelResponse {
	steps: BotFunnelStepStats[];
	byMessenger: Array<{ messenger: string; steps: BotFunnelStepStats[] }>;
	bySource: BotFunnelSourceRow[];
	redisConfigured: boolean;
}

const MESSENGER_LABELS: Record<string, string> = {
	telegram: "Telegram",
	max: "MAX",
	all: "Все мессенджеры",
};

export default function BotFunnelPage() {
	return (
		<PageSuspense>
			<BotFunnelPageContent />
		</PageSuspense>
	);
}

function BotFunnelPageContent() {
	const range = useDashboardRange();
	const { data, isLoading, isError } = useQuery({
		queryKey: [
			"dashboard-bot-funnel",
			range.from.toISOString(),
			range.to.toISOString(),
		],
		queryFn: async () => {
			const params = new URLSearchParams({
				from: range.from.toISOString(),
				to: range.to.toISOString(),
			});
			const res = await fetch(`/api/dashboard/bot-funnel?${params}`);
			if (!res.ok) throw new Error("Не удалось загрузить воронку бота");
			return (await res.json()) as BotFunnelResponse;
		},
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

	const steps = data?.steps ?? [];
	const byMessenger = data?.byMessenger ?? [];
	const bySource = data?.bySource ?? [];
	const redisConfigured = data?.redisConfigured ?? false;
	const isEmpty = steps.every((s) => s.count === 0);

	if (isEmpty) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Воронка бота</CardTitle>
					<CardDescription>
						{redisConfigured
							? "За выбранный период событий нет. Счётчики шагов начинают накапливаться после деплоя ботов с трекингом — исторические данные до этого момента недоступны."
							: "Хранилище событий недоступно: REDIS_URL или REDIS_HOST не задан. В k3s адрес задаётся автоматически; локально укажите REDIS_URL."}
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const messengerTabs: Array<{
		value: string;
		label: string;
		data: BotFunnelStepStats[];
	}> = [
		{ value: "all", label: "Все мессенджеры", data: steps },
		...byMessenger.map(({ messenger, steps: ms }) => ({
			value: messenger,
			label: MESSENGER_LABELS[messenger] ?? messenger,
			data: ms,
		})),
	];

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle>Воронка бота</CardTitle>
					<CardDescription>
						Путь пользователя от запуска бота до заявки в CRM за выбранный
						период
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Tabs defaultValue="all" className="w-full">
						<TabsList className="mb-5">
							{messengerTabs.map((tab) => (
								<TabsTrigger key={tab.value} value={tab.value}>
									{tab.label}
								</TabsTrigger>
							))}
						</TabsList>
						{messengerTabs.map((tab) => (
							<TabsContent key={tab.value} value={tab.value}>
								<FunnelChart steps={tab.data} />
							</TabsContent>
						))}
					</Tabs>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div>
							<CardTitle>По источникам и кампаниям</CardTitle>
							<CardDescription className="mt-1">
								Параметры из deep-link бота
								(?start=utm_source=…&amp;utm_campaign=…) — где теряются лиды до
								попадания в CRM
							</CardDescription>
						</div>
						<CardAction>
							<ExportCsvButton
								filename="bot-funnel-sources.csv"
								headers={[
									"Источник",
									"Кампания",
									"Стартов",
									"Нажали кнопку",
									"Телефонов",
									"Заявок",
									"Конверсия, %",
								]}
								rows={bySource.map((row) => [
									row.source,
									row.campaign,
									row.starts,
									row.clicks,
									row.phones,
									row.deals,
									(row.conversion * 100).toFixed(1),
								])}
							/>
						</CardAction>
					</div>
				</CardHeader>
				<CardContent>
					<SourceTable rows={bySource} />
				</CardContent>
			</Card>
		</div>
	);
}

function SourceTable({ rows }: { rows: BotFunnelSourceRow[] }) {
	if (rows.length === 0) {
		return (
			<p className="text-sm text-muted-foreground py-4">
				Нет данных по источникам за этот период.
			</p>
		);
	}
	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Источник</TableHead>
						<TableHead>Кампания</TableHead>
						<TableHead className="text-right">Стартов</TableHead>
						<TableHead className="text-right">Кнопка</TableHead>
						<TableHead className="text-right">Телефонов</TableHead>
						<TableHead className="text-right">Заявок</TableHead>
						<TableHead className="text-right">Конверсия</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.key}>
							<TableCell className="font-medium">{row.source}</TableCell>
							<TableCell className="text-muted-foreground">
								{row.campaign}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{formatNumber(row.starts)}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{formatNumber(row.clicks)}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{formatNumber(row.phones)}
							</TableCell>
							<TableCell className="text-right tabular-nums font-medium">
								{formatNumber(row.deals)}
							</TableCell>
							<TableCell className="text-right">
								<Badge
									variant="secondary"
									className={
										row.conversion >= 0.05
											? "bg-emerald-100 text-emerald-700"
											: undefined
									}
								>
									{formatPercent(row.conversion)}
								</Badge>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
