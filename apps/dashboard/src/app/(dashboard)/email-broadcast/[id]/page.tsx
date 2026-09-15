"use client";

import type {
	EmailCampaign,
	EmailCampaignRecipientRow,
} from "@psi-opora/db/queries";
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
import { AutoRefresh } from "./auto-refresh";
import { emailCampaignDetailKey } from "./query-keys";

const STATUS_BADGE: Record<
	string,
	{
		label: string;
		variant: "default" | "secondary" | "destructive" | "outline";
	}
> = {
	pending: { label: "В очереди", variant: "secondary" },
	imported: { label: "Импортирован в Unisender", variant: "default" },
	skipped: { label: "Пропущен", variant: "outline" },
	error: { label: "Ошибка", variant: "destructive" },
};

const RECIPIENTS_PAGE_SIZE = 50;

export default function EmailCampaignDetailsPage() {
	const params = useParams<{ id: string }>();
	const id = params.id;
	const [pageIndex, setPageIndex] = useState(0);

	const { data, isLoading, isError } = useQuery({
		queryKey: emailCampaignDetailKey(id),
		queryFn: async () => {
			const res = await fetch(`/api/dashboard/email-campaigns/${id}`);
			if (!res.ok) throw new Error("Рассылка не найдена");
			return (await res.json()) as {
				campaign: EmailCampaign;
				recipients: EmailCampaignRecipientRow[];
			};
		},
	});

	const recipients = useMemo(() => data?.recipients ?? [], [data]);

	const counts = useMemo(() => {
		const result = { imported: 0, pending: 0, skipped: 0, failed: 0 };
		for (const r of recipients) {
			if (r.status === "imported") result.imported++;
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
	if (isError || !data?.campaign) {
		return <p className="text-sm text-destructive">Рассылка не найдена.</p>;
	}

	const { campaign } = data;
	const isRunning =
		campaign.status === "queued" || campaign.status === "running";

	return (
		<div className="flex w-full flex-col gap-6">
			<AutoRefresh enabled={isRunning} id={id} />
			<div>
				<Link
					href="/email-broadcast"
					className="text-sm text-muted-foreground underline underline-offset-2"
				>
					← К email-рассылкам
				</Link>
				<h1 className="text-2xl font-semibold mt-2">
					Рассылка от {formatDateTime(campaign.startedAt)}
				</h1>
				<p className="text-sm text-muted-foreground mt-1">
					{campaign.stageName ?? campaign.stageId} · Шаблон:{" "}
					{campaign.templateName ?? campaign.templateId} · Сделок:{" "}
					{campaign.totalDeals ?? "—"} · Импортировано: {counts.imported}
					{counts.pending > 0 && ` · В очереди: ${counts.pending}`} · Пропущено:{" "}
					{counts.skipped} · Ошибок импорта: {counts.failed}
				</p>
				{campaign.status === "running" && (
					<p className="text-sm mt-1">
						⏳ Рассылка выполняется — статистика Unisender обновляется
						автоматически каждые 5 минут.
					</p>
				)}
				{campaign.error && (
					<p className="text-sm text-destructive mt-1">{campaign.error}</p>
				)}
			</div>

			<div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(300px,400px)_1fr]">
				<Card>
					<CardHeader>
						<CardTitle>Тема письма</CardTitle>
						<CardDescription>{campaign.subject}</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-2 text-sm">
						<p>
							<span className="text-muted-foreground">Отправитель:</span>{" "}
							{campaign.senderName
								? `${campaign.senderName} <${campaign.senderEmail}>`
								: campaign.senderEmail}
						</p>
						<p>
							<span className="text-muted-foreground">Статус:</span>{" "}
							{campaign.status === "done" ? (
								<Badge variant="default">Завершена</Badge>
							) : campaign.status === "error" ? (
								<Badge variant="destructive">Ошибка</Badge>
							) : (
								<Badge variant="secondary">Выполняется</Badge>
							)}
						</p>
						{campaign.status !== "queued" && (
							<div className="mt-2 grid grid-cols-2 gap-2 text-sm">
								<p>
									<span className="text-muted-foreground">Отправлено:</span>{" "}
									{campaign.sentCount ?? "—"}
								</p>
								<p>
									<span className="text-muted-foreground">Открыто:</span>{" "}
									{campaign.openedCount ?? "—"}
								</p>
								<p>
									<span className="text-muted-foreground">Переходы:</span>{" "}
									{campaign.clickedCount ?? "—"}
								</p>
								<p>
									<span className="text-muted-foreground">Отписались:</span>{" "}
									{campaign.unsubscribedCount ?? "—"}
								</p>
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Получатели</CardTitle>
						<CardDescription>
							Статус отражает импорт в список Unisender, а не факт открытия
							письма — открытия/переходы/отписки показаны агрегированно слева
							(данные Unisender).
						</CardDescription>
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
										<TableHead>Email</TableHead>
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
												<TableCell>{r.email ?? "—"}</TableCell>
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
