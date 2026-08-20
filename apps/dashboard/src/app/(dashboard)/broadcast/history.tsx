"use client";

import { useQuery } from "@tanstack/react-query";
import type { Broadcast } from "@psi-opora/db/queries";
import Link from "next/link";
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

const CHANNEL_SHORT: Record<string, string> = {
	auto: "Авто",
	telegram: "Telegram",
	max: "MAX",
};

export const broadcastsListKey = ["dashboard-broadcasts"];

export function formatDateTime(date: Date | string | null): string {
	if (!date) return "—";
	return new Intl.DateTimeFormat("ru-RU", {
		dateStyle: "short",
		timeStyle: "short",
	}).format(new Date(date));
}

export function BroadcastHistory() {
	const { data: broadcasts = [], isLoading } = useQuery({
		queryKey: broadcastsListKey,
		queryFn: async () => {
			const res = await fetch("/api/dashboard/broadcasts");
			if (!res.ok) throw new Error("Не удалось загрузить историю рассылок");
			const json = (await res.json()) as { broadcasts: Broadcast[] };
			return json.broadcasts;
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>История рассылок</CardTitle>
				<CardDescription>
					Последние рассылки; нажмите на строку, чтобы посмотреть получателей и
					статусы доставки.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<p className="text-sm text-muted-foreground">Загрузка…</p>
				) : broadcasts.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Рассылок ещё не было. История появится после первой отправки
						(требуется подключённая база данных).
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Дата</TableHead>
								<TableHead>Стадия</TableHead>
								<TableHead>Канал</TableHead>
								<TableHead>Сообщение</TableHead>
								<TableHead className="text-right">Отправлено</TableHead>
								<TableHead className="text-right">Ошибки</TableHead>
								<TableHead>Статус</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{broadcasts.map((b) => (
								<TableRow key={b.id}>
									<TableCell className="whitespace-nowrap">
										<Link
											href={`/broadcast/${b.id}`}
											className="underline underline-offset-2"
										>
											{formatDateTime(b.startedAt)}
										</Link>
									</TableCell>
									<TableCell>{b.stageName ?? b.stageId}</TableCell>
									<TableCell>{CHANNEL_SHORT[b.channel] ?? b.channel}</TableCell>
									<TableCell className="max-w-64 truncate text-muted-foreground">
										{b.message}
									</TableCell>
									<TableCell className="text-right">{b.sentCount}</TableCell>
									<TableCell className="text-right">{b.failedCount}</TableCell>
									<TableCell>
										{b.status === "done" ? (
											<Badge variant="default">Завершена</Badge>
										) : b.status === "error" ? (
											<Badge variant="destructive">Ошибка</Badge>
										) : (
											<Badge variant="secondary">Выполняется</Badge>
										)}
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
