"use client";

import { EMAIL_RECIPIENT_FILTER_VALUES } from "@psi-opora/api/schemas";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	formatDateTime,
	formatRate,
	PROVIDER_LABELS,
	RECIPIENT_STATUS,
} from "@/components/email/email-format";
import { Pager } from "@/components/email/pager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { downloadCsv } from "@/lib/csv-import";
import { orpc, orpcClient } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";
import { CampaignStatusBadge } from "../history";
import { RecipientEventsDialog } from "./recipient-events-dialog";

const PAGE_SIZE = 50;
type RecipientFilter = (typeof EMAIL_RECIPIENT_FILTER_VALUES)[number];

const FILTER_LABELS: Record<RecipientFilter, string> = {
	all: "Все получатели",
	sent: "Отправлено",
	delivered: "Доставлено",
	opened: "Открыли",
	clicked: "Перешли по ссылке",
	not_opened: "Доставлено, но не открыли",
	bounced: "Не доставлено (bounce)",
	complained: "Жалобы на спам",
	unsubscribed: "Отписались",
	error: "Ошибка отправки",
	skipped: "Пропущены",
	pending: "В очереди",
};

function StatTile({
	label,
	value,
	hint,
	tone,
	onClick,
	active,
}: {
	label: string;
	value: number;
	hint?: string;
	tone?: "good" | "bad";
	onClick?: () => void;
	active?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex flex-col gap-1 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50",
				active && "border-primary ring-1 ring-primary",
			)}
		>
			<span className="text-xs text-muted-foreground">{label}</span>
			<span
				className={cn(
					"text-2xl font-semibold tabular-nums",
					tone === "bad" && value > 0 && "text-destructive",
				)}
			>
				{value.toLocaleString("ru-RU")}
			</span>
			{hint && <span className="text-xs text-muted-foreground">{hint}</span>}
		</button>
	);
}

export default function EmailCampaignDetailsPage() {
	const { id } = useParams<{ id: string }>();
	const [filter, setFilter] = useState<RecipientFilter>("all");
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const [openRecipient, setOpenRecipient] = useState<string | null>(null);
	const [exporting, setExporting] = useState(false);
	const debouncedSearch = useDebouncedValue(search, 300);

	const { data, isLoading, isError } = useQuery(
		orpc.emailCampaigns.get.queryOptions({
			input: { id },
			// Пока идёт отправка — часто; после — реже: открытия и клики
			// приходят вебхуками ещё несколько дней.
			refetchInterval: (query) => {
				const status = query.state.data?.campaign.status;
				return status === "queued" || status === "running" ? 5_000 : 60_000;
			},
		}),
	);
	const isRunning =
		data?.campaign.status === "queued" || data?.campaign.status === "running";
	const { data: recipients, isFetching } = useQuery(
		orpc.emailCampaigns.recipients.queryOptions({
			input: {
				id,
				filter,
				search: debouncedSearch || undefined,
				page,
				pageSize: PAGE_SIZE,
			},
			placeholderData: (prev) => prev,
			refetchInterval: isRunning ? 5_000 : 60_000,
		}),
	);

	const applyFilter = (next: RecipientFilter) => {
		setFilter((current) => (current === next ? "all" : next));
		setPage(0);
	};

	const exportReport = async () => {
		setExporting(true);
		try {
			const rows = await orpcClient.emailCampaigns.exportRecipients({ id });
			downloadCsv(
				`email-campaign-${id.slice(0, 8)}.csv`,
				[
					"Email",
					"Имя",
					"Сделка",
					"Статус",
					"Ошибка",
					"Отправлено",
					"Доставлено",
					"Открыто",
					"Переход",
					"Открытий",
					"Переходов",
					"Bounce",
					"Жалоба",
					"Отписка",
				],
				rows.map((r) => [
					r.email ?? "",
					r.name ?? "",
					r.deal ?? "",
					RECIPIENT_STATUS[r.status]?.label ?? r.status,
					r.error ?? "",
					formatDateTime(r.sentAt),
					formatDateTime(r.deliveredAt),
					formatDateTime(r.openedAt),
					formatDateTime(r.clickedAt),
					r.openCount,
					r.clickCount,
					formatDateTime(r.bouncedAt),
					formatDateTime(r.complainedAt),
					formatDateTime(r.unsubscribedAt),
				]),
			);
		} catch (err) {
			toast.error(`Не удалось выгрузить отчёт: ${(err as Error).message}`);
		} finally {
			setExporting(false);
		}
	};

	if (isLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (isError || !data) {
		return <p className="text-sm text-destructive">Рассылка не найдена.</p>;
	}

	const { campaign, funnel } = data;
	const audienceLabel =
		campaign.audience === "list"
			? `Список «${campaign.listName ?? "удалён"}»`
			: (campaign.stageName ?? campaign.stageId ?? "—");
	const noTrackingYet =
		!isRunning &&
		funnel.sent > 0 &&
		funnel.delivered === 0 &&
		funnel.bounced === 0 &&
		campaign.finishedAt !== null &&
		Date.now() - new Date(campaign.finishedAt).getTime() > 30 * 60_000;
	const rows = recipients?.rows ?? [];

	return (
		<div className="flex w-full flex-col gap-6">
			<div>
				<Link
					href="/email-broadcast"
					className="text-sm text-muted-foreground underline underline-offset-2"
				>
					← К email-рассылкам
				</Link>
				<div className="mt-2 flex flex-wrap items-center gap-3">
					<h1 className="text-2xl font-semibold">{campaign.subject}</h1>
					<CampaignStatusBadge status={campaign.status} />
				</div>
				<p className="mt-1 text-sm text-muted-foreground">
					{formatDateTime(campaign.startedAt)} · {audienceLabel} · Шаблон:{" "}
					{campaign.templateName ?? campaign.templateId} · Отправитель:{" "}
					{campaign.senderName
						? `${campaign.senderName} <${campaign.senderEmail}>`
						: campaign.senderEmail}{" "}
					· {PROVIDER_LABELS[campaign.provider] ?? campaign.provider}
				</p>
				{isRunning && (
					<p className="mt-1 text-sm">
						⏳ Рассылка выполняется — данные обновляются автоматически.
					</p>
				)}
				{campaign.error && (
					<p className="mt-1 text-sm text-destructive">{campaign.error}</p>
				)}
			</div>

			<div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
				<StatTile
					label="Отправлено"
					value={funnel.sent}
					hint={
						funnel.pending > 0
							? `ещё ${funnel.pending} в очереди`
							: `из ${funnel.total - funnel.skipped} к отправке`
					}
					onClick={() => applyFilter("sent")}
					active={filter === "sent"}
				/>
				<StatTile
					label="Доставлено"
					value={funnel.delivered}
					hint={formatRate(funnel.delivered, funnel.sent)}
					onClick={() => applyFilter("delivered")}
					active={filter === "delivered"}
				/>
				<StatTile
					label="Открыли"
					value={funnel.opened}
					hint={`${formatRate(funnel.opened, funnel.delivered)} от доставленных`}
					onClick={() => applyFilter("opened")}
					active={filter === "opened"}
				/>
				<StatTile
					label="Перешли по ссылке"
					value={funnel.clicked}
					hint={`CTR ${formatRate(funnel.clicked, funnel.delivered)} · CTOR ${formatRate(funnel.clicked, funnel.opened)}`}
					onClick={() => applyFilter("clicked")}
					active={filter === "clicked"}
				/>
				<StatTile
					label="Отписались"
					value={funnel.unsubscribed}
					hint={formatRate(funnel.unsubscribed, funnel.delivered)}
					onClick={() => applyFilter("unsubscribed")}
					active={filter === "unsubscribed"}
				/>
				<StatTile
					label="Не доставлено"
					value={funnel.bounced}
					hint={formatRate(funnel.bounced, funnel.sent)}
					tone="bad"
					onClick={() => applyFilter("bounced")}
					active={filter === "bounced"}
				/>
				<StatTile
					label="Жалобы на спам"
					value={funnel.complained}
					tone="bad"
					onClick={() => applyFilter("complained")}
					active={filter === "complained"}
				/>
				<StatTile
					label="Ошибки / пропущены"
					value={funnel.failed + funnel.skipped}
					hint={`${funnel.failed} ошибок · ${funnel.skipped} пропущено`}
					tone="bad"
					onClick={() => applyFilter(funnel.failed > 0 ? "error" : "skipped")}
					active={filter === "error" || filter === "skipped"}
				/>
			</div>

			{noTrackingYet && (
				<div className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
					По рассылке нет ни одного статуса доставки. Скорее всего, не подключён
					вебхук статусов у провайдера —{" "}
					<Link href="/settings/email" className="underline underline-offset-2">
						настройте его в «Настройках Email»
					</Link>
					. Статусы появятся для писем, отправленных после подключения.
				</div>
			)}

			{campaign.provider === "unisender" && campaign.sentCount !== null && (
				<p className="text-xs text-muted-foreground">
					Сводка Unisender: отправлено {campaign.sentCount ?? "—"}, уникальных
					открытий {campaign.openedCount ?? "—"}, переходов{" "}
					{campaign.clickedCount ?? "—"}, отписок{" "}
					{campaign.unsubscribedCount ?? "—"}.
				</p>
			)}

			<Card>
				<CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
					<div>
						<CardTitle>Получатели</CardTitle>
						<CardDescription>
							Нажмите на строку, чтобы увидеть хронологию письма. Открытия
							фиксируются, когда получатель загружает картинки письма, поэтому
							реальное число прочтений обычно выше.
						</CardDescription>
					</div>
					<Button variant="outline" onClick={exportReport} disabled={exporting}>
						<DownloadIcon />
						Отчёт CSV
					</Button>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-col gap-2 md:flex-row">
						<Input
							value={search}
							onChange={(e) => {
								setSearch(e.target.value);
								setPage(0);
							}}
							placeholder="Поиск по email, имени или сделке"
							className="md:w-72"
						/>
						<Select
							value={filter}
							onValueChange={(v) => {
								setFilter(v as RecipientFilter);
								setPage(0);
							}}
						>
							<SelectTrigger className="md:w-64">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{EMAIL_RECIPIENT_FILTER_VALUES.map((value) => (
									<SelectItem key={value} value={value}>
										{FILTER_LABELS[value]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{rows.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{isFetching
								? "Загрузка…"
								: "Нет получателей под выбранный фильтр."}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Email</TableHead>
									<TableHead>
										{campaign.audience === "list" ? "Имя" : "Контакт / сделка"}
									</TableHead>
									<TableHead>Статус</TableHead>
									<TableHead>Доставлено</TableHead>
									<TableHead>Открыто</TableHead>
									<TableHead className="text-right">
										Открытий / кликов
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((r) => {
									const status = RECIPIENT_STATUS[r.status] ?? {
										label: r.status,
										variant: "outline" as const,
									};
									return (
										<TableRow
											key={r.id}
											className="cursor-pointer"
											onClick={() => setOpenRecipient(r.id)}
										>
											<TableCell className="font-medium">
												{/* Кнопка — чтобы хронологию можно было открыть с клавиатуры;
												    щелчок по остальной строке делает то же самое мышью. */}
												<button
													type="button"
													className="text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
													aria-label={`Хронология письма для ${r.email ?? "получателя"}`}
													onClick={(e) => {
														e.stopPropagation();
														setOpenRecipient(r.id);
													}}
												>
													{r.email ?? "—"}
												</button>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{r.contactName ?? "—"}
												{r.dealTitle && (
													<span className="block text-xs">{r.dealTitle}</span>
												)}
											</TableCell>
											<TableCell>
												<div className="flex flex-col gap-0.5">
													<Badge
														variant={status.variant}
														className={status.className}
													>
														{status.label}
													</Badge>
													{r.error && (
														<span
															className={cn(
																"max-w-72 truncate text-xs",
																r.status === "error" || r.status === "bounced"
																	? "text-destructive"
																	: "text-muted-foreground",
															)}
															title={r.error}
														>
															{r.error}
														</span>
													)}
												</div>
											</TableCell>
											<TableCell className="whitespace-nowrap text-muted-foreground">
												{formatDateTime(r.deliveredAt)}
											</TableCell>
											<TableCell className="whitespace-nowrap text-muted-foreground">
												{formatDateTime(r.openedAt)}
											</TableCell>
											<TableCell className="text-right tabular-nums text-muted-foreground">
												{r.openCount} / {r.clickCount}
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
					<Pager
						page={page}
						pageSize={PAGE_SIZE}
						total={recipients?.total ?? 0}
						onPageChange={setPage}
					/>
				</CardContent>
			</Card>

			<RecipientEventsDialog
				recipientId={openRecipient}
				onClose={() => setOpenRecipient(null)}
			/>
		</div>
	);
}
