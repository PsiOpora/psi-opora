"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
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
import {
	type BotFunnelDropReasonRow,
	type BotFunnelFlowStats,
	type BotFunnelSourceRow,
	MESSENGER_LABELS,
} from "@/lib/analytics/bot-funnel";
import { formatDateParam } from "@/lib/analytics/date-range";
import { formatNumber, formatPercent } from "@/lib/format";

interface BotFunnelResponse {
	flows: BotFunnelFlowStats[];
	byMessenger: Array<{ messenger: string; flows: BotFunnelFlowStats[] }>;
	bySource: BotFunnelSourceRow[];
	dropReasons: BotFunnelDropReasonRow[];
}

/** Ссылка на список уникальных клиентов, дошедших до шага (или
 * остановившихся на нём по причине reason), — см. /bot-funnel/clients
 * и api/dashboard/bot-funnel/clients. */
function clientsHref(params: {
	step: string;
	from: Date;
	to: Date;
	messenger?: string;
	source?: string;
	campaign?: string;
	flow?: string;
	reason?: string;
}): string {
	const search = new URLSearchParams({
		step: params.step,
		from: formatDateParam(params.from),
		to: formatDateParam(params.to),
	});
	if (params.messenger && params.messenger !== "all")
		search.set("messenger", params.messenger);
	if (params.source) search.set("source", params.source);
	if (params.campaign) search.set("campaign", params.campaign);
	if (params.flow) search.set("flow", params.flow);
	if (params.reason) search.set("reason", params.reason);
	return `/bot-funnel/clients?${search.toString()}`;
}

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

	const flows = data?.flows ?? [];
	const byMessenger = data?.byMessenger ?? [];
	const bySource = data?.bySource ?? [];
	const dropReasons = data?.dropReasons ?? [];
	const isEmpty =
		flows.every((f) => f.steps.every((s) => s.count === 0)) &&
		dropReasons.length === 0;

	if (isEmpty) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Воронка бота</CardTitle>
					<CardDescription>
						За выбранный период событий нет. Счётчики шагов начинают
						накапливаться после деплоя ботов с трекингом — исторические данные
						до этого момента недоступны.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const messengerTabs: Array<{
		value: string;
		label: string;
		flows: BotFunnelFlowStats[];
	}> = [
		{ value: "all", label: "Все мессенджеры", flows },
		...byMessenger.map(({ messenger, flows: ms }) => ({
			value: messenger,
			label: MESSENGER_LABELS[messenger] ?? messenger,
			flows: ms,
		})),
	];

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle>Воронка бота</CardTitle>
					<CardDescription>
						Путь пользователя от запуска бота до заявки в CRM за выбранный
						период, отдельно по веткам «Консультация» и «Гайд» — после /start
						пользователь выбирает одну из них, поэтому шаги одной ветки не
						сравнимы с шагами другой. Число на каждом шаге — уникальные
						пользователи мессенджера (по их ID): если один и тот же человек
						несколько раз нажал /start, он всё равно посчитан один раз. Клик по
						числу открывает список этих клиентов.
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
							<TabsContent
								key={tab.value}
								value={tab.value}
								className="flex flex-col gap-6"
							>
								{tab.flows.map((flow) => (
									<FunnelChart
										key={flow.flow}
										title={flow.label}
										steps={flow.steps}
										stepHref={(step) =>
											clientsHref({
												step: step.step,
												from: range.from,
												to: range.to,
												messenger: tab.value,
												flow: flow.flow,
											})
										}
									/>
								))}
							</TabsContent>
						))}
					</Tabs>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Причины отвала</CardTitle>
					<CardDescription>
						Не молчание вообще, а конкретная причина, зафиксированная в момент
						события: явный отказ, исчерпанные попытки, истёкшее без ответа
						напоминание или заблокированный бот. Клик по числу — список этих
						клиентов.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<DropReasonsTable rows={dropReasons} range={range} />
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
					<SourceTable rows={bySource} range={range} />
				</CardContent>
			</Card>
		</div>
	);
}

function DropReasonsTable({
	rows,
	range,
}: {
	rows: BotFunnelDropReasonRow[];
	range: { from: Date; to: Date };
}) {
	if (rows.length === 0) {
		return (
			<p className="text-sm text-muted-foreground py-4">
				За выбранный период причин отвала не зафиксировано.
			</p>
		);
	}
	return (
		<div className="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Шаг</TableHead>
						<TableHead>Причина</TableHead>
						<TableHead>Мессенджер</TableHead>
						<TableHead className="text-right">Клиентов</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.key}>
							<TableCell className="font-medium">{row.stepLabel}</TableCell>
							<TableCell className="text-muted-foreground">
								{row.reasonLabel}
							</TableCell>
							<TableCell>
								<Badge variant="secondary">
									{MESSENGER_LABELS[row.messenger] ?? row.messenger}
								</Badge>
							</TableCell>
							<TableCell className="text-right tabular-nums font-medium">
								<Link
									className="hover:underline underline-offset-2"
									href={clientsHref({
										step: row.step,
										from: range.from,
										to: range.to,
										messenger: row.messenger,
										flow: row.flow,
										reason: row.reason,
									})}
								>
									{formatNumber(row.count)}
								</Link>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function SourceTable({
	rows,
	range,
}: {
	rows: BotFunnelSourceRow[];
	range: { from: Date; to: Date };
}) {
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
								<Link
									className="hover:underline underline-offset-2"
									href={clientsHref({
										step: "start",
										from: range.from,
										to: range.to,
										source: row.source,
										campaign: row.campaign,
									})}
								>
									{formatNumber(row.starts)}
								</Link>
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{formatNumber(row.clicks)}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								<Link
									className="hover:underline underline-offset-2"
									href={clientsHref({
										step: "phone",
										from: range.from,
										to: range.to,
										source: row.source,
										campaign: row.campaign,
									})}
								>
									{formatNumber(row.phones)}
								</Link>
							</TableCell>
							<TableCell className="text-right tabular-nums font-medium">
								<Link
									className="hover:underline underline-offset-2"
									href={clientsHref({
										step: "deal",
										from: range.from,
										to: range.to,
										source: row.source,
										campaign: row.campaign,
									})}
								>
									{formatNumber(row.deals)}
								</Link>
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
