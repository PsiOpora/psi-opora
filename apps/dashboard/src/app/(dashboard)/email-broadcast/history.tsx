"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatDateTime, formatRate } from "@/components/email/email-format";
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
import { orpc } from "@/lib/orpc/client";

export function CampaignStatusBadge({ status }: { status: string }) {
	if (status === "done") return <Badge variant="default">Завершена</Badge>;
	if (status === "error") return <Badge variant="destructive">Ошибка</Badge>;
	if (status === "queued") return <Badge variant="secondary">В очереди</Badge>;
	return <Badge variant="secondary">Отправляется</Badge>;
}

export function EmailCampaignHistory() {
	const { data: campaigns = [], isLoading } = useQuery(
		orpc.emailCampaigns.list.queryOptions({
			refetchInterval: (query) =>
				query.state.data?.some(
					(c) => c.status === "queued" || c.status === "running",
				)
					? 10_000
					: false,
		}),
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>История email-рассылок</CardTitle>
				<CardDescription>
					Доля открытий и переходов считается от доставленных писем. Нажмите на
					рассылку, чтобы увидеть статус каждого получателя.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<p className="text-sm text-muted-foreground">Загрузка…</p>
				) : campaigns.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Рассылок ещё не было. История появится после первой отправки.
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Дата</TableHead>
								<TableHead>Аудитория</TableHead>
								<TableHead>Тема</TableHead>
								<TableHead className="text-right">Отправлено</TableHead>
								<TableHead className="text-right">Доставлено</TableHead>
								<TableHead className="text-right">Открыли</TableHead>
								<TableHead className="text-right">Перешли</TableHead>
								<TableHead>Статус</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{campaigns.map((c) => (
								<TableRow key={c.id}>
									<TableCell className="whitespace-nowrap">
										<Link
											href={`/email-broadcast/${c.id}`}
											className="underline underline-offset-2"
										>
											{formatDateTime(c.startedAt)}
										</Link>
									</TableCell>
									<TableCell className="max-w-56 truncate">
										{c.audience === "list"
											? `Список: ${c.listName ?? "удалён"}`
											: (c.stageName ?? c.stageId)}
									</TableCell>
									<TableCell className="max-w-64 truncate text-muted-foreground">
										{c.subject}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{c.stats.sent.toLocaleString("ru-RU")}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{c.stats.delivered.toLocaleString("ru-RU")}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatRate(c.stats.opened, c.stats.delivered)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatRate(c.stats.clicked, c.stats.delivered)}
									</TableCell>
									<TableCell>
										<CampaignStatusBadge status={c.status} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
