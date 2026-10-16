"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	formatDateTime,
	SUPPRESSION_REASON_LABELS,
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
import { orpc } from "@/lib/orpc/client";

const PAGE_SIZE = 50;

/**
 * Глобальный стоп-лист: адреса, которым рассылки не уходят никогда —
 * ни по спискам, ни по стадиям CRM. Пополняется автоматически (отписка,
 * hard bounce, жалоба) и вручную.
 */
export function SuppressionsCard() {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const [newEmail, setNewEmail] = useState("");
	const debouncedSearch = useDebouncedValue(search, 300);

	const { data, isLoading } = useQuery(
		orpc.emailLists.suppressions.list.queryOptions({
			input: {
				search: debouncedSearch || undefined,
				page,
				pageSize: PAGE_SIZE,
			},
			placeholderData: (prev) => prev,
		}),
	);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.emailLists.key() });

	const add = useMutation(
		orpc.emailLists.suppressions.add.mutationOptions({
			onSuccess: () => {
				toast.success("Адрес добавлен в стоп-лист");
				setNewEmail("");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const remove = useMutation(
		orpc.emailLists.suppressions.remove.mutationOptions({
			onSuccess: () => {
				toast.success("Адрес убран из стоп-листа");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const rows = data?.rows ?? [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Стоп-лист</CardTitle>
				<CardDescription>
					Эти адреса исключаются из всех email-рассылок. Отписавшиеся, адреса с
					постоянной ошибкой доставки и пожаловавшиеся на спам попадают сюда
					автоматически — повторная отправка им вредит репутации домена.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<Input
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setPage(0);
						}}
						placeholder="Поиск по адресу"
						className="md:max-w-xs"
					/>
					<form
						className="flex gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							if (newEmail.trim()) add.mutate({ email: newEmail });
						}}
					>
						<Input
							type="email"
							value={newEmail}
							onChange={(e) => setNewEmail(e.target.value)}
							placeholder="email@example.com"
							className="md:w-64"
						/>
						<Button
							type="submit"
							variant="outline"
							disabled={!newEmail.trim() || add.isPending}
						>
							Добавить
						</Button>
					</form>
				</div>

				{isLoading ? (
					<p className="text-sm text-muted-foreground">Загрузка…</p>
				) : rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{debouncedSearch ? "Ничего не найдено." : "Стоп-лист пуст."}
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Email</TableHead>
								<TableHead>Причина</TableHead>
								<TableHead>Детали</TableHead>
								<TableHead>Когда</TableHead>
								<TableHead className="w-0" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={row.email}>
									<TableCell className="font-medium">{row.email}</TableCell>
									<TableCell>
										<Badge variant="outline">
											{SUPPRESSION_REASON_LABELS[row.reason] ?? row.reason}
										</Badge>
									</TableCell>
									<TableCell className="max-w-64 truncate text-xs text-muted-foreground">
										{row.details ?? "—"}
									</TableCell>
									<TableCell className="whitespace-nowrap text-muted-foreground">
										{formatDateTime(row.createdAt)}
									</TableCell>
									<TableCell>
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button variant="ghost" size="sm">
													Убрать
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>
														Убрать {row.email} из стоп-листа?
													</AlertDialogTitle>
													<AlertDialogDescription>
														{row.reason === "manual"
															? "Адрес снова начнёт получать рассылки."
															: "Человек сам отказался от писем или адрес недоступен. Возвращайте его, только если получили повторное согласие или исправили адрес — иначе письма будут уходить в спам."}
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Отмена</AlertDialogCancel>
													<AlertDialogAction
														onClick={() => remove.mutate({ email: row.email })}
													>
														Убрать
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
				<Pager
					page={page}
					pageSize={PAGE_SIZE}
					total={data?.total ?? 0}
					onPageChange={setPage}
				/>
			</CardContent>
		</Card>
	);
}
