"use client";

import type { Broadcast, BroadcastRecipientRow } from "@psi-opora/db/queries";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatDateTime } from "../history";
import { TelegramPreview } from "../telegram-preview";
import { AutoRefresh } from "./auto-refresh";
import { broadcastDetailKey } from "./query-keys";
import { ResendFailed } from "./resend-failed";

const CHANNEL_LABEL: Record<string, string> = {
	auto: "Авто (Telegram или MAX)",
	telegram: "Только Telegram",
	max: "Только MAX",
};

const STATUS_BADGE: Record<
	string,
	{
		label: string;
		variant: "default" | "secondary" | "destructive" | "outline";
	}
> = {
	sent: { label: "Отправлено", variant: "default" },
	pending: { label: "В очереди", variant: "secondary" },
	skipped: { label: "Пропущен", variant: "outline" },
	error: { label: "Ошибка", variant: "destructive" },
};

const RECIPIENTS_PAGE_SIZE = 50;

export default function BroadcastDetailsPage() {
	const params = useParams<{ id: string }>();
	const id = params.id;
	const [pageIndex, setPageIndex] = useState(0);

	const { data, isLoading, isError } = useQuery({
		queryKey: broadcastDetailKey(id),
		queryFn: async () => {
			const res = await fetch(`/api/dashboard/broadcasts/${id}`);
			if (!res.ok) throw new Error("Рассылка не найдена");
			return (await res.json()) as {
				broadcast: Broadcast;
				recipients: BroadcastRecipientRow[];
			};
		},
	});

	const recipients = useMemo(() => data?.recipients ?? [], [data]);

	// Пока задача выполняется, счётчики в строке broadcasts ещё не обновлены —
	// считаем по фактическим статусам получателей. Рассылка на большую стадию
	// CRM может насчитывать тысячи получателей, а пока идёт отправка, страница
	// переопрашивается каждые 3 сек (см. AutoRefresh) — один проход вместо
	// четырёх отдельных .filter() и пагинация таблицы ниже держат это дешёвым.
	const counts = useMemo(() => {
		const result = { sent: 0, pending: 0, skipped: 0, failed: 0 };
		for (const r of recipients) {
			if (r.status === "sent") result.sent++;
			else if (r.status === "pending") result.pending++;
			else if (r.status === "skipped") result.skipped++;
			else if (r.status === "error") result.failed++;
		}
		return result;
	}, [recipients]);

	const pageCount = Math.max(
		1,
		Math.ceil(recipients.length / RECIPIENTS_PAGE_SIZE),
	);
	const clampedPageIndex = Math.min(pageIndex, pageCount - 1);
	const pageRecipients = useMemo(
		() =>
			recipients.slice(
				clampedPageIndex * RECIPIENTS_PAGE_SIZE,
				clampedPageIndex * RECIPIENTS_PAGE_SIZE + RECIPIENTS_PAGE_SIZE,
			),
		[recipients, clampedPageIndex],
	);

	if (isLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (isError || !data?.broadcast) {
		return <p className="text-sm text-destructive">Рассылка не найдена.</p>;
	}

	const { broadcast } = data;
	const isRunning = broadcast.status === "running";

	return (
		<div className="flex w-full flex-col gap-6">
			<AutoRefresh enabled={isRunning} id={id} />
			<div>
				<Link
					href="/broadcast"
					className="text-sm text-muted-foreground underline underline-offset-2"
				>
					← К рассылкам
				</Link>
				<h1 className="text-2xl font-semibold mt-2">
					Рассылка от {formatDateTime(broadcast.startedAt)}
				</h1>
				<p className="text-sm text-muted-foreground mt-1">
					{broadcast.stageName ?? broadcast.stageId} ·{" "}
					{CHANNEL_LABEL[broadcast.channel] ?? broadcast.channel} · Сделок:{" "}
					{broadcast.totalDeals ?? "—"} · Отправлено: {counts.sent}
					{counts.pending > 0 && ` · В очереди: ${counts.pending}`} · Пропущено:{" "}
					{counts.skipped} · Ошибок: {counts.failed}
				</p>
				{isRunning && (
					<p className="text-sm mt-1">
						⏳ Рассылка выполняется в фоне — страница обновляется автоматически.
					</p>
				)}
				{broadcast.error && (
					<p className="text-sm text-destructive mt-1">{broadcast.error}</p>
				)}
			</div>

			<div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(300px,400px)_1fr]">
				<Card>
					<CardHeader>
						<CardTitle>Текст сообщения</CardTitle>
					</CardHeader>
					<CardContent>
						<TelegramPreview text={broadcast.message} />
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Получатели</CardTitle>
						<CardDescription>
							Статус «Отправлено» означает, что мессенджер принял сообщение.
							Telegram и MAX не сообщают ботам о прочтении, поэтому статус
							«Просмотрено» недоступен.
						</CardDescription>
						{counts.failed > 0 && !isRunning && (
							<ResendFailed
								broadcastId={broadcast.id}
								failedCount={counts.failed}
							/>
						)}
					</CardHeader>
					<CardContent>
						{recipients.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								Получатели не сохранены.
							</p>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Контакт</TableHead>
										<TableHead>Сделка</TableHead>
										<TableHead>Мессенджер</TableHead>
										<TableHead>Отправлено</TableHead>
										<TableHead>Статус</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{pageRecipients.map((r) => {
										const badge = STATUS_BADGE[r.status] ?? {
											label: r.status,
											variant: "outline" as const,
										};
										return (
											<TableRow key={r.id}>
												<TableCell>{r.contactName ?? r.contactId}</TableCell>
												<TableCell className="text-muted-foreground">
													{r.dealTitle ?? r.dealId ?? "—"}
												</TableCell>
												<TableCell>
													{r.messenger === "telegram"
														? "Telegram"
														: r.messenger === "max"
															? "MAX"
															: "—"}
												</TableCell>
												<TableCell className="whitespace-nowrap">
													{formatDateTime(r.sentAt)}
												</TableCell>
												<TableCell>
													<div className="flex flex-col gap-0.5">
														<Badge variant={badge.variant}>{badge.label}</Badge>
														{r.error && (
															<span
																className={`text-xs ${r.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
															>
																{r.error}
															</span>
														)}
													</div>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						)}
						{recipients.length > RECIPIENTS_PAGE_SIZE && (
							<div className="flex items-center justify-between gap-4 pt-3 text-sm text-muted-foreground">
								<span>
									{clampedPageIndex * RECIPIENTS_PAGE_SIZE + 1}–
									{Math.min(
										recipients.length,
										(clampedPageIndex + 1) * RECIPIENTS_PAGE_SIZE,
									)}{" "}
									из {recipients.length}
								</span>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
										disabled={clampedPageIndex === 0}
									>
										Назад
									</Button>
									<span className="tabular-nums">
										{clampedPageIndex + 1} / {pageCount}
									</span>
									<Button
										variant="outline"
										size="sm"
										onClick={() =>
											setPageIndex((i) => Math.min(pageCount - 1, i + 1))
										}
										disabled={clampedPageIndex >= pageCount - 1}
									>
										Вперёд
									</Button>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
