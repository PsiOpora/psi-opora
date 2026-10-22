"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatDateTime } from "@/components/email/email-format";
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
import { OutreachStatusBadge } from "./outreach-format";

export function OutreachHistory() {
	const { data: campaigns = [], isLoading } = useQuery(
		orpc.outreach.list.queryOptions({
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
				<CardTitle>История рассылок</CardTitle>
				<CardDescription>
					Нажмите на рассылку, чтобы увидеть, кому и через какой канал ушло
					сообщение.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<p className="text-sm text-muted-foreground">Загрузка…</p>
				) : campaigns.length === 0 ? (
					<p className="text-sm text-muted-foreground">Рассылок ещё не было.</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Дата</TableHead>
								<TableHead>Список</TableHead>
								<TableHead>Сообщение</TableHead>
								<TableHead className="text-right">Всего</TableHead>
								<TableHead className="text-right">MAX</TableHead>
								<TableHead className="text-right">Telegram</TableHead>
								<TableHead className="text-right">WhatsApp</TableHead>
								<TableHead className="text-right">Email</TableHead>
								<TableHead className="text-right">Не дошло</TableHead>
								<TableHead>Статус</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{campaigns.map((c) => (
								<TableRow key={c.id}>
									<TableCell className="whitespace-nowrap">
										<Link
											href={`/outreach/${c.id}`}
											className="underline underline-offset-2"
										>
											{formatDateTime(c.createdAt)}
										</Link>
									</TableCell>
									<TableCell className="max-w-48 truncate">
										{c.listName ?? "удалён"}
									</TableCell>
									<TableCell className="max-w-64 truncate text-muted-foreground">
										{c.message}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{c.stats.total.toLocaleString("ru-RU")}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{c.stats.sentMax.toLocaleString("ru-RU")}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{c.stats.sentTelegram.toLocaleString("ru-RU")}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{c.stats.sentWhatsapp.toLocaleString("ru-RU")}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{c.stats.email.toLocaleString("ru-RU")}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{(c.stats.failed + c.stats.unknown).toLocaleString("ru-RU")}
									</TableCell>
									<TableCell>
										<OutreachStatusBadge
											status={c.status}
											resumeAt={c.resumeAt}
										/>
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
