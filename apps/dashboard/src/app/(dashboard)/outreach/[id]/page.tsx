"use client";

import {
	formatPhone,
	type OUTREACH_RECIPIENT_FILTER_VALUES,
} from "@psi-opora/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	formatDateTime,
	RECIPIENT_STATUS,
} from "@/components/email/email-format";
import { Pager } from "@/components/email/pager";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import {
	CHANNEL_LABELS,
	formatAttempts,
	OutreachStatusBadge,
	RecipientOutcomeBadge,
} from "../outreach-format";

const PAGE_SIZE = 50;
type Filter = (typeof OUTREACH_RECIPIENT_FILTER_VALUES)[number];

const OUTCOME_LABELS: Record<string, string> = {
	sent: "Отправлено",
	email: "Передано в email",
	email_pending: "Ждёт отправки email",
	pending: "В очереди",
	sending: "Отправляется",
	failed: "Не доставлено",
	unknown: "Не подтверждено",
	skipped: "Пропущен",
};

function StatTile({
	label,
	value,
	hint,
	tone,
	active,
	onClick,
}: {
	label: string;
	value: number;
	hint?: string;
	tone?: "bad";
	active: boolean;
	onClick: () => void;
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

export default function OutreachReportPage() {
	const { id } = useParams<{ id: string }>();
	const queryClient = useQueryClient();
	const [filter, setFilter] = useState<Filter>("all");
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const [exporting, setExporting] = useState(false);
	const debouncedSearch = useDebouncedValue(search, 300);

	const {
		data: campaign,
		isLoading,
		isError,
	} = useQuery(
		orpc.outreach.get.queryOptions({
			input: { id },
			refetchInterval: (query) => {
				const status = query.state.data?.status;
				return status === "queued" || status === "running" ? 5_000 : 60_000;
			},
		}),
	);
	const isRunning =
		campaign?.status === "queued" || campaign?.status === "running";
	const { data: recipients, isFetching } = useQuery(
		orpc.outreach.recipients.queryOptions({
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

	const cancel = useMutation(
		orpc.outreach.cancel.mutationOptions({
			onSuccess: () => {
				toast.success("Рассылка отменена");
				queryClient.invalidateQueries({ queryKey: orpc.outreach.key() });
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const exportReport = async () => {
		setExporting(true);
		try {
			const rows = await orpcClient.outreach.exportRecipients({ id });
			downloadCsv(
				`outreach-${id.slice(0, 8)}.csv`,
				[
					"Имя",
					"Телефон",
					"Email",
					"Итог",
					"Канал",
					"Статус письма",
					"Попытки",
					"Ошибка",
					"Отправлено",
				],
				rows.map((r) => [
					r.name ?? "",
					r.phone ?? "",
					r.email ?? "",
					OUTCOME_LABELS[r.status] ?? r.status,
					r.channel ? (CHANNEL_LABELS[r.channel] ?? r.channel) : "",
					r.emailStatus
						? (RECIPIENT_STATUS[r.emailStatus]?.label ?? r.emailStatus)
						: "",
					r.attempts
						.map(
							(a) =>
								`${CHANNEL_LABELS[a.channel] ?? a.channel}: ${a.ok ? "ок" : (a.error ?? "ошибка")}`,
						)
						.join("; "),
					r.error ?? r.emailError ?? "",
					r.sentAt ? formatDateTime(r.sentAt) : "",
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
	if (isError || !campaign) {
		return <p className="text-sm text-destructive">Рассылка не найдена.</p>;
	}

	const { stats } = campaign;
	const selectFilter = (next: Filter) => {
		setFilter((prev) => (prev === next ? "all" : next));
		setPage(0);
	};
	const accounts = [
		campaign.accounts.max && `MAX ${formatPhone(campaign.accounts.max.phone)}`,
		campaign.accounts.telegram &&
			`Telegram ${formatPhone(campaign.accounts.telegram.phone)}`,
		campaign.accounts.whatsapp &&
			`WhatsApp ${formatPhone(campaign.accounts.whatsapp.phone)}`,
		campaign.emailTemplateId &&
			`Email «${campaign.emailSubject ?? campaign.emailTemplateName ?? ""}»`,
	].filter(Boolean);
	const rows = recipients?.rows ?? [];

	return (
		<div className="flex w-full flex-col gap-6">
			<div className="flex flex-col gap-3">
				<Link
					href="/outreach"
					className="text-sm text-muted-foreground underline underline-offset-2"
				>
					← Ко всем рассылкам
				</Link>
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h1 className="flex items-center gap-3 text-2xl font-semibold">
							Рассылка по списку «{campaign.listName ?? "удалён"}»
							<OutreachStatusBadge status={campaign.status} />
						</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							Создана {formatDateTime(campaign.createdAt)}
							{campaign.finishedAt &&
								` · завершена ${formatDateTime(campaign.finishedAt)}`}{" "}
							· каналы: {accounts.join(" → ")} · пауза {campaign.intervalSec} с
						</p>
						{campaign.error && (
							<p className="mt-1 text-sm text-destructive">{campaign.error}</p>
						)}
					</div>
					<div className="flex flex-wrap gap-2">
						{campaign.emailCampaignId && (
							<Button asChild variant="outline">
								<Link href={`/email-broadcast/${campaign.emailCampaignId}`}>
									Статистика писем
								</Link>
							</Button>
						)}
						<Button
							variant="outline"
							onClick={exportReport}
							disabled={exporting}
						>
							<DownloadIcon />
							Отчёт CSV
						</Button>
						{isRunning && (
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="outline" disabled={cancel.isPending}>
										Отменить
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Отменить рассылку?</AlertDialogTitle>
										<AlertDialogDescription>
											Оставшимся в очереди сообщение не уйдёт. Тем, кому
											мессенджеры уже не дошли, письмо всё равно отправится. Уже
											отправленные сообщения не отзываются.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Не отменять</AlertDialogCancel>
										<AlertDialogAction onClick={() => cancel.mutate({ id })}>
											Отменить рассылку
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						)}
					</div>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Сообщение</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="whitespace-pre-wrap text-sm">{campaign.message}</p>
				</CardContent>
			</Card>

			<div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
				<StatTile
					label="Всего"
					value={stats.total}
					active={filter === "all"}
					onClick={() => selectFilter("all")}
				/>
				<StatTile
					label="MAX"
					value={stats.sentMax}
					active={filter === "max"}
					onClick={() => selectFilter("max")}
				/>
				<StatTile
					label="Telegram"
					value={stats.sentTelegram}
					active={filter === "telegram"}
					onClick={() => selectFilter("telegram")}
				/>
				<StatTile
					label="WhatsApp"
					value={stats.sentWhatsapp}
					active={filter === "whatsapp"}
					onClick={() => selectFilter("whatsapp")}
				/>
				<StatTile
					label="Email"
					value={stats.email}
					hint="мессенджеры не сработали"
					active={filter === "email"}
					onClick={() => selectFilter("email")}
				/>
				<StatTile
					label="Не доставлено"
					value={stats.failed}
					tone="bad"
					active={filter === "failed"}
					onClick={() => selectFilter("failed")}
				/>
				<StatTile
					label="Не подтверждено"
					value={stats.unknown}
					hint="могло уйти — повторно не шлём"
					tone="bad"
					active={filter === "unknown"}
					onClick={() => selectFilter("unknown")}
				/>
				<StatTile
					label="В очереди"
					value={stats.pending}
					hint={stats.skipped > 0 ? `пропущено: ${stats.skipped}` : undefined}
					active={filter === "pending"}
					onClick={() => selectFilter("pending")}
				/>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Кому что ушло</CardTitle>
					<CardDescription>
						Цепочка попыток показывает, через какие каналы пробовали и где
						сообщение дошло. Наведите на попытку, чтобы увидеть ошибку.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<Input
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setPage(0);
						}}
						placeholder="Поиск по имени, телефону или email"
						className="md:w-80"
					/>
					{rows.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{isFetching ? "Загрузка…" : "Ничего не найдено."}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Контакт</TableHead>
									<TableHead>Телефон</TableHead>
									<TableHead>Email</TableHead>
									<TableHead>Итог</TableHead>
									<TableHead>Попытки</TableHead>
									<TableHead>Когда</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((r) => (
									<TableRow key={r.id}>
										<TableCell className="font-medium">
											{r.name ?? "—"}
										</TableCell>
										<TableCell className="whitespace-nowrap">
											{r.phone ? formatPhone(r.phone) : "—"}
										</TableCell>
										<TableCell>{r.email ?? "—"}</TableCell>
										<TableCell>
											<div className="flex flex-col items-start gap-1">
												<RecipientOutcomeBadge
													status={r.status}
													channel={r.channel}
												/>
												{r.emailStatus && (
													<Badge
														variant={
															RECIPIENT_STATUS[r.emailStatus]?.variant ??
															"outline"
														}
														className={
															RECIPIENT_STATUS[r.emailStatus]?.className
														}
													>
														Письмо:{" "}
														{RECIPIENT_STATUS[
															r.emailStatus
														]?.label.toLowerCase() ?? r.emailStatus}
													</Badge>
												)}
												{(r.error ?? r.emailError) && (
													<span className="max-w-72 text-xs text-muted-foreground">
														{r.error ?? r.emailError}
													</span>
												)}
											</div>
										</TableCell>
										<TableCell
											className="text-xs text-muted-foreground"
											title={r.attempts
												.map(
													(a) =>
														`${CHANNEL_LABELS[a.channel] ?? a.channel}: ${a.ok ? "доставлено" : (a.error ?? "ошибка")}`,
												)
												.join("\n")}
										>
											{r.attempts.length > 0 ? formatAttempts(r.attempts) : "—"}
										</TableCell>
										<TableCell className="whitespace-nowrap text-muted-foreground">
											{formatDateTime(r.sentAt ?? r.updatedAt)}
										</TableCell>
									</TableRow>
								))}
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
		</div>
	);
}
