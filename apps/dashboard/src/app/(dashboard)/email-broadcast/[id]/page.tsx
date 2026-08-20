"use client";

import type {
	EmailCampaign,
	EmailCampaignRecipientRow,
} from "@psi-opora/db/queries";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
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

export default function EmailCampaignDetailsPage() {
	const params = useParams<{ id: string }>();
	const id = params.id;

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

	if (isLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (isError || !data?.campaign) {
		return <p className="text-sm text-destructive">Рассылка не найдена.</p>;
	}

	const { campaign, recipients } = data;

	const counts = {
		imported: recipients.filter((r) => r.status === "imported").length,
		pending: recipients.filter((r) => r.status === "pending").length,
		skipped: recipients.filter((r) => r.status === "skipped").length,
		failed: recipients.filter((r) => r.status === "error").length,
	};
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
									{recipients.map((r) => {
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
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
