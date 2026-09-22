"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExportCsvButton } from "@/components/dashboard/export-csv-button";
import { FunnelChart } from "@/components/dashboard/funnel-chart";
import { DeltaBadge, deltaOf } from "@/components/dashboard/kpi-cards";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
	type BotFunnelTrendPoint,
	MESSENGER_LABELS,
} from "@/lib/analytics/bot-funnel-shared";
import { formatDateParam } from "@/lib/analytics/date-range";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { BotFunnelTrendChart } from "./trend-chart";

interface BotFunnelResponse {
	flows: BotFunnelFlowStats[];
	byMessenger: Array<{ messenger: string; flows: BotFunnelFlowStats[] }>;
	bySource: BotFunnelSourceRow[];
	bySourceByMessenger: Array<{ messenger: string; rows: BotFunnelSourceRow[] }>;
	dropReasons: BotFunnelDropReasonRow[];
	trend: BotFunnelTrendPoint[];
	previous: {
		flows: BotFunnelFlowStats[];
		byMessenger: Array<{ messenger: string; flows: BotFunnelFlowStats[] }>;
		dropReasons: BotFunnelDropReasonRow[];
	};
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

/** Доля от старта последнего шага ветки — для дельты "к предыдущему периоду". */
function finalShareOf(
	flows: BotFunnelFlowStats[],
	flow: string,
): number | undefined {
	const steps = flows.find((f) => f.flow === flow)?.steps;
	return steps?.[steps.length - 1]?.shareOfStart;
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
	const [includeTest, setIncludeTest] = useState(false);
	const { data, isLoading, isError } = useQuery({
		queryKey: [
			"dashboard-bot-funnel",
			range.from.toISOString(),
			range.to.toISOString(),
			includeTest,
		],
		queryFn: async () => {
			const params = new URLSearchParams({
				from: range.from.toISOString(),
				to: range.to.toISOString(),
				...(includeTest ? { includeTest: "1" } : {}),
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
	const bySourceByMessenger = data?.bySourceByMessenger ?? [];
	const dropReasons = data?.dropReasons ?? [];
	const trend = data?.trend ?? [];
	const previousFlows = data?.previous.flows ?? [];
	const previousByMessenger = data?.previous.byMessenger ?? [];
	const previousDropReasons = data?.previous.dropReasons ?? [];

	// "start" общий для обеих веток (см. flowCascade в bot-funnel-shared.ts),
	// поэтому берём его из любой ветки — дублирования между flows нет.
	const reachedBot =
		flows[0]?.steps.find((s) => s.step === "start")?.count ?? 0;
	const previousReachedBot =
		previousFlows[0]?.steps.find((s) => s.step === "start")?.count ?? 0;
	const declinedConsent = dropReasons
		.filter((r) => r.step === "consent" && r.reason === "declined")
		.reduce((sum, r) => sum + r.count, 0);
	const previousDeclinedConsent = previousDropReasons
		.filter((r) => r.step === "consent" && r.reason === "declined")
		.reduce((sum, r) => sum + r.count, 0);
	const isEmpty =
		flows.every((f) => f.steps.every((s) => s.count === 0)) &&
		dropReasons.length === 0;
	const includeTestToggle = (
		<label
			htmlFor="include-test-traffic"
			className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
		>
			<Checkbox
				id="include-test-traffic"
				checked={includeTest}
				onCheckedChange={(checked) => setIncludeTest(checked === true)}
			/>
			Показывать тестовый трафик
		</label>
	);

	if (isEmpty) {
		return (
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div>
							<CardTitle>Воронка бота</CardTitle>
							<CardDescription>
								За выбранный период событий нет. Счётчики шагов начинают
								накапливаться после деплоя ботов с трекингом — исторические
								данные до этого момента недоступны.
							</CardDescription>
						</div>
						{includeTestToggle}
					</div>
				</CardHeader>
			</Card>
		);
	}

	const messengerTabs: Array<{
		value: string;
		label: string;
		flows: BotFunnelFlowStats[];
		previousFlows: BotFunnelFlowStats[];
		sourceRows: BotFunnelSourceRow[];
	}> = [
		{
			value: "all",
			label: "Все мессенджеры",
			flows,
			previousFlows,
			sourceRows: bySource,
		},
		...byMessenger.map(({ messenger, flows: ms }) => ({
			value: messenger,
			label: MESSENGER_LABELS[messenger] ?? messenger,
			flows: ms,
			previousFlows:
				previousByMessenger.find((item) => item.messenger === messenger)
					?.flows ?? [],
			sourceRows:
				bySourceByMessenger.find((s) => s.messenger === messenger)?.rows ?? [],
		})),
	];

	return (
		<div className="flex flex-col gap-4">
			<div>
				<p className="text-sm text-muted-foreground">
					Статистика по выдаче материалов по кодовому слову (например, SCHOOL) —
					в{" "}
					<Link
						href="/settings/bot"
						className="underline underline-offset-2 hover:no-underline"
					>
						Настройках бота
					</Link>
					, карточка «Кампании гайдов».
				</p>
			</div>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Card>
					<CardHeader>
						<CardDescription>Дошли до бота</CardDescription>
						<CardTitle className="text-2xl tabular-nums">
							{formatNumber(reachedBot)}
						</CardTitle>
						<CardAction>
							<DeltaBadge delta={deltaOf(reachedBot, previousReachedBot)} />
						</CardAction>
					</CardHeader>
					<CardContent className="text-xs text-muted-foreground">
						Уникальные пользователи, запустившие бота (/start) за выбранный
						период · к предыдущему периоду той же длины
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>Не приняли согласие на ПДн</CardDescription>
						<CardTitle className="text-2xl tabular-nums">
							{formatNumber(declinedConsent)}
						</CardTitle>
						<CardAction>
							<DeltaBadge
								delta={deltaOf(declinedConsent, previousDeclinedConsent)}
							/>
						</CardAction>
					</CardHeader>
					<CardContent className="text-xs text-muted-foreground">
						{reachedBot > 0
							? `${formatPercent(declinedConsent / reachedBot)} от дошедших до бота`
							: "Отказались от обработки персональных данных на шаге согласия"}
					</CardContent>
				</Card>
			</div>

			<BotFunnelTrendChart data={trend} />

			<Card>
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div>
							<CardTitle>Воронка бота</CardTitle>
							<CardDescription>
								Путь пользователя от запуска бота до заявки в CRM за выбранный
								период, отдельно по веткам «Консультация» и «Гайд» — после
								/start пользователь выбирает одну из них, поэтому шаги одной
								ветки не сравнимы с шагами другой. Число на каждом шаге —
								уникальные пользователи мессенджера (по их ID): если один и тот
								же человек несколько раз нажал /start, он всё равно посчитан
								один раз. Клик по числу открывает список этих клиентов.
							</CardDescription>
						</div>
						{includeTestToggle}
					</div>
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
										previousFinalShare={finalShareOf(
											tab.previousFlows,
											flow.flow,
										)}
									/>
								))}

								<SourceCard
									rows={tab.sourceRows}
									range={range}
									showExport={tab.value === "all"}
								/>
							</TabsContent>
						))}
					</Tabs>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div>
							<CardTitle>Причины отвала</CardTitle>
							<CardDescription>
								Не молчание вообще, а конкретная причина, зафиксированная в
								момент события: явный отказ, исчерпанные попытки, истёкшее без
								ответа напоминание или заблокированный бот. Клик по числу —
								список этих клиентов.
							</CardDescription>
						</div>
						<CardAction>
							<ExportCsvButton
								filename="bot-funnel-drop-reasons.csv"
								headers={["Шаг", "Причина", "Мессенджер", "Клиентов"]}
								rows={dropReasons.map((row) => [
									row.stepLabel,
									row.reasonLabel,
									MESSENGER_LABELS[row.messenger] ?? row.messenger,
									row.count,
								])}
							/>
						</CardAction>
					</div>
				</CardHeader>
				<CardContent>
					<DropReasonsTable rows={dropReasons} range={range} />
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

type SourceSortKey =
	| "source"
	| "starts"
	| "clicks"
	| "phones"
	| "deals"
	| "conversion"
	| "spend"
	| "cpl"
	| "cac"
	| "roas"
	| "wonSum";

function SourceCard({
	rows,
	range,
	showExport,
}: {
	rows: BotFunnelSourceRow[];
	range: { from: Date; to: Date };
	showExport: boolean;
}) {
	const [search, setSearch] = useState("");
	const [sort, setSort] = useState<{ key: SourceSortKey; dir: "asc" | "desc" }>(
		{ key: "starts", dir: "desc" },
	);

	const filtered = rows.filter((row) => {
		if (!search.trim()) return true;
		const needle = search.trim().toLowerCase();
		return (
			row.source.toLowerCase().includes(needle) ||
			row.campaign.toLowerCase().includes(needle)
		);
	});
	const sorted = [...filtered].sort((a, b) => {
		const dir = sort.dir === "asc" ? 1 : -1;
		if (sort.key === "source") {
			return dir * a.source.localeCompare(b.source);
		}
		const av = a[sort.key] ?? -Infinity;
		const bv = b[sort.key] ?? -Infinity;
		return dir * (av - bv);
	});

	function toggleSort(key: SourceSortKey) {
		setSort((prev) =>
			prev.key === key
				? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
				: { key, dir: "desc" },
		);
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between gap-4">
					<div>
						<CardTitle>По источникам и кампаниям</CardTitle>
						<CardDescription className="mt-1">
							Параметры из deep-link бота
							(?start=utm_source=…&amp;utm_campaign=…) — где теряются лиды до
							попадания в CRM. Расход/CPL/CAC/ROAS проставлены там, где номер
							кампании в её имени совпал с ID кампании в Яндекс.Директ или
							UTM-кампания вручную привязана в настройках рекламы — для
							остального трафика показан прочерк.
						</CardDescription>
					</div>
					{showExport && (
						<CardAction>
							<ExportCsvButton
								filename="bot-funnel-sources.csv"
								headers={[
									"Источник",
									"Кампания",
									"Кампания в кабинете",
									"Стартов",
									"Нажали кнопку",
									"Телефонов",
									"Заявок",
									"Конверсия, %",
									"Выиграно сделок",
									"Сумма выигранных",
									"Расход",
									"CPL",
									"CAC",
									"ROAS",
								]}
								rows={sorted.map((row) => [
									row.source,
									row.campaign,
									row.adCampaignName ?? "",
									row.starts,
									row.clicks,
									row.phones,
									row.deals,
									(row.conversion * 100).toFixed(1),
									row.wonDeals ?? "",
									row.wonSum ?? "",
									row.spend ?? "",
									row.cpl?.toFixed(2) ?? "",
									row.cac?.toFixed(2) ?? "",
									row.roas?.toFixed(2) ?? "",
								])}
							/>
						</CardAction>
					)}
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<Input
					placeholder="Поиск по источнику или кампании…"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="max-w-xs"
				/>
				<SourceTable
					rows={sorted}
					range={range}
					sort={sort}
					onSort={toggleSort}
				/>
			</CardContent>
		</Card>
	);
}

function SortableHead({
	label,
	sortKey,
	sort,
	onSort,
	align = "right",
}: {
	label: string;
	sortKey: SourceSortKey;
	sort: { key: SourceSortKey; dir: "asc" | "desc" };
	onSort: (key: SourceSortKey) => void;
	align?: "left" | "right";
}) {
	const active = sort.key === sortKey;
	const Icon = sort.dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
	return (
		<TableHead
			aria-sort={
				active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
			}
			className={align === "right" ? "text-right" : undefined}
		>
			<button
				type="button"
				onClick={() => onSort(sortKey)}
				className={`inline-flex items-center gap-1 hover:text-foreground ${
					align === "right" ? "flex-row-reverse" : ""
				}`}
			>
				{label}
				{active && <Icon className="size-3" />}
			</button>
		</TableHead>
	);
}

function SourceTable({
	rows,
	range,
	sort,
	onSort,
}: {
	rows: BotFunnelSourceRow[];
	range: { from: Date; to: Date };
	sort: { key: SourceSortKey; dir: "asc" | "desc" };
	onSort: (key: SourceSortKey) => void;
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
						<SortableHead
							label="Источник"
							sortKey="source"
							sort={sort}
							onSort={onSort}
							align="left"
						/>
						<TableHead>Кампания</TableHead>
						<SortableHead
							label="Стартов"
							sortKey="starts"
							sort={sort}
							onSort={onSort}
						/>
						<SortableHead
							label="Кнопка"
							sortKey="clicks"
							sort={sort}
							onSort={onSort}
						/>
						<SortableHead
							label="Телефонов"
							sortKey="phones"
							sort={sort}
							onSort={onSort}
						/>
						<SortableHead
							label="Заявок"
							sortKey="deals"
							sort={sort}
							onSort={onSort}
						/>
						<SortableHead
							label="Конверсия"
							sortKey="conversion"
							sort={sort}
							onSort={onSort}
						/>
						<SortableHead
							label="Выиграно, ₽"
							sortKey="wonSum"
							sort={sort}
							onSort={onSort}
						/>
						<SortableHead
							label="Расход"
							sortKey="spend"
							sort={sort}
							onSort={onSort}
						/>
						<SortableHead
							label="CPL"
							sortKey="cpl"
							sort={sort}
							onSort={onSort}
						/>
						<SortableHead
							label="CAC"
							sortKey="cac"
							sort={sort}
							onSort={onSort}
						/>
						<SortableHead
							label="ROAS"
							sortKey="roas"
							sort={sort}
							onSort={onSort}
						/>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.key}>
							<TableCell className="font-medium">{row.source}</TableCell>
							<TableCell className="text-muted-foreground">
								{row.campaign}
								{row.adCampaignName && (
									<div className="text-xs">{row.adCampaignName}</div>
								)}
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
							<TableCell className="text-right tabular-nums">
								{row.wonSum !== undefined ? formatMoney(row.wonSum) : "—"}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{row.spend !== undefined ? formatMoney(row.spend) : "—"}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{row.cpl !== undefined ? formatMoney(row.cpl) : "—"}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{row.cac !== undefined ? formatMoney(row.cac) : "—"}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{row.roas !== undefined ? `${row.roas.toFixed(1)}×` : "—"}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
