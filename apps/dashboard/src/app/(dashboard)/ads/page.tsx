"use client";

import type { AdStatsResult } from "@psi-opora/api";
import { useQuery } from "@tanstack/react-query";
import { AdStatsError } from "@/components/dashboard/ad-stats-error";
import { Badge } from "@/components/ui/badge";
import {
	Card,
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
import { formatMoney, formatNumber } from "@/lib/format";
import { orpc } from "@/lib/orpc/client";
import { AdRefreshButton } from "./refresh-button";
import { AdTrendChart } from "./trend-chart";

function formatCtr(clicks: number, impressions: number): string {
	if (impressions === 0) return "—";
	return `${((clicks / impressions) * 100).toFixed(2)}%`;
}

function StatusBadge({
	status,
	platform,
}: {
	status: string;
	platform: string;
}) {
	const isActive = status === "RUNNING" || status === "1";
	const label = isActive
		? "Активна"
		: status === "SUSPENDED" || status === "0"
			? "Приостановлена"
			: status;
	return (
		<Badge variant={isActive ? "default" : "secondary"}>
			{platform === "vk" ? "🔵" : "🔴"} {label}
		</Badge>
	);
}

export default function AdsPage() {
	const { data: liveResult, isLoading: liveLoading } = useQuery({
		queryKey: ["dashboard-ad-stats"],
		queryFn: async () => {
			const res = await fetch("/api/dashboard/ad-stats");
			if (!res.ok) throw new Error("Не удалось загрузить данные рекламы");
			return (await res.json()) as {
				data: AdStatsResult | null;
				redisConfigured: boolean;
			};
		},
	});

	const { data: dbStats } = useQuery(
		orpc.ads.stats.queryOptions({ input: {} }),
	);

	if (liveLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}

	const liveData = liveResult?.data ?? null;

	if (!liveData) {
		return (
			<AdStatsError
				message={
					!liveResult?.redisConfigured
						? "Redis не настроен. Настройте REDIS_URL или REDIS_HOST."
						: "Не удалось загрузить данные. Проверьте API-ключи."
				}
			/>
		);
	}

	const dbSummary = dbStats?.summary ?? {
		totalSpend: 0,
		totalImpressions: 0,
		totalClicks: 0,
	};
	const dbRows = dbStats?.rows ?? [];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold">Рекламные кампании</h1>
					<p className="text-sm text-muted-foreground">
						Данные из Яндекс.Директ и VK Ads
						{liveData.lastUpdated &&
							` · обновлено ${new Date(liveData.lastUpdated).toLocaleString("ru-RU")}`}
					</p>
				</div>
				<AdRefreshButton />
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Расход за 7 дней
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatMoney(liveData.totalSpend)}
						</div>
						{dbSummary.totalSpend > 0 &&
							dbSummary.totalSpend !== liveData.totalSpend && (
								<p className="text-xs text-muted-foreground mt-1">
									БД: {formatMoney(dbSummary.totalSpend)}
								</p>
							)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Показы
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatNumber(liveData.totalImpressions)}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Клики
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatNumber(liveData.totalClicks)}
						</div>
					</CardContent>
				</Card>
			</div>

			{dbRows.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>Динамика за 7 дней</CardTitle>
						<CardDescription>
							Агрегированные данные из PostgreSQL
						</CardDescription>
					</CardHeader>
					<CardContent>
						<AdTrendChart rows={dbRows} />
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle>Кампании</CardTitle>
					<CardDescription>Данные за последние 7 дней</CardDescription>
				</CardHeader>
				<CardContent>
					{liveData.campaigns.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Нет активных кампаний или не настроены API-ключи.{" "}
							<a href="/settings/ads" className="underline underline-offset-2">
								Настроить
							</a>
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Кампания</TableHead>
									<TableHead>Платформа</TableHead>
									<TableHead>Статус</TableHead>
									<TableHead className="text-right">Показы</TableHead>
									<TableHead className="text-right">Клики</TableHead>
									<TableHead className="text-right">CTR</TableHead>
									<TableHead className="text-right">Расход</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{liveData.campaigns.map((c) => (
									<TableRow key={c.id}>
										<TableCell className="font-medium">{c.name}</TableCell>
										<TableCell>
											{c.platform === "vk" ? "VK Ads" : "Яндекс.Директ"}
										</TableCell>
										<TableCell>
											<StatusBadge status={c.status} platform={c.platform} />
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(c.impressions)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(c.clicks)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatCtr(c.clicks, c.impressions)}
										</TableCell>
										<TableCell className="text-right tabular-nums font-medium">
											{formatMoney(c.spend)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
